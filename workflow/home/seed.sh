#!/usr/bin/env bash
# workflow/home/seed.sh: the tower project in the clone. The one-time seed
# into an empty clone and the by-content sync that keeps it current. SOURCED by
# home.sh, never executed, and it runs nothing at load: it defines functions and
# sets nothing. WK_TOWER_APP, WK_TOWER_APP_EXCLUDE, WK_TOWER_APP_KEEP and
# WK_HOME_SYNC_MANIFESTS are the entry's; WK_HOME_DIR is lib.sh's.

# The seed: this checkout's `tower/app` becomes the clone's whole contents.
#
# The app IS the template (the Spec's "no stored second template"), so the copy
# is a plain one minus what a checkout accretes: the installed dependencies,
# the lockfile, the build output and the omega run machinery. The project's own
# AGENTS.md, CLAUDE.md and README.md travel WITH it: they are the tower
# project's docs and the repo they land in is a real repo.
#
# The clone is the app and nothing else (issue #79): the site options are the
# user's and live in the machine settings file, and no `.workkit/` is ever
# written here: the engine treats this path as the home BY PATH, so there is no
# participation flag to seed and no capture file to keep out of the commit. The one
# thing the seed adds on top of the copy is the absolute `file:` specs.
wk_home_seed() {
  local pkg target_pkg name excludes=()

  [[ -n "$WK_TOWER_APP" && -d "$WK_TOWER_APP" ]] || {
    wk_warn "home: the tower app is missing at ${WK_TOWER_APP:-this checkout}; nothing to seed the project from"
    return 1
  }

  # `tar` rather than `cp -R` with deletions after: the exclusions have to hold
  # at every depth (a nested node_modules under targets/*), and a copy that landed
  # a gigabyte of dependencies first would be slow before it was wrong. The
  # names are the shared list, so the seed and the sync exclude the same set.
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
  wk_home_project_manifest "$WK_HOME_DIR/package.json" "$WK_TOWER_APP" --root
  for pkg in "$WK_HOME_DIR"/targets/*/package.json; do
    [[ -f "$pkg" ]] || continue
    target_pkg="${pkg#"$WK_HOME_DIR"/}"
    wk_home_project_manifest "$pkg" "$WK_TOWER_APP/$(dirname "$target_pkg")"
  done

  # From the very first commit the clone says which kit wrote it (issue #200).
  wk_home_stamp_write || true

  wk_ok "home: seeded the tower project in $WK_HOME_DIR from $WK_TOWER_APP"
  return 0
}

# The clone's project, refreshed from this checkout's `tower/app` (issue #129).
#
# The seed is a ONE-TIME write: a clone that already carries the project is
# never re-seeded, because it is another machine's work, so every tower
# improvement made after the home repo was created stopped at the checkout, and
# the published dashboard stayed at whatever the app looked like on seed day.
# This is the catch-up, and the publish runs it ahead of the build.
#
# BY CONTENT, the way the cloud brief's runner is seeded: a file whose bytes
# already match is not written, so a second run changes nothing and leaves
# nothing to commit. The manifests are compared against what
# `wk_home_project_manifest` would leave rather than against the raw source,
# since the raw one differs by construction.
#
# WHAT IT MAY REMOVE is scoped to the top-level folders the app itself defines
# (`targets/`, `assets/`, `config/`: whatever `tower/app` has). Inside those the
# sync is the only writer, so a file the app stopped shipping is one an older
# copy left behind and the build would still glob. The clone's ROOT is shared
# territory (the runner's `brief/`, the heal's `.github/ISSUE_TEMPLATE/`, the
# roster's `data/repos.json` all sit there) and mirroring it would mean
# enumerating everything this function does NOT own, where the cost of an
# omission is deleting another step's work. So a root-level file the app
# retired is left alone. Emptied directories are left too: git tracks none of
# them, and a sweep that removed them could take a minted `.omega` tree with it.
#
# Returns 0 (something changed), 2 (already current), 1 (there was nothing to
# sync from: a named skip, and the caller builds the clone as it is), 3 (a
# write failed mid-walk and the clone is part-refreshed).
#
# Whether a MANIFEST was among what it wrote comes back in
# WK_HOME_SYNC_MANIFESTS, since the return code is already spoken for and a
# `$(…)` capture would only carry one of the two answers (issue #130). Call it
# DIRECTLY, the way publish.sh does: a sync run in a subshell says nothing.
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
  # Never over a NEWER kit's work (issue #200). The named skip is rc=1, the same
  # answer as a missing app: nothing was written, and the caller builds the
  # clone exactly as it is.
  wk_home_downgrades && return 1

  # The walk's blindfold, built once and used on both sides. `-prune` is what
  # does it: on a directory it stops the descent, and on a plain file it simply
  # matches, so one list covers `node_modules` and `.env` alike.
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
    # would LAND rather than against the checkout's own relative specs.
    if [[ "$(basename "$rel")" == 'package.json' ]]; then
      manifest=1
      want="$tmp/package.json"
      cp -p "$src" "$want" 2>/dev/null || {
        wk_warn "sync: could not stage $rel for comparison; the tower project in $WK_HOME_DIR is part-refreshed"
        rc=3
        break
      }
      if [[ "$rel" == 'package.json' ]]; then
        wk_home_project_manifest "$want" "$WK_TOWER_APP" --root
      else
        wk_home_project_manifest "$want" "$(dirname "$src")"
      fi
    fi
    cmp -s "$want" "$dest" 2>/dev/null && continue
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    # -p, so a file the project executes arrives with the mode it was written
    # with rather than whatever this shell's umask would have given it.
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

  # rc=3 is a PART-refreshed clone (a mid-walk write failed) and the caller
  # must not treat it as the benign "nothing to sync from" skip (rc=1): what
  # landed before the failure is real, and committing or building it publishes
  # half a refresh.
  rm -rf "$tmp"
  [[ "$rc" -eq 0 ]] || return "$rc"

  # And what the app retired, out: inside its own folders and nowhere else.
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

  # The stamp last, so it rides whatever this run wrote (issue #200), and
  # counts as a write of its own, since a kit that moved on has to reach the
  # remote even when the app it ships did not change.
  wk_home_stamp_write && copied=$((copied + 1))

  if [[ $((copied + removed)) -eq 0 ]]; then
    wk_skip "sync: the tower project in $WK_HOME_DIR is already current with $WK_TOWER_APP"
    return 2
  fi
  wk_ok "sync: refreshed the tower project in $WK_HOME_DIR ($copied file(s) from $WK_TOWER_APP, $removed retired)"
  return 0
}
