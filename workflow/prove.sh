#!/usr/bin/env bash
# workflow/prove.sh: `workkit prove`, the root suite on exactly the staged tree:
# a detached worktree of the index's tree outside the repo, its gitignored files
# filled from the live folder, the root `npm test` run there, and the index's
# tree recorded on green. The working folder and the index are never changed.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

fail() {
  printf 'prove: %s\n' "$1" >&2
  exit 1
}

load_libs() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  # The hooks' library brings the engine's platform and suite records with it,
  # and the snapshot fill red-proof's copy uses.
  # shellcheck source=../hooks/_lib.sh
  . "$SCRIPT_DIR/../hooks/_lib.sh"
  # shellcheck source=./lib/detach.sh
  . "$SCRIPT_DIR/lib/detach.sh"
}

# prove_cleanup: the copy's worktree removed (hook_snapshot_worktree_remove)
# and its temp folder with it, on every exit of the body.
prove_cleanup() {
  cd "$PROVE_ROOT" 2>/dev/null || cd /
  if [ "$PROVE_ADDED" -eq 1 ]; then
    hook_snapshot_worktree_remove "$PROVE_ROOT" "$PROVE_COPY" \
      || printf 'prove: git still lists the removed worktree %s (run git -C %s worktree prune)\n' "$PROVE_COPY" "$PROVE_ROOT"
  fi
  [ -z "$PROVE_TMP" ] || rm -rf "$PROVE_TMP"
}

# prove_body <root>: the detached run: copy, fill, run, record. Its last line is
# always `prove: exit <code>`, for a reader of the log; only a green run whose
# copy still holds the index's tree writes the record.
prove_body() {
  local root="$1" tree copy add_err fill_root sh_path rel before after rc=0 ignored=()
  PROVE_ROOT="$root" PROVE_TMP="" PROVE_COPY="" PROVE_ADDED=0
  wk_body_traps prove prove_cleanup
  tree=$(wk_suite_index_tree "$root") && [ -n "$tree" ] \
    || fail "could not write the index's tree (an unmerged path blocks it); resolve it and stage again"
  git -C "$root" rev-parse --verify -q HEAD >/dev/null || fail "$root has no commit to add a worktree of"
  PROVE_TMP=$(mktemp -d "${TMPDIR:-/tmp}/prove.XXXXXX") || fail "could not make a temp folder"
  copy="$PROVE_TMP/copy"
  PROVE_COPY="$copy"

  add_err=$(hook_snapshot_worktree_add "$root" "$copy" 2>&1) \
    || fail "could not add a worktree at $copy: $add_err"
  PROVE_ADDED=1
  git -C "$copy" read-tree "$tree" && git -C "$copy" checkout-index -a \
    || fail "could not check the index's tree $tree out into the copy"

  # Only the paths an ignore pattern matches come from the live folder: an
  # untracked or unstaged file is the held work the copy leaves out. No
  # optional locks, so the read never refreshes the index.
  git -C "$root" --no-optional-locks status --porcelain -z --ignored=matching --no-renames >"$PROVE_TMP/status" \
    || fail "could not list the gitignored files of $root"
  while IFS= read -r -d '' rel; do
    case "$rel" in '!! '*) ignored+=("${rel:3}") ;; esac
  done <"$PROVE_TMP/status"
  # No rels would fill the copy with the whole folder, so none skips the fill.
  # The fill compares link targets spelled by pwd -P, so the root is spelled so too.
  if [ ${#ignored[@]} -gt 0 ]; then
    fill_root=$(hook_snapshot_root "$root") || fail "could not enter the repo root $root"
    hook_snapshot_fill "$fill_root" "$fill_root" "$copy" "${ignored[@]}" \
      || fail "could not fill the copy's gitignored files from $root"
  fi
  before=$(wk_tree_hash "$copy") || fail "could not hash the copy's tree"
  [ "$before" = "$tree" ] \
    || fail "the copy holds tree $before, not the index's $tree (a gitignored file the staged .gitignore does not ignore), so nothing was run"

  # npm runs the script with plain sh, as the root run's wrapper does: the
  # copy's own record is never the one wanted. A Windows sh is spelled for node.
  sh_path=$(command -v sh) || fail "no sh on PATH for npm to run the suite with"
  sh_path=$(wk_git_path "$sh_path") || fail "could not spell $sh_path for npm"
  (cd "$copy" && npm test --script-shell="$sh_path") || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf 'prove: red: the suite failed on the staged tree %s, so no record was written\n' "$tree"
    exit "$rc"
  fi
  after=$(wk_tree_hash "$copy") || fail "the suite passed, but the copy's tree could not be hashed, so no record was written"
  [ "$after" = "$tree" ] || fail "the suite passed, but it changed the copy's tree, so no record was written"
  wk_suite_marker_write "$root" "$tree" || fail "the suite passed, but the record of $root could not be written"
  printf 'prove: green: the staged tree %s is proved; a commit of it passes the gate\n' "$tree"
  exit 0
}

main() {
  local root log lock rc=0
  if [ "${1:-}" = --body ]; then
    shift
    load_libs
    prove_body "$@"
  fi
  [ $# -eq 0 ] || { printf 'prove: takes no arguments (usage: workkit prove)\n' >&2; exit 2; }
  load_libs
  root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not inside a git repository"
  wk_has_test_script "$root" || fail "$root declares no test script, so there is no suite to prove"
  command -v npm >/dev/null 2>&1 || fail "npm is not on PATH"

  # The root run's log and lock: one full run at a time, and a kill of this
  # shell leaves the run going to its record and its cleanup.
  log=$(wk_suite_log_path "$root") || exit 1
  lock=$(wk_suite_lock_path "$root") || exit 1
  wk_run_detached "$log" "$lock" -- "$BASH" "$SCRIPT_DIR/prove.sh" --body "$root" || rc=$?
  if [ -n "$WK_HELD_PID" ]; then
    printf 'prove: a root suite run is already running (pid %s); its output is in %s\n' "$WK_HELD_PID" "$log" >&2
    exit 1
  fi
  exit "$rc"
}

main "$@"
