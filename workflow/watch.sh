#!/usr/bin/env bash
# workflow/watch.sh: `workkit watch [--end] [suite|run]`, the call attached
# again to the repo's live run, or one that ended with no call attached: the
# one named, else the suite's, else the supervised one. It follows the log to
# the run's end, a frozen end or the next look (wk_attach_run); --end asks the
# supervisor to end the run instead.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

USAGE='usage: workkit watch [--end] [suite|run]'

fail() {
  printf 'watch: %s\n' "$1" >&2
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

# collect <log> <lock> <pid>: the code of a run whose done file is written, in
# WK_RAN_CODE, taken through wk_attach_run from the log's end: the lock drops,
# and a call still attached reads the code from the record it leaves.
collect() {
  wk_attach_run "$1" "$2" "$3" "$(( $(wc -c < "$1") ))" > /dev/null || :
}

# end_run <log> <lock> <pid>: the end request and its wait (wk_ask_end), for
# the done file or the lock dropped by the call attached to the run once it read it.
end_run() {
  local log="$1" lock="$2" pid="$3"
  wk_ask_end "$lock" "$pid" || fail "the run did not end; its supervisor is pid $pid"
  [ ! -f "$lock/done" ] || collect "$log" "$lock" "$pid"
  tail -n 1 "$log"
  exit 0
}

main() {
  local end=0 name="" root which log lock pid size rc=0 suite_pid="" run_pid=""
  if [ "${1:-}" = --end ]; then end=1; shift; fi
  case "${1:-}" in suite|run) name="$1"; shift ;; esac
  if [ $# -gt 0 ]; then
    printf '%s\n' "$USAGE" >&2
    exit 2
  fi
  load_libs
  root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not inside a git repository"

  # A run that ended after a look counts as live here: its answer waits in its lock.
  [ "$name" = run ] || suite_pid=$(wk_run_held "$(wk_suite_lock_path "$root")") || suite_pid=""
  [ "$name" = suite ] || run_pid=$(wk_run_held "$(wk_run_lock_path "$root")") || run_pid=""
  # An end with no name never guesses between two live runs.
  if [ "$end" -eq 1 ] && [ -n "$suite_pid" ] && [ -n "$run_pid" ]; then
    printf 'watch: two runs are live; name one: workkit watch --end suite, or workkit watch --end run\n' >&2
    exit 2
  fi
  if [ -n "$suite_pid" ]; then
    which=suite pid="$suite_pid"
  elif [ -n "$run_pid" ]; then
    which=run pid="$run_pid"
  else
    fail "no run is live in $(wk_native_path "$root")"
  fi
  log=$("wk_${which}_log_path" "$root") || exit 1
  lock=$("wk_${which}_lock_path" "$root") || exit 1

  if [ "$end" -eq 1 ] && [ -f "$lock/done" ]; then
    collect "$log" "$lock" "$pid"
    [ -n "$WK_RAN_CODE" ] || exit 1
    printf 'watch: the run ended already (exit %s)\n' "$WK_RAN_CODE"
    exit 0
  fi
  [ "$end" -eq 0 ] || end_run "$log" "$lock" "$pid"
  # The size first, so the last lines and the tail from it never overlap.
  size=$(( $(wc -c < "$log") ))
  head -c "$size" "$log" | tail -n 20
  wk_attach_run "$log" "$lock" "$pid" "$size" || rc=$?
  exit "$rc"
}

main "$@"
