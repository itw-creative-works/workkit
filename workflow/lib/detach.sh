#!/usr/bin/env bash
# workflow/lib/detach.sh: the shell's names for a detached run (lib/runs.js): a
# command that outlives the shell that started it, one per lock, its output
# tailed to this shell while it runs; each name is a call into Node, through
# _wk_runs, that hands back its answers. Sourced, functions only, by script-shell.sh
# and suite.sh's sweep; it reads wk_node, WK_NODE_FLOOR and wk_native_path from platform.sh.

# wk_body_traps <prefix> [<before-exit command>]: a detached body's traps. Its
# last line is always `<prefix>: exit <code>`, after the optional command; bash
# runs EXIT on a fatal signal with a stale $?, so each signal names its code.
# The Node bodies' twin is bodyEnd in lib/body.js.
wk_body_traps() {
  # shellcheck disable=SC2064,SC2154  # fixed per body; the trap sets the code
  trap "wk_body_code=\$?; ${2:+$2; }printf '%s: exit %s\\n' $(printf '%q' "$1") \"\$wk_body_code\"" EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# wk_supervised: 0 when a supervisor (detach.js) runs this process already,
# which it marks with WORKKIT_SUPERVISED=1, so nothing under it detaches again.
wk_supervised() { [ "${WORKKIT_SUPERVISED:-}" = 1 ]; }

# _wk_runs <verb> <arg>...: the one start of `runs.js <verb>`: the node chosen, and
# for `run` `--answer <file>` placed and read back into WK_HELD_PID,
# WK_RAN_CODE, WK_RAN_LOOK and WK_RAN_INT. A HUP, INT or TERM here reaches the command,
# then ends this shell: HUP 129, TERM 143, INT 130 on `int=1`, else through the caller's.
_wk_runs() {
  local verb="$1" lib node floor=0 n="" answer="" pid="" rc=1 saved sig="" held="" code="" look="" int=""
  shift
  lib="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)"
  if [ "$verb" = run ]; then
    n=2
    if [ "${3:-}" = --root ]; then n=4 floor=1; fi
  fi
  # shellcheck disable=SC2034  # read by the caller, empty for a call that never ran
  [ -z "$n" ] || WK_HELD_PID="" WK_RAN_CODE="" WK_RAN_LOOK="" WK_RAN_INT=""
  # A root's settings loader needs the kit's node floor; any other call takes
  # wk_node's pick when one fits, else any node.
  if [ "$floor" -eq 1 ] && ! node=$(wk_node); then
    # Under a supervisor already the command still runs, here, with no lock and no log.
    if wk_supervised; then
      printf 'detach: no node at or above %s is installed, so %s runs here without its lock\n' "$WK_NODE_FLOOR" "${6:-}" >&2
      rc=0
      "${@:6}" || rc=$?
      WK_RAN_CODE="$rc"
      return "$rc"
    fi
    printf 'detach: no node at or above %s is installed to run %s\n' "$WK_NODE_FLOOR" "$lib/detach.js" >&2
    printf 'detach: could not start %s (log %s)\n' "${6:-}" "$1" >&2
    return 1
  elif [ "$floor" -eq 0 ] && ! node=$(wk_node) && ! node=$(command -v node); then
    printf 'detach: no node is installed to run %s\n' "$(wk_native_path "$lib/runs.js")" >&2
    [ "$verb" = run ] || return 1
    # A run never started answers as a command the shell cannot find.
    printf 'detach: could not start %s (log %s)\n' "${4:-}" "$1" >&2
    return 127
  fi
  if [ -n "$n" ]; then
    answer=$(mktemp) || return 1
    set -- "${@:1:n}" --answer "$answer" "${@:$((n + 1))}"
  fi
  # Set before the start, so no signal leaves a command with no shell. Each passes
  # its signal on once and ignores the next, which the command answers.
  saved=$(trap -p HUP INT TERM)
  # shellcheck disable=SC2016  # read when the signal comes
  trap 'sig=HUP; [ -z "$pid" ] || kill -HUP "$pid" 2>/dev/null; trap "" HUP INT TERM' HUP
  # shellcheck disable=SC2016
  trap 'sig=INT; [ -z "$pid" ] || kill -INT "$pid" 2>/dev/null; trap "" HUP INT TERM' INT
  # shellcheck disable=SC2016
  trap 'sig=TERM; [ -z "$pid" ] || kill -TERM "$pid" 2>/dev/null; trap "" HUP INT TERM' TERM
  if [ -z "$sig" ]; then
    WK_WATCH_NAME="${WK_WATCH_NAME:-}" WK_END_WAIT="${WK_END_WAIT:-}" WK_LAUNCH_WAIT="${WK_LAUNCH_WAIT:-}" \
      "$node" "$lib/runs.js" "$verb" "$@" 0<&0 &
    pid=$!
    rc=0
    # A signal that came between the start and the pid is passed on here.
    [ -z "$sig" ] || kill -"$sig" "$pid" 2>/dev/null
    wait "$pid" || rc=$?
    # A signal ends the wait above early; the command's own code comes from this
    # one, which bash answers for a child it collected already too.
    if [ -n "$sig" ]; then
      rc=0
      wait "$pid" || rc=$?
    fi
  fi
  trap - HUP INT TERM
  eval "$saved"
  if [ -n "$answer" ]; then
    # shellcheck source=/dev/null  # runs.js's answers, a line each: held=, code=, look=, int=
    . "$answer"
    rm -f "$answer"
    # shellcheck disable=SC2034  # read by the caller and its EXIT trap
    WK_HELD_PID="$held" WK_RAN_CODE="$code" WK_RAN_LOOK="$look" WK_RAN_INT="$int"
  fi
  case "$sig" in
    HUP) exit 129 ;;
    TERM) exit 143 ;;
    INT)
      [ "$int" != 1 ] || exit 130
      # A foreground run that answered its command's code goes on with it.
      [ -n "$code" ] || kill -INT $$
      ;;
  esac
  return "$rc"
}

# wk_run_detached <log> <lock> [--root <root>] -- <cmd> [args...]: `runs.js run`,
# <cmd> run detached (checked by <root>'s tests.check) and attached from <log>'s
# first byte; its code back, in WK_RAN_CODE too, 3 with WK_HELD_PID set for a live
# holder of <lock>. An INT ends the run and exits 130 with WK_RAN_INT=1.
wk_run_detached() { _wk_runs run "$@"; }
