#!/usr/bin/env bash
# workflow/script-shell.sh: npm's script shell, once `npm config set
# script-shell` names it. The proved-tree records (lib/suite.sh) are the
# engine-agnostic contract and this file is npm's adapter: a green bare root
# `npm test`, run detached, writes the suite record; every other green `test`
# event (narrowed, or a nested package's bare run), detached in a slot of its
# own, writes the package record; under a supervisor (WORKKIT_SUPERVISED=1) a
# `test` event runs in the foreground. An install-time script is followed by the
# hooks' re-point; any other is plain sh. A bare root run asks lib/hold.sh first.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

# recorded_run <root> <pkg> -c <script>: hash, run, hash, record; an empty
# <pkg> is the whole root suite. Hashed before and after, on <pkg>'s own id: an
# edit made while it runs is never proved. A failed hash is its own answer, never
# an empty id read as a changed tree.
recorded_run() {
  local root="$1" pkg="$2" what=suite record=record hashed=1 before after rc=0 started ms
  local changed='the tree changed during the run, so no record was written; run npm test again'
  local ci='CI is set, so no record was written; run npm test again without CI'
  shift 2
  if [ -n "$pkg" ]; then
    what=run record='package record'
    changed='the tree changed during it, so no record was written; run it again'
    ci='CI is set, so no record was written; run it again without CI'
  fi
  before=$(wk_tree_hash "$root" "$pkg") || hashed=0
  started=$SECONDS
  sh "$@" || rc=$?
  ms=$(wk_elapsed_ms "$started")
  [ "$rc" -eq 0 ] || exit "$rc"
  # CI set records nothing whatever the hashes say, so its line comes first:
  # a run again with CI still set would record nothing either.
  if wk_ci_set; then
    printf 'script-shell: the %s passed, but %s\n' "$what" "$ci" >&2
    exit 0
  fi
  after=$(wk_tree_hash "$root" "$pkg") || hashed=0
  if [ "$hashed" -eq 0 ]; then
    printf 'script-shell: the %s passed, but the tree of %s could not be hashed, so no record was written\n' "$what" "$root" >&2
    exit 1
  fi
  if [ "$before" != "$after" ]; then
    printf 'script-shell: the %s passed, but %s\n' "$what" "$changed" >&2
    exit 0
  fi
  if [ -n "$pkg" ]; then
    wk_pkg_marker_write "$root" "$before" "$pkg" || rc=1
  else
    wk_suite_marker_write "$root" "$before" "$ms" || rc=1
  fi
  if [ "$rc" -ne 0 ]; then
    printf 'script-shell: the %s passed, but the %s of %s could not be written\n' "$what" "$record" "$root" >&2
    exit 1
  fi
  exit 0
}

# run_body <root> <pkg> -c <script>: a detached test run, the whole root suite
# when <pkg> is empty. Its last line is always `script-shell: exit <code>`, for
# a reader of the log.
run_body() {
  wk_body_traps script-shell
  recorded_run "$@"
}

# package_run <root> <pkg> -c <script>: a narrowed or nested run, detached in a
# slot named by this wrapper's pid, so several run at once in one repo. Its log
# and lock go once this call reads the end or Ctrl-C ends it; a look, or a
# Ctrl-C whose end failed, leaves them for `workkit watch <pid>`.
package_run() {
  local root="$1" log lock rc=0
  wk_test_slots_sweep "$root"
  log=$(wk_test_log_path "$root" "$$") || exit 1
  lock=$(wk_test_lock_path "$root" "$$") || exit 1
  # shellcheck disable=SC2034  # read by wk_attach_run's look line
  WK_WATCH_NAME=$$
  # Ctrl-C ends the run and this call inside wk_run_detached; the slot goes too,
  # once the lock is gone: a run whose end failed keeps its lock and its log.
  # shellcheck disable=SC2064  # the root, the lock and the pid are fixed for this run
  trap "[ \"\${WK_RAN_INT:-}\" != 1 ] || [ -d $(printf '%q' "$lock") ] || wk_test_slot_clear $(printf '%q' "$root") $$" EXIT
  wk_run_detached "$log" "$lock" --root "$root" -- "$BASH" "$SCRIPT_DIR/script-shell.sh" --test-body "$@" || rc=$?
  if [ -n "$WK_HELD_PID" ]; then
    printf 'script-shell: a run already holds this slot (pid %s); its output is in %s\n' "$WK_HELD_PID" "$(wk_native_path "$log")" >&2
    exit 1
  fi
  [ "$WK_RAN_LOOK" = 1 ] || wk_test_slot_clear "$root" "$$"
  exit "$rc"
}

load_libs() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  # shellcheck source=./lib/platform.sh
  . "$SCRIPT_DIR/lib/platform.sh"
  # shellcheck source=./lib/participation.sh
  . "$SCRIPT_DIR/lib/participation.sh"
  # shellcheck source=./lib/slug.sh
  . "$SCRIPT_DIR/lib/slug.sh"
  # shellcheck source=./lib/suite.sh
  . "$SCRIPT_DIR/lib/suite.sh"
  # shellcheck source=./lib/hold.sh
  . "$SCRIPT_DIR/lib/hold.sh"
  # shellcheck source=./lib/changelog.sh
  . "$SCRIPT_DIR/lib/changelog.sh"
  # shellcheck source=./lib/detach.sh
  . "$SCRIPT_DIR/lib/detach.sh"
}

# install_repoint: after an install-time script, which may set core.hooksPath
# itself (husky's prepare), the kit's hooks are put back through the heal's own
# step, in an opted-in repo, whoever runs npm. Its line is the only output.
install_repoint() {
  local root
  root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -e "$root/.workkit/settings.json" ] || return 0
  load_libs
  wk_opted_in "$root" || return 0
  # shellcheck source=./lib.sh
  . "$SCRIPT_DIR/lib.sh"
  # shellcheck source=./standards/githooks.sh
  . "$SCRIPT_DIR/standards/githooks.sh"
  needs_attention=0 WK_LOG_STDERR=1
  git_hooks_installed "$root" >/dev/null || ensure_git_hooks "$root"
}

main() {
  case "${1:-}" in
    --suite-body) shift; load_libs; run_body "$1" "" "${@:2}" ;;
    --test-body) shift; load_libs; run_body "$@" ;;
  esac
  case "${npm_lifecycle_event:-}" in
    test) ;;
    prepare|install|postinstall)
      rc=0
      sh "$@" || rc=$?
      install_repoint
      exit "$rc"
      ;;
    *) exec sh "$@" ;;
  esac
  load_libs

  # The package npm is running, as a folder relative to the git root (`.` for the
  # root). npm may hand a native Windows path, so either separator ends the
  # folder; a package outside the root records nothing.
  root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || exec sh "$@"
  [ -n "${npm_package_json:-}" ] || exec sh "$@"
  pkg_dir=$(cd "${npm_package_json%[/\\]*}" 2>/dev/null && pwd -P) || exec sh "$@"
  real_root=$(cd "$root" && pwd -P) || exec sh "$@"
  case "$pkg_dir" in
    "$real_root") rel=. ;;
    "$real_root"/*) rel=${pkg_dir#"$real_root"/} ;;
    *) exec sh "$@" ;;
  esac

  # npm appends a narrowed run's arguments (`npm test -- <file>`) to the script
  # text, so only the root's bare script is the whole suite. Every other test
  # run is the package path: no hold, no CHANGELOG lint. Under a supervisor
  # already it runs in the foreground, never detached again.
  if [ "$rel" != . ] || [ "${2:-}" != "${npm_lifecycle_script:-}" ]; then
    ! wk_supervised || recorded_run "$root" "$rel" "$@"
    package_run "$root" "$rel" "$@"
  fi

  # The full-suite hold (lib/hold.sh) before anything else the root run does: a
  # refusal runs no suite and writes no record; a root `pretest` has already run.
  wk_suite_hold "$root" wk_tree_hash || exit 1

  # The gate's cheap check first, so a bad CHANGELOG entry costs a second, not
  # a suite: every tracked CHANGELOG.md the working tree modifies. -z keeps a
  # path with a space unquoted; a rename's origin follows as its own field.
  changelogs=()
  if wk_changelog_linter >/dev/null; then
    while IFS= read -r -d '' entry; do
      case "${entry:0:2}" in
        R*|C*|?R|?C) IFS= read -r -d '' _ ;;
      esac
      case "${entry:0:2}" in
        *D*) continue ;;
      esac
      if wk_is_changelog "${entry:3}"; then changelogs+=("${entry:3}"); fi
    done < <(git -C "$root" status --porcelain -z --untracked-files=no)
  fi
  if [ "${#changelogs[@]}" -gt 0 ] && ! lint_msg=$(wk_changelog_lint "$root" "${changelogs[@]}" 2>&1); then
    printf 'script-shell: %s\n' "$lint_msg" >&2
    exit 1
  fi

  # The suite runs in its own session, so a kill of the shell that started it
  # leaves it running to its record; INT (a human's Ctrl-C) still ends it. A
  # frozen suite exits 124, and a look at an unclear one 125 with the suite on.
  # Under a supervisor already it runs here, the suite's slot held for its length.
  log=$(wk_suite_log_path "$root") || exit 1
  lock=$(wk_suite_lock_path "$root") || exit 1
  rc=0
  wk_run_detached "$log" "$lock" --root "$root" -- "$BASH" "$SCRIPT_DIR/script-shell.sh" --suite-body "$root" "$@" || rc=$?
  if [ -n "$WK_HELD_PID" ]; then
    printf 'script-shell: a root npm test is already running (pid %s); its output is in %s\n' "$WK_HELD_PID" "$(wk_native_path "$log")" >&2
    exit 1
  fi
  exit "$rc"
}

main "$@"
