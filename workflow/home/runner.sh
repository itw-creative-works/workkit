#!/usr/bin/env bash
# workflow/home/runner.sh: the cloud brief's runner in the clone, seeded by
# content and pruned of what the list does not name. Sourced by home.sh,
# functions only. WK_HOME_RUNNER_FILES and WK_KIT_DIR are the entry's;
# WK_HOME_DIR is lib.sh's.

# The files under the clone's `brief/` the list does not name, one per line:
# the seed removes them and the doctor counts them. `-type f` follows no
# symlink, which keeps the walk inside the clone.
wk_home_runner_retired() {
  local found rel keep pair
  [[ -d "$WK_HOME_DIR/brief" ]] || return 0
  while IFS= read -r found; do
    rel="${found#"$WK_HOME_DIR"/}"
    keep=0
    for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
      [[ "${pair#*:}" == "$rel" ]] && { keep=1; break; }
    done
    [[ "$keep" -eq 1 ]] && continue
    printf '%s\n' "$found"
  done < <(find "$WK_HOME_DIR/brief" -type f 2>/dev/null)
}

# README § The home repo's lifecycle, step 5. Returns 0 (something changed),
# 2 (already current), 1 (nothing was written).
wk_home_seed_runner() {
  local pair src dest found rel scratch kit changed=0 removed=0 missing=''

  [[ -n "$WK_KIT_DIR" && -d "$WK_KIT_DIR" ]] || {
    wk_warn "home: the kit could not be resolved beside this engine; the cloud brief's runner was not seeded"
    return 1
  }
  # Never over a newer kit's work; rc=1, so no caller commits.
  wk_home_downgrades && return 1

  scratch="$(mktemp -d)" || {
    wk_warn "home: could not make a scratch directory; the cloud brief's runner was not seeded"
    return 1
  }
  kit="$(wk_home_source "$scratch" "$WK_KIT_DIR")" || {
    rm -rf "$scratch"
    return 1
  }

  for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
    src="$kit/${pair%%:*}"
    dest="$WK_HOME_DIR/${pair#*:}"
    if [[ ! -f "$src" ]]; then missing="$missing ${pair%%:*}"; continue; fi
    if cmp -s "$src" "$dest" 2>/dev/null; then continue; fi
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    # -p keeps a script's mode rather than this shell's umask.
    cp -p "$src" "$dest" 2>/dev/null || {
      wk_warn "home: could not write ${pair#*:} into $WK_HOME_DIR"
      rm -rf "$scratch"
      return 1
    }
    changed=$((changed + 1))
  done
  rm -rf "$scratch"

  # Only `brief/`, engine territory, is pruned: everything else in the clone is
  # the project's. A missing source can be a list on disk ahead of HEAD (an
  # uncommitted rename), so the prune waits: a file the list dropped may still
  # be one the committed scripts require.
  if [[ -z "$missing" && -d "$WK_HOME_DIR/brief" ]]; then
    while IFS= read -r found; do
      rel="${found#"$WK_HOME_DIR"/}"
      rm -f "$found" 2>/dev/null || {
        wk_warn "home: could not remove the retired $rel from $WK_HOME_DIR"
        return 1
      }
      changed=$((changed + 1))
      removed=$((removed + 1))
    done < <(wk_home_runner_retired)
    # Emptied folders, deepest first; rmdir refusing a non-empty one is the
    # check, so its failures are ignored.
    find "$WK_HOME_DIR/brief" -mindepth 1 -depth -type d -exec rmdir {} + >/dev/null 2>&1 || true
  fi

  if [[ -n "$missing" ]]; then
    wk_warn "home: this kit is missing$missing; the cloud brief's runner is incomplete in $WK_HOME_DIR, and the files its list no longer names were left in place until it is whole"
  fi
  # The stamp counts as a write of its own, so a bare version bump still
  # reaches the remote.
  wk_home_stamp_write && changed=$((changed + 1))

  if [[ "$changed" -eq 0 ]]; then
    wk_skip "home: the cloud brief's runner in $WK_HOME_DIR is current"
    return 2
  fi
  wk_ok "home: seeded the cloud brief's runner in $WK_HOME_DIR ($((changed - removed)) file(s) from $WK_KIT_DIR, $removed retired)"
  return 0
}
