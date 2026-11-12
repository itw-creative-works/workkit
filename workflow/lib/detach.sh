#!/usr/bin/env bash
# workflow/lib/detach.sh: the bash side of the detached runner (detach.js): a
# command that outlives the shell that started it, one per lock, its output
# tailed to this shell while it runs. Sourced, functions only, by
# script-shell.sh, prove.sh, supervise.sh, watch.sh and ship/watch.sh; it reads
# wk_pid_alive, wk_end_run, wk_node and wk_native_path from platform.sh.

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

# wk_run_live <lock>: 0, printing the supervisor's pid, while <lock> holds a run
# that is going: a pid file, no done file, and that pid alive. 1 otherwise.
wk_run_live() {
  local pid
  pid=$(cat "$1/pid" 2>/dev/null) || return 1
  if [ -z "$pid" ] || [ -f "$1/done" ] || ! wk_pid_alive "$pid"; then return 1; fi
  printf '%s\n' "$pid"
}

# wk_run_held <lock>: 0, printing the supervisor's pid, while <lock> holds a run
# whose answer no call has collected: a pid file, and that pid alive or its done
# file written. 1 otherwise.
wk_run_held() {
  local pid
  pid=$(cat "$1/pid" 2>/dev/null) || return 1
  if [ -z "$pid" ] || { [ ! -f "$1/done" ] && ! wk_pid_alive "$pid"; }; then return 1; fi
  printf '%s\n' "$pid"
}

# wk_take_run_lock <lock>: 0 holding <lock>, 3 when a live run holds it (its
# pid in WK_HELD_PID), 1 when it cannot be made. A run that is over (its done
# file written, its pid gone, or no pid 5s after the mkdir) is taken over; a
# done file gets 2s first, for the foreground that is collecting it.
wk_take_run_lock() {
  local lock="$1" tries=0 waited
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
    if WK_HELD_PID=$(wk_run_live "$lock"); then return 3; fi
    WK_HELD_PID=""
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
  # The last run's record is no answer for the new one.
  rm -f "$lock.done"
}

# _wk_leave_record <lock> <pid> <code>: `<pid> <code>` in <lock>.done, beside
# the lock folder, written whole and renamed, for a call attached to the same
# run that finds the lock already dropped.
_wk_leave_record() {
  printf '%s %s\n' "$2" "$3" > "$1.done.tmp.$$" && mv -f "$1.done.tmp.$$" "$1.done"
}

# _wk_recorded_code <lock> <pid>: the code <lock>.done records for supervisor
# <pid>, printed; 1 when there is no record or it is another run's.
_wk_recorded_code() {
  local held code
  { read -r held code < "$1.done"; } 2>/dev/null || return 1
  case "$code" in ''|*[!0-9]*) return 1 ;; esac
  [ "$held" = "$2" ] || return 1
  printf '%s\n' "$code"
}

# The seconds wk_ask_end waits on an end request.
WK_END_WAIT=30

# wk_ask_end <lock> <pid>: while <lock> holds <pid>, write the end request, then
# wait up to WK_END_WAIT seconds; 0 once the done file is written or <lock> holds
# another pid or none, 1 when the wait runs out or <pid> is gone with no done
# file. Prints nothing.
wk_ask_end() {
  local lock="$1" pid="$2" deadline=$(( SECONDS + WK_END_WAIT )) held
  held=$(cat "$lock/pid" 2>/dev/null) || held=""
  [ "$held" = "$pid" ] || return 0
  { : > "$lock/end"; } 2>/dev/null
  while :; do
    held=$(cat "$lock/pid" 2>/dev/null) || held=""
    if [ -f "$lock/done" ] || [ "$held" != "$pid" ]; then return 0; fi
    # The done file may land between the look above and the supervisor's exit.
    if ! wk_pid_alive "$pid"; then [ -f "$lock/done" ]; return; fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.2
  done
}

# _wk_end_on_int <lock> <pid>: wk_run_detached's INT. The supervisor ends the
# run on request, its code left as a record for another attached call; a run
# still going when the wait runs out loses its process group. Exits 130.
_wk_end_on_int() {
  local lock="$1" pid="$2" code
  trap '' INT
  if wk_ask_end "$lock" "$pid"; then
    code=$(cat "$lock/done" 2>/dev/null) || code=""
    case "$code" in ''|*[!0-9]*) ;; *) _wk_leave_record "$lock" "$pid" "$code" ;; esac
  else
    wk_end_run "$pid"
  fi
  _wk_drop_run_lock "$lock" "$pid"
  exit 130
}

# wk_run_detached <log> <lock> [--root <root>] -- <cmd> [args...]: run <cmd>
# through detach.js (checked by <root>'s tests.check when given) and attach to
# it from <log>'s first byte (wk_attach_run), whose answer is this one's. 3 with
# WK_HELD_PID set is a live run holding <lock>. INT ends the run (_wk_end_on_int).
wk_run_detached() {
  local log="$1" lock="$2" root=() checked=0 detach node=node pid rc=0 saved
  # shellcheck disable=SC2034  # read by the caller
  WK_HELD_PID="" WK_RAN_CODE="" WK_RAN_LOOK=""
  if [ "$#" -ge 4 ] && [ "$3" = --root ]; then
    root=(--root "$4")
    checked=1
    set -- "$1" "$2" "${@:5}"
  fi
  if [ "$#" -lt 4 ] || [ "$3" != -- ]; then
    printf 'usage: wk_run_detached <log> <lock> [--root <root>] -- <cmd> [args...]\n' >&2
    return 2
  fi
  shift 3
  wk_take_run_lock "$lock" || return
  detach="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/detach.js"
  # A root's settings loader needs the kit's node floor; a run without one, any node.
  if ! mkdir -p "${log%/*}"; then
    rc=1
  elif [ "$checked" -eq 1 ] && ! node=$(wk_node); then
    printf 'detach: no node at or above %s is installed to run %s\n' "$WK_NODE_FLOOR" "$detach" >&2
    rc=1
  else
    pid=$("$node" "$detach" "$log" "$lock/done" ${root[@]+"${root[@]}"} -- "$@") || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    rm -rf "$lock"
    printf 'detach: could not start %s (log %s)\n' "$1" "$log" >&2
    return "$rc"
  fi
  # Written whole and renamed, so a second run never reads a half-written pid.
  printf '%s\n' "$pid" > "$lock/pid.tmp" && mv -f "$lock/pid.tmp" "$lock/pid"

  saved=$(trap -p INT)
  # shellcheck disable=SC2064  # the pid and the lock are fixed for this run
  trap "_wk_end_on_int $(printf '%q' "$lock") $(printf '%q' "$pid")" INT
  wk_attach_run "$log" "$lock" "$pid" || rc=$?
  eval "${saved:-trap - INT}"
  return "$rc"
}

# wk_attach_run <log> <lock> <pid> [<offset>]: tail <log> from <offset> to <pid>'s
# done file (or, gone with it, the record <lock>.done), drop <lock>, return the
# code, also in WK_RAN_CODE (empty: the runner failed). A look prints and
# consumes the look file, keeps the lock, sets WK_RAN_LOOK=1, returns 125.
wk_attach_run() {
  local log="$1" lock="$2" pid="$3" off="${4:-0}" code look size polls=0
  # shellcheck disable=SC2034  # both read by the caller
  WK_RAN_CODE="" WK_RAN_LOOK=""
  # Done is read once, before the log, so the log read that follows is the
  # last; an empty read is a done file not written yet. A look is read beside it.
  while :; do
    code=$(cat "$lock/done" 2>/dev/null) || code=""
    look=0
    [ -n "$code" ] || [ ! -f "$lock/look" ] || look=1
    size=$(( $(wc -c < "$log") ))
    if [ "$size" -gt "$off" ]; then
      tail -c "+$(( off + 1 ))" "$log" | head -c "$(( size - off ))"
      off="$size"
    fi
    [ -n "$code" ] && break
    if [ "$look" -eq 1 ]; then
      cat "$lock/look" && rm -f "$lock/look"
      printf 'detach: the run goes on; read %s, then run workkit watch to keep waiting or workkit watch --end to end it (exit 125)\n' "$(wk_native_path "$log")"
      # shellcheck disable=SC2034  # read by the caller
      WK_RAN_LOOK=1
      return 125
    fi
    polls=$(( polls + 1 ))
    if { [ ! -d "$lock" ] || [ $(( polls % 25 )) -eq 0 ]; } && ! wk_pid_alive "$pid" && [ ! -f "$lock/done" ]; then
      _wk_drop_run_lock "$lock" "$pid"
      if code=$(_wk_recorded_code "$lock" "$pid"); then
        WK_RAN_CODE="$code"
        return "$code"
      fi
      printf 'detach: the run of supervisor %s ended without recording an exit code; its output is in %s\n' "$pid" "$log" >&2
      return 1
    fi
    sleep 0.2
  done
  case "$code" in
    *[!0-9]*)
      _wk_drop_run_lock "$lock" "$pid"
      printf 'detach: the done file held no exit code (%s)\n' "$code" >&2
      return 1
      ;;
  esac
  _wk_leave_record "$lock" "$pid" "$code"
  _wk_drop_run_lock "$lock" "$pid"
  WK_RAN_CODE="$code"
  return "$code"
}
