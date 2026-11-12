#!/usr/bin/env bash
# workflow/supervise.sh: `workkit supervise -- <command> [args...]`, any command
# run the way the root `npm test` runs: detached under the supervisor, which
# reads it (lib/detach.js), its output in the repo's run log and tailed here.
# One supervised run per repo at a time; the command runs in the caller's folder.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

USAGE='usage: workkit supervise -- <command> [args...]'

fail() {
  printf 'supervise: %s\n' "$1" >&2
  exit 1
}

load_libs() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  # shellcheck source=./lib/platform.sh
  . "$SCRIPT_DIR/lib/platform.sh"
  # shellcheck source=./lib/suite.sh
  . "$SCRIPT_DIR/lib/suite.sh"
  # shellcheck source=./lib/detach.sh
  . "$SCRIPT_DIR/lib/detach.sh"
}

# read_already <command> [args...]: 0 when the supervisor reads the command
# itself: the bare root `npm test`, the bare `workkit test`, `workkit prove`
# or `workkit supervise`. Twin of bareNpm and bareWorkkit in hooks/mods/unwatched.js.
read_already() {
  case "${1##*/} ${*:2}" in
    'workkit test'|'workkit prove'|'workkit prove '*|'workkit supervise'|'workkit supervise '*) return 0 ;;
    'npm test'|'npm run test') [ -z "$(git rev-parse --show-prefix 2>/dev/null)" ] ;;
    *) return 1 ;;
  esac
}

# supervise_body -- <command> [args...]: the detached run. Its last line is
# always `supervise: exit <code>`, the command's own code.
supervise_body() {
  local rc=0
  shift
  wk_body_traps supervise
  "$@" || rc=$?
  exit "$rc"
}

main() {
  local root log lock rc=0
  if [ "${1:-}" = --body ]; then
    shift
    load_libs
    supervise_body "$@"
  fi
  if [ "${1:-}" != -- ] || [ $# -lt 2 ]; then
    printf '%s\n' "$USAGE" >&2
    exit 2
  fi
  shift
  load_libs
  root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not inside a git repository"
  # Its supervisor would leave the session and so the outer one's reach.
  if read_already "$@"; then
    printf 'supervise: the supervisor reads %s already; run it without workkit supervise\n' "$*" >&2
    exit 2
  fi

  # Checked by the root's tests.check: a frozen run exits 124, and a look at an
  # unclear one 125 with the run on.
  log=$(wk_run_log_path "$root") || exit 1
  lock=$(wk_run_lock_path "$root") || exit 1
  wk_run_detached "$log" "$lock" --root "$root" -- "$BASH" "$SCRIPT_DIR/supervise.sh" --body -- "$@" || rc=$?
  if [ -n "$WK_HELD_PID" ]; then
    fail "a supervised run is already running (pid $WK_HELD_PID); its output is in $(wk_native_path "$log")"
  fi
  exit "$rc"
}

main "$@"
