#!/usr/bin/env bash
# workflow/home/runner.sh: the cloud brief's runner in the clone. The files
# the list no longer names and the by-content seed that copies and subtracts.
# SOURCED by home.sh, never executed, and it runs nothing at load: it defines
# functions and sets nothing. WK_HOME_RUNNER_FILES and WK_KIT_DIR are the
# entry's; WK_HOME_DIR is lib.sh's.

# The cloud brief's runner, copied into the clone (issue #91).
#
# Unlike the project seed this runs on EVERY setup, empty clone or not: the
# scripts are the checkout's, they change with it, and a home repo running last
# month's runner is the failure this refresh exists to prevent. Idempotent by
# content (a file already identical is not rewritten, so a second setup writes
# nothing and leaves nothing to commit) and by SUBTRACTION too: what the
# manifest no longer names is removed (issue #117).
#
# Returns 0 (something changed), 2 (every file was already current), 1 (the
# checkout could not be read: nothing was written).
# The files under the clone's `brief/` that the manifest no longer names: one
# definition shared by the seed (which removes them) and the doctor (which
# counts them), so the two can never disagree on the word "current" (#117).
# Prints one absolute path per line; symlinks are deliberately invisible
# (`-type f` follows nothing), which is also what keeps the walk inside the
# clone.
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

wk_home_seed_runner() {
  local pair src dest found rel changed=0 removed=0 missing=''

  [[ -n "$WK_KIT_DIR" && -d "$WK_KIT_DIR" ]] || {
    wk_warn "home: the plugin checkout could not be resolved beside this engine; the cloud brief's runner was not seeded"
    return 1
  }
  # Never over a NEWER kit's work (issue #200). rc=1 is what every caller
  # already reads as "nothing was written", so none of them commits.
  wk_home_downgrades && return 1

  for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
    src="$WK_KIT_DIR/${pair%%:*}"
    dest="$WK_HOME_DIR/${pair#*:}"
    if [[ ! -f "$src" ]]; then missing="$missing ${pair%%:*}"; continue; fi
    if cmp -s "$src" "$dest" 2>/dev/null; then continue; fi
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    # -p, so a script the runner sources arrives with the mode it was written
    # with rather than whatever this shell's umask would have given it.
    cp -p "$src" "$dest" 2>/dev/null || {
      wk_warn "home: could not write ${pair#*:} into $WK_HOME_DIR"
      return 1
    }
    changed=$((changed + 1))
  done

  # What the manifest stopped naming (issue #117). `brief/` in the clone is
  # ENGINE territory (the clone carries no config of its own under it) so a
  # file there the list does not name is one a rename left behind, and #107's
  # rename of the entry script is exactly that: a clone seeded before it would
  # keep the retired copy forever. Only `brief/` is walked; the workflow file
  # is replaced by content above and everything else in the clone is the
  # project's, never this function's to remove.
  if [[ -d "$WK_HOME_DIR/brief" ]]; then
    while IFS= read -r found; do
      rel="${found#"$WK_HOME_DIR"/}"
      rm -f "$found" 2>/dev/null || {
        wk_warn "home: could not remove the retired $rel from $WK_HOME_DIR"
        return 1
      }
      changed=$((changed + 1))
      removed=$((removed + 1))
    done < <(wk_home_runner_retired)
    # And the folders a removal emptied: deepest first, so a nested one goes
    # with its parent; rmdir refusing a folder that still holds something is
    # the check, which is why the failures are the ones ignored here.
    find "$WK_HOME_DIR/brief" -mindepth 1 -depth -type d -exec rmdir {} + >/dev/null 2>&1 || true
  fi

  if [[ -n "$missing" ]]; then
    wk_warn "home: this checkout is missing$missing; the cloud brief's runner is incomplete in $WK_HOME_DIR"
  fi
  # The stamp rides with the copy (issue #200), and counts as a write of its
  # own: a version bump that changed none of these files still has to reach the
  # remote for the other machine's guard to see it.
  wk_home_stamp_write && changed=$((changed + 1))

  if [[ "$changed" -eq 0 ]]; then
    wk_skip "home: the cloud brief's runner in $WK_HOME_DIR is current"
    return 2
  fi
  wk_ok "home: seeded the cloud brief's runner in $WK_HOME_DIR ($((changed - removed)) file(s) from $WK_KIT_DIR, $removed retired)"
  return 0
}
