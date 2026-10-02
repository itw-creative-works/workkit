#!/usr/bin/env bash
# workflow/home/seed.sh: the one-time seed of the tower project into an empty
# clone, and the by-content sync that keeps it current. Sourced by home.sh,
# functions only. WK_TOWER_APP, WK_TOWER_APP_EXCLUDE, WK_TOWER_APP_KEEP and
# WK_HOME_SYNC_MANIFESTS are the entry's; WK_HOME_DIR is lib.sh's.

# The seed: README § The home repo's lifecycle, step 4. The npm pins travel as
# they are; a `file:` spec, which only a maintainer tree in local mode carries,
# is made absolute.
wk_home_seed() {
  local pkg target_pkg name excludes=()

  [[ -n "$WK_TOWER_APP" && -d "$WK_TOWER_APP" ]] || {
    wk_warn "home: the tower app is missing at ${WK_TOWER_APP:-this kit}; nothing to seed the project from"
    return 1
  }

  # `tar`, so the exclusions hold at every depth before a byte of dependencies
  # is copied.
  for name in "${WK_TOWER_APP_EXCLUDE[@]}"; do
    excludes+=(--exclude "./$name" --exclude "*/$name")
  done
  (cd "$WK_TOWER_APP" && tar -cf - "${excludes[@]}" .) \
    | (cd "$WK_HOME_DIR" && tar -xf -) || {
    wk_warn "home: could not copy the tower app into $WK_HOME_DIR"
    return 1
  }
  for name in "${WK_TOWER_APP_KEEP[@]}"; do
    [[ -f "$WK_TOWER_APP/$name" ]] || continue
    cp -p "$WK_TOWER_APP/$name" "$WK_HOME_DIR/$name" || {
      wk_warn "home: could not copy $name into $WK_HOME_DIR"
      return 1
    }
  done

  # The manifests, root first and then every target: each spec resolves from the
  # directory of the manifest it was copied from, never from the clone.
  wk_home_repoint_file_specs "$WK_HOME_DIR/package.json" "$WK_TOWER_APP"
  for pkg in "$WK_HOME_DIR"/targets/*/package.json; do
    [[ -f "$pkg" ]] || continue
    target_pkg="${pkg#"$WK_HOME_DIR"/}"
    wk_home_repoint_file_specs "$pkg" "$WK_TOWER_APP/$(dirname "$target_pkg")"
  done

  # From the very first commit the clone says which kit wrote it.
  wk_home_stamp_write || true

  wk_ok "home: seeded the tower project in $WK_HOME_DIR from $WK_TOWER_APP"
  return 0
}

# The catch-up ahead of the build (README § Publishing the dashboard). Returns
# 0 changed, 2 already current, 1 nothing to sync from, 3 a mid-walk write
# failed. Call it directly: a subshell loses WK_HOME_SYNC_MANIFESTS.
wk_home_sync() {
  local src rel dest want tmp top topname found excluded name manifest prune=()
  local copied=0 removed=0 rc=0
  WK_HOME_SYNC_MANIFESTS=0

  wk_home_ready || {
    wk_skip "sync: nothing is cloned at $WK_HOME_DIR; the tower project was not refreshed"
    return 1
  }
  [[ -n "$WK_TOWER_APP" && -d "$WK_TOWER_APP" ]] || {
    wk_skip "sync: the tower app is not beside this engine (${WK_TOWER_APP:-no tower/app was found}); $WK_HOME_DIR is left exactly as it is"
    return 1
  }
  # Never over a newer kit's work; rc=1, since nothing was written.
  wk_home_downgrades && return 1

  # One `-prune` list for both sides: it stops a directory's descent and
  # matches a plain file, so it covers `node_modules` and `.env` alike.
  for name in "${WK_TOWER_APP_EXCLUDE[@]}"; do
    [[ "${#prune[@]}" -eq 0 ]] || prune+=(-o)
    prune+=(-name "$name")
  done

  tmp="$(mktemp -d)" || {
    wk_warn "sync: could not make a scratch directory; the tower project in $WK_HOME_DIR was not refreshed"
    return 1
  }

  # Everything the app ships, in.
  while IFS= read -r src; do
    rel="${src#"$WK_TOWER_APP"/}"
    dest="$WK_HOME_DIR/$rel"
    want="$src"
    manifest=0
    # A manifest is composed first, so the comparison below is against what
    # would land rather than against the checkout's own relative specs.
    if [[ "$(basename "$rel")" == 'package.json' ]]; then
      manifest=1
      want="$tmp/package.json"
      cp -p "$src" "$want" 2>/dev/null || {
        wk_warn "sync: could not stage $rel for comparison; the tower project in $WK_HOME_DIR is part-refreshed"
        rc=3
        break
      }
      wk_home_repoint_file_specs "$want" "$(dirname "$src")"
    fi
    cmp -s "$want" "$dest" 2>/dev/null && continue
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    # -p keeps an executable's mode rather than this shell's umask.
    cp -p "$want" "$dest" 2>/dev/null || {
      wk_warn "sync: could not write $rel into $WK_HOME_DIR"
      rc=3
      break
    }
    [[ "$manifest" -eq 1 ]] && WK_HOME_SYNC_MANIFESTS=1
    copied=$((copied + 1))
  done < <(
    find "$WK_TOWER_APP" \( "${prune[@]}" \) -prune -o -type f -print
    for name in "${WK_TOWER_APP_KEEP[@]}"; do
      [[ -f "$WK_TOWER_APP/$name" ]] && printf '%s\n' "$WK_TOWER_APP/$name"
    done
  )

  # rc=3 is never the benign skip: committing or building it publishes half a
  # refresh.
  rm -rf "$tmp"
  [[ "$rc" -eq 0 ]] || return "$rc"

  # What the app retired, out, inside its own top-level folders only: the root
  # is shared with other steps. Emptied directories stay, or a minted `.omega`
  # could go with them.
  for top in "$WK_TOWER_APP"/*/; do
    [[ -d "$top" ]] || continue
    topname="$(basename "$top")"
    excluded=0
    for name in "${WK_TOWER_APP_EXCLUDE[@]}"; do
      [[ "$topname" == "$name" ]] && { excluded=1; break; }
    done
    [[ "$excluded" -eq 0 ]] || continue
    [[ -d "$WK_HOME_DIR/$topname" ]] || continue

    while IFS= read -r found; do
      rel="${found#"$WK_HOME_DIR"/}"
      [[ -f "$WK_TOWER_APP/$rel" ]] && continue
      rm -f "$found" 2>/dev/null || {
        wk_warn "sync: could not remove the retired $rel from $WK_HOME_DIR"
        return 3
      }
      removed=$((removed + 1))
    done < <(find "$WK_HOME_DIR/$topname" \( "${prune[@]}" \) -prune -o -type f -print)
  done

  # The stamp last, counted as a write of its own: a kit that moved on reaches
  # the remote even when the app did not change.
  wk_home_stamp_write && copied=$((copied + 1))

  if [[ $((copied + removed)) -eq 0 ]]; then
    wk_skip "sync: the tower project in $WK_HOME_DIR is already current with $WK_TOWER_APP"
    return 2
  fi
  wk_ok "sync: refreshed the tower project in $WK_HOME_DIR ($copied file(s) from $WK_TOWER_APP, $removed retired)"
  return 0
}
