#!/usr/bin/env bash
# workflow/lib/detach.sh: the bash side of the detached runner (detach.js): a
# command that outlives the shell that started it, one per lock, its output
# tailed to this shell while it runs. Sourced, functions only, by
# script-shell.sh and ship/ci-watch.sh; it reads wk_pid_alive and wk_end_run
# from platform.sh.

# wk_body_traps <prefix> [<before-exit command>]: a detached body's traps. Its
# last line is always `<prefix>: exit <code>`, after the optional command; bash
# runs EXIT on a fatal signal with a stale $?, so each signal names its code.
wk_body_traps() {
  # shellcheck disable=SC2064,SC2154  # fixed per body; the trap sets the code
  trap "wk_body_code=\$?; ${2:+$2; }printf '%s: exit %s\\n' $(printf '%q' "$1") \"\$wk_body_code\"" EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

# _wk_drop_run_lock <lock> <pid>: remove <lock> only while <pid> holds it; a
# run that took it over has written its own pid there.
_wk_drop_run_lock() {
  local held
  held=$(cat "$1/pid" 2>/dev/null) || held=""
  if [ "$held" = "$2" ]; then rm -rf "$1"; fi
}

# wk_take_run_lock <lock>: 0 holding <lock>, 3 when a live run holds it (its
# pid in WK_HELD_PID), 1 when it cannot be made. A run that is over (its done
# file written, its pid gone, or no pid 5s after the mkdir) is taken over; a
# done file gets 2s first, for the foreground that is collecting it.
wk_take_run_lock() {
  local lock="$1" pid tries=0 waited
  mkdir -p "${lock%/*}" || return 1
  until mkdir "$lock" 2>/dev/null; do
    tries=$(( tries + 1 ))
    if [ "$tries" -gt 3 ] || { [ -e "$lock" ] && [ ! -d "$lock" ]; }; then
      printf 'detach: could not take the lock %s\n' "$lock" >&2
      return 1
    fi
    # Gone between the failed mkdir and this look: its run just ended.
    [ -e "$lock" ] || continue
    waited=0
    while [ -d "$lock" ] && [ ! -f "$lock/pid" ] && [ "$waited" -lt 50 ]; do
      sleep 0.1
      waited=$(( waited + 1 ))
    done
    pid=$(cat "$lock/pid" 2>/dev/null) || pid=""
    if [ -n "$pid" ] && [ ! -f "$lock/done" ] && wk_pid_alive "$pid"; then
      WK_HELD_PID="$pid"
      return 3
    fi
    if [ -f "$lock/done" ]; then
      waited=0
      while [ -d "$lock" ] && [ "$waited" -lt 20 ]; do
        sleep 0.1
        waited=$(( waited + 1 ))
      done
      [ -d "$lock" ] || continue
    fi
    rm -rf "$lock"
  done
}

# wk_run_detached <log> <lock> -- <cmd> [args...]: run <cmd> through detach.js,
# tail <log> from its first byte, and return the code it recorded, also left in
# WK_RAN_CODE: empty there means the runner failed and <cmd> gave no answer.
# 3 with WK_HELD_PID set is a live run holding <lock>. INT ends the run, 130.
wk_run_detached() {
  local log="$1" lock="$2" detach pid code size off=0 polls=0 saved
  # shellcheck disable=SC2034  # both read by the caller
  WK_HELD_PID="" WK_RAN_CODE=""
  if [ "$#" -lt 4 ] || [ "$3" != -- ]; then
    printf 'usage: wk_run_detached <log> <lock> -- <cmd> [args...]\n' >&2
    return 2
  fi
  shift 3
  wk_take_run_lock "$lock" || return
  detach="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/detach.js"
  if ! mkdir -p "${log%/*}" || ! pid=$(node "$detach" "$log" "$lock/done" -- "$@"); then
    rm -rf "$lock"
    printf 'detach: could not start %s (log %s)\n' "$1" "$log" >&2
    return 1
  fi
  # Written whole and renamed, so a second run never reads a half-written pid.
  printf '%s\n' "$pid" > "$lock/pid.tmp" && mv -f "$lock/pid.tmp" "$lock/pid"

  saved=$(trap -p INT)
  # shellcheck disable=SC2064  # the pid and the lock are fixed for this run
  trap "trap '' INT; wk_end_run $(printf '%q' "$pid"); _wk_drop_run_lock $(printf '%q' "$lock") $(printf '%q' "$pid"); exit 130" INT
  # Done is read once, before the log, so the log read that follows is the
  # last; an empty read is a done file not written yet.
  while :; do
    code=$(cat "$lock/done" 2>/dev/null) || code=""
    size=$(( $(wc -c < "$log") ))
    if [ "$size" -gt "$off" ]; then
      tail -c "+$(( off + 1 ))" "$log" | head -c "$(( size - off ))"
      off="$size"
    fi
    [ -n "$code" ] && break
    polls=$(( polls + 1 ))
    if [ $(( polls % 25 )) -eq 0 ] && ! wk_pid_alive "$pid" && [ ! -f "$lock/done" ]; then
      eval "${saved:-trap - INT}"
      _wk_drop_run_lock "$lock" "$pid"
      printf 'detach: %s ended without recording an exit code; its output is in %s\n' "$1" "$log" >&2
      return 1
    fi
    sleep 0.2
  done
  eval "${saved:-trap - INT}"
  _wk_drop_run_lock "$lock" "$pid"
  case "$code" in
    *[!0-9]*)
      printf 'detach: the done file held no exit code (%s)\n' "$code" >&2
      return 1
      ;;
  esac
  WK_RAN_CODE="$code"
  return "$code"
}
