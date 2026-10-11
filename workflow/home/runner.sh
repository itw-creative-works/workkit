#!/usr/bin/env bash
# workflow/home/runner.sh: the cloud brief's runner in the clone, seeded by
# content and pruned of what the list does not name. Sourced by home.sh,
# functions only. WK_KIT_DIR is the entry's; WK_HOME_DIR is lib.sh's; the list
# is the exported kit's own, read by wk_home_runner_list.

# The `src:dest` pairs a kit folder's own `workflow/home.sh` lists, one per
# line, sourced in a subshell with the inherited array unset. `;`, not `&&`: a
# kit missing a stage file still has its list. Nothing and 1 when there is none.
# Usage: wk_home_runner_list <kit folder>
wk_home_runner_list() {
  local kit="$1" pairs
  [[ -f "$kit/workflow/home.sh" ]] || return 1
  pairs="$( { unset WK_HOME_RUNNER_FILES; WORKKIT_KIT_DIR="$kit" . "$kit/workflow/home.sh"; printf '%s\n' "${WK_HOME_RUNNER_FILES[@]}"; } 2>/dev/null )" || true
  [[ -n "$pairs" ]] || return 1
  printf '%s\n' "$pairs"
}

# The files under the clone's `brief/` the given pairs do not name, one per
# line: the seed removes them and the doctor counts them. `-type f` follows no
# symlink, which keeps the walk inside the clone.
# Usage: wk_home_runner_retired <pair>...
wk_home_runner_retired() {
  local found rel keep pair
  [[ -d "$WK_HOME_DIR/brief" ]] || return 0
  while IFS= read -r found; do
    rel="${found#"$WK_HOME_DIR"/}"
    keep=0
    for pair in "$@"; do
      [[ "${pair#*:}" == "$rel" ]] && { keep=1; break; }
    done
    [[ "$keep" -eq 1 ]] && continue
    printf '%s\n' "$found"
  done < <(find "$WK_HOME_DIR/brief" -type f 2>/dev/null)
}

# README § The home repo's lifecycle, step 5. Returns 0 (something changed),
# 2 (already current), 1 (nothing was written).
wk_home_seed_runner() {
  local pair src dest found rel scratch kit changed=0 removed=0 missing='' pairs=()

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
  # A read loop rather than mapfile, which the Mac's bash 3.2 lacks.
  while IFS= read -r pair; do pairs+=("$pair"); done < <(wk_home_runner_list "$kit")
  [[ "${#pairs[@]}" -gt 0 ]] || {
    wk_warn "home: the committed kit at $WK_KIT_DIR carries no runner list; the cloud brief's runner was not seeded"
    rm -rf "$scratch"
    return 1
  }

  for pair in "${pairs[@]}"; do
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

  # Only `brief/`, engine territory, is pruned: everything else in the clone is
  # the project's. A missing source is a committed list naming a file the commit
  # lacks, so the prune waits: a file the list dropped may still be one the
  # committed scripts require.
  if [[ -z "$missing" && -d "$WK_HOME_DIR/brief" ]]; then
    while IFS= read -r found; do
      rel="${found#"$WK_HOME_DIR"/}"
      rm -f "$found" 2>/dev/null || {
        wk_warn "home: could not remove the retired $rel from $WK_HOME_DIR"
        rm -rf "$scratch"
        return 1
      }
      changed=$((changed + 1))
      removed=$((removed + 1))
    done < <(wk_home_runner_retired "${pairs[@]}")
    # Emptied folders, deepest first; rmdir refusing a non-empty one is the
    # check, so its failures are ignored.
    find "$WK_HOME_DIR/brief" -mindepth 1 -depth -type d -exec rmdir {} + >/dev/null 2>&1 || true
  fi
  rm -rf "$scratch"

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
