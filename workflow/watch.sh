#!/usr/bin/env bash
# workflow/watch.sh: `workkit watch [--end] [suite|run|<pid>]`, the call attached
# again to the repo's live run, or one that ended with no call attached: the
# one named, else the suite's, else the supervised one, else the one live
# narrowed run. It follows the log to the run's end, a frozen end or the next
# look (wk_attach_run); --end asks the supervisor to end the run instead.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

USAGE='usage: workkit watch [--end] [suite|run|<pid>]'

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
}

# drop_slot <root> <slot>: a narrowed run's slot cleared once its end is read,
# unless its wrapper (the pid naming the slot, kill -0 in Git Bash too) still
# runs: that call is attached, needs the record, and clears the slot itself.
drop_slot() {
  [ -n "$2" ] || return 0
  if kill -0 "$2" 2>/dev/null; then return 0; fi
  wk_test_slot_clear "$1" "$2"
}

# refuse_foreground <root> <lock> <name>: --end <name> on a run held in the
# foreground (_wk_run_foreground), whose end file no supervisor reads. It names
# the call that ends the enclosing run its marker holds; exit 1.
refuse_foreground() {
  local enclosing how='end the run that started it'
  # Compared as folders: the native programs the marker's path crossed may
  # respell it (D:/a for /d/a), and wk_posix_path folds every spelling to one.
  enclosing=$(cat "$2/foreground" 2>/dev/null) || enclosing=""
  if [ -n "$enclosing" ]; then enclosing=$(wk_posix_path "$enclosing") || enclosing=""; fi
  if [ -n "$enclosing" ] && [ "$enclosing" = "$(wk_posix_path "$(wk_run_lock_path "$1")")" ]; then
    how='workkit watch --end run ends it'
  elif [ -n "$enclosing" ] && [ "$enclosing" = "$(wk_posix_path "$(wk_suite_lock_path "$1")")" ]; then
    how='workkit watch --end suite ends it'
  fi
  fail "workkit watch --end $3 cannot end a run held in the foreground inside another run; $how"
}

no_run() {
  fail "no run is live in $(wk_native_path "$1")"
}

# lock_of <root> <run>: the lock of suite, run, or a narrowed run's slot.
lock_of() {
  case "$2" in
    suite) wk_suite_lock_path "$1" ;;
    run) wk_run_lock_path "$1" ;;
    *) wk_test_lock_path "$1" "$2" ;;
  esac
}

# runs_where <root> <check>: each run whose lock <check> (wk_run_held or
# wk_run_live) passes, one per line: suite, run, then each narrowed run's slot.
runs_where() {
  local run
  while IFS= read -r run; do
    if [ -n "$run" ] && "$2" "$(lock_of "$1" "$run")" >/dev/null; then printf '%s\n' "$run"; fi
  done < <(printf 'suite\nrun\n'; wk_test_pids "$1")
}

# name_one <verb> <name>...: the refusal that never guesses between live runs,
# each named in the call that picks it; exit 2.
name_one() {
  local verb="$1" words=([2]=two three four five six seven eight nine) sep=' ' name
  shift
  printf 'watch: %s runs are live; name one:' "${words[$#]:-$#}" >&2
  for name in "$@"; do
    printf '%s%s %s' "$sep" "$verb" "$name" >&2
    sep=', or '
  done
  printf '\n' >&2
  exit 2
}

main() {
  local end=0 name="" slot="" root which log lock pid size rc=0 verb="workkit watch" run live=() running=()
  if [ "${1:-}" = --end ]; then end=1 verb="workkit watch --end"; shift; fi
  case "${1:-}" in
    suite|run) name="$1"; shift ;;
    ''|*[!0-9]*) ;;
    *) name='test' slot="$1"; shift ;;
  esac
  if [ $# -gt 0 ]; then
    printf '%s\n' "$USAGE" >&2
    exit 2
  fi
  load_libs
  root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "not inside a git repository"

  # A run that ended after a look counts as live here: its answer waits in its lock.
  if [ -n "$name" ]; then
    which="$name"
  else
    while IFS= read -r run; do live+=("$run"); done < <(runs_where "$root" wk_run_held)
    [ "${#live[@]}" -gt 0 ] || no_run "$root"
    if [ "$end" -eq 1 ]; then
      # An end never guesses between running runs; one that finished, its answer
      # uncollected, cannot be ended and is taken only when none runs. Nor can
      # one held in the foreground, which ends with the run that holds it.
      while IFS= read -r run; do
        [ -f "$(lock_of "$root" "$run")/foreground" ] || running+=("$run")
      done < <(runs_where "$root" wk_run_live)
      [ "${#running[@]}" -le 1 ] || name_one "$verb" "${running[@]}"
      [ "${#running[@]}" -eq 0 ] || live=("${running[0]}")
    else
      # A follow takes the suite's, then the supervised one, then the one narrowed run.
      case "${live[0]}" in
        suite|run) ;;
        *) [ "${#live[@]}" -eq 1 ] || name_one "$verb" "${live[@]}" ;;
      esac
    fi
    case "${live[0]}" in
      suite|run) which="${live[0]}" slot="" ;;
      *) which='test' slot="${live[0]}" ;;
    esac
  fi
  lock=$("wk_${which}_lock_path" "$root" "$slot") || exit 1
  pid=$(wk_run_held "$lock") || no_run "$root"
  log=$("wk_${which}_log_path" "$root" "$slot") || exit 1
  # shellcheck disable=SC2034  # read by wk_attach_run's look line
  WK_WATCH_NAME="$slot"

  if [ "$end" -eq 1 ] && [ -f "$lock/done" ]; then
    collect "$log" "$lock" "$pid"
    drop_slot "$root" "$slot"
    [ -n "$WK_RAN_CODE" ] || exit 1
    printf 'watch: the run ended already (exit %s)\n' "$WK_RAN_CODE"
    exit 0
  fi
  if [ "$end" -eq 1 ]; then
    [ ! -f "$lock/foreground" ] || refuse_foreground "$root" "$lock" "${slot:-$which}"
    end_run "$log" "$lock" "$pid"
    drop_slot "$root" "$slot"
    exit 0
  fi
  # The size first, so the last lines and the tail from it never overlap.
  size=$(( $(wc -c < "$log") ))
  head -c "$size" "$log" | tail -n 20
  wk_attach_run "$log" "$lock" "$pid" "$size" || rc=$?
  # A narrowed run's slot goes once its end is read; a look keeps it.
  [ "$WK_RAN_LOOK" = 1 ] || drop_slot "$root" "$slot"
  exit "$rc"
}

main "$@"
