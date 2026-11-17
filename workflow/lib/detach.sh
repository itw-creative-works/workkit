#!/usr/bin/env bash
# workflow/lib/detach.sh: the bash side of the detached runner (detach.js): a
# command that outlives the shell that started it, one per lock, its output
# tailed to this shell while it runs. Sourced, functions only, by
# script-shell.sh, prove.sh, supervise.sh, watch.sh and ship/watch.sh; it reads
# wk_claim_dir, _wk_lock_tag (its WK_LOCK_TAG), wk_retire_judged, wk_retire_lock, wk_pid_alive, wk_end_run, wk_node and wk_native_path from platform.sh, and
# wk_color_on from voice.sh, which it sources when the caller has not.

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

# wk_supervised: 0 when a supervisor (detach.js) runs this process already,
# which it marks with WORKKIT_SUPERVISED=1, so nothing under it detaches again.
wk_supervised() { [ "${WORKKIT_SUPERVISED:-}" = 1 ]; }

# _wk_write_pid <lock> <pid>: <pid> as <lock>/pid, written whole and renamed, so
# a second run never reads a half-written pid.
_wk_write_pid() {
  printf '%s\n' "$2" > "$1/pid.tmp" && mv -f "$1/pid.tmp" "$1/pid"
}

# _wk_lock_pid <lock>: the supervisor's pid <lock>/pid holds, printed; 1 with no file.
_wk_lock_pid() {
  cat "$1/pid" 2>/dev/null
}

# _wk_lock_wait <path> <tenths> [pid]: wait up to <tenths> of a second while
# <path> (a lock, or one file in it) stands; with `pid`, only while the lock
# stands with no pid file.
_wk_lock_wait() {
  local waited=0
  while [ -e "$1" ] && { [ "${3:-}" != pid ] || [ ! -f "$1/pid" ]; } && [ "$waited" -lt "$2" ]; do
    sleep 0.1
    waited=$(( waited + 1 ))
  done
}

# _wk_drop_run_lock <lock> <pid>: retire <lock> only while <pid> holds it; a
# run that took it over has written its own pid there. The mark is read before
# the pid, so a lock taken over after that read keeps its own; none is adopted.
_wk_drop_run_lock() {
  wk_retire_judged "$1" _wk_held_by "$2" || :
}

# _wk_held_by <lock> <pid>: 0 while <lock>/pid holds <pid>.
_wk_held_by() {
  local held
  held=$(_wk_lock_pid "$1") || held=""
  [ "$held" = "$2" ]
}

# wk_run_live <lock>: 0, printing the supervisor's pid, while <lock> holds a run
# that is going: a pid file, no done file, and that pid alive. 1 otherwise.
wk_run_live() {
  local pid
  pid=$(_wk_lock_pid "$1") || return 1
  if [ -z "$pid" ] || [ -f "$1/done" ] || ! wk_pid_alive "$pid"; then return 1; fi
  printf '%s\n' "$pid"
}

# wk_run_held <lock>: 0, printing the supervisor's pid, while <lock> holds a run
# whose answer no call has collected: a pid file, and that pid alive or its done
# file written. 1 otherwise.
wk_run_held() {
  local pid
  pid=$(_wk_lock_pid "$1") || return 1
  if [ -z "$pid" ] || { [ ! -f "$1/done" ] && ! wk_pid_alive "$pid"; }; then return 1; fi
  printf '%s\n' "$pid"
}

# _wk_run_over <lock>: wk_take_run_lock's judge. 0 when <lock>'s run is over: its
# done file written (the folder given 2s first to go), its pid gone, or no pid
# 5s on. 3 with WK_HELD_PID set while a live run holds it; 1 when it went meanwhile.
_wk_run_over() {
  _wk_lock_wait "$1" 50 pid
  if WK_HELD_PID=$(wk_run_live "$1"); then return 3; fi
  WK_HELD_PID=""
  [ -f "$1/done" ] || return 0
  # The foreground collecting the done file drops the lock itself.
  _wk_lock_wait "$1" 20
  [ -d "$1" ]
}

# wk_take_run_lock <lock>: 0 holding <lock> (its mark in WK_LOCK_MARK), 3 when
# a live run holds it (its pid in WK_HELD_PID), 1 when it cannot be made. A run
# that is over (its done file written, its pid gone, or no pid 5s after the take)
# is taken over by its mark; a done file gets 2s first, for the foreground collecting it.
wk_take_run_lock() {
  local lock="$1" tries=0 own found mark
  WK_LOCK_MARK=""
  mkdir -p "${lock%/*}" || return 1
  until _wk_lock_tag && own="$WK_LOCK_TAG" && wk_claim_dir "$lock" "$own"; do
    tries=$(( tries + 1 ))
    if [ "$tries" -gt 3 ] || { [ -e "$lock" ] && [ ! -d "$lock" ]; }; then
      printf 'detach: could not take the lock %s\n' "$lock" >&2
      return 1
    fi
    # Gone between the failed take and this look: its run just ended.
    [ -e "$lock" ] || continue
    # Any answer but 3 and 4 (a removal lost to another caller included) is judged again.
    found=0
    wk_retire_judged "$lock" _wk_run_over || found=$?
    [ "$found" -ne 3 ] || return 3
    if [ "$found" -eq 4 ]; then
      # A live remover's gone mark gets the 5s a pid gets to go, at no try's cost;
      # whatever stands after it (none, a new lock) is judged on the next pass.
      tries=$(( tries - 1 ))
      mark=$(wk_lock_mark "$lock") || mark=""
      case "$mark" in gone.*) ;; *) continue ;; esac
      _wk_lock_wait "$lock/$mark" 50
      if [ -e "$lock/$mark" ]; then
        printf 'detach: could not take the lock %s\n' "$lock" >&2
        return 1
      fi
    fi
  done
  WK_LOCK_MARK="id.$own"
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

# _wk_gone_answer <lock> <pid>: wk_ask_end's answer once supervisor <pid> is
# gone, the lock read once more: 0 for a done file or a lock holding another pid
# or none, 2 for neither. A gone supervisor wrote any done file it will, so the
# done file is looked at before the pid, which the drop that follows it clears.
_wk_gone_answer() {
  local held
  [ ! -f "$1/done" ] || return 0
  held=$(_wk_lock_pid "$1") || held=""
  [ "$held" != "$2" ] || return 2
}

# wk_ask_end <lock> <pid>: while <lock> holds <pid>, write the end request, then
# wait up to WK_END_WAIT seconds; 0 once the done file is written or <lock> holds
# another pid or none, 1 when the wait runs out, 2 when <pid> is gone, <lock>
# still holds it and no done file is there. Prints nothing.
wk_ask_end() {
  local lock="$1" pid="$2" deadline=$(( SECONDS + WK_END_WAIT )) held
  held=$(_wk_lock_pid "$lock") || held=""
  [ "$held" = "$pid" ] || return 0
  # A supervisor gone already gets no end request: its lock stays as it was.
  wk_pid_alive "$pid" || { _wk_gone_answer "$lock" "$pid"; return; }
  { : > "$lock/end"; } 2>/dev/null
  while :; do
    held=$(_wk_lock_pid "$lock") || held=""
    if [ -f "$lock/done" ] || [ "$held" != "$pid" ]; then return 0; fi
    # The run may have ended and its lock been dropped between the look above and this one.
    if ! wk_pid_alive "$pid"; then
      _wk_gone_answer "$lock" "$pid"
      return
    fi
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 0.2
  done
}

# _wk_end_on_int <lock> <pid>: wk_run_detached's INT. The supervisor ends the
# run on request, its code left as a record for another attached call; a run
# still going when the wait runs out loses its process group, and keeps its lock
# when that end fails, since it still runs. Exits 130.
_wk_end_on_int() {
  local lock="$1" pid="$2" code ended=1
  trap '' INT
  if wk_ask_end "$lock" "$pid"; then
    code=$(cat "$lock/done" 2>/dev/null) || code=""
    case "$code" in ''|*[!0-9]*) ;; *) _wk_leave_record "$lock" "$pid" "$code" ;; esac
  elif ! wk_end_run "$pid"; then
    ended=0
  fi
  [ "$ended" -eq 0 ] || _wk_drop_run_lock "$lock" "$pid"
  # shellcheck disable=SC2034  # read by the caller's EXIT trap
  WK_RAN_INT=1
  exit 130
}

# _wk_run_foreground <log> <lock> <cmd> [args...]: wk_run_detached under a
# supervisor already: <cmd> runs here, on stdout and in <log>, <lock> held and
# marked `foreground` for its length; under the enclosing run's own lock
# (WK_RUN_LOCK) it runs bare. Returns its code; a lock another live run holds is 3.
_wk_run_foreground() {
  local log="$1" lock="$2" own=0 pid=$$ rc=0
  shift 2
  if [ "$lock" != "${WK_RUN_LOCK:-}" ]; then
    wk_take_run_lock "$lock" || return
    # Before the pid, so no watch reads this lock unmarked: no supervisor reads its
    # end file. It names the enclosing run's lock, whose end ends this command too.
    printf '%s\n' "${WK_RUN_LOCK:-}" > "$lock/foreground"
    # Git Bash: wk_pid_alive asks Windows, so the pid file holds this shell's Windows pid.
    if [ -r "/proc/$$/winpid" ]; then pid=$(cat "/proc/$$/winpid"); fi
    _wk_write_pid "$lock" "$pid"
    own=1
  fi
  # The enclosing run's own lock means its log is this stdout, already open.
  if [ "$own" -eq 0 ]; then
    "$@" || rc=$?
  else
    mkdir -p "${log%/*}" 2>/dev/null || :
    "$@" 2>&1 | tee "$log"
    rc=${PIPESTATUS[0]}
  fi
  # Ended as a detached run ends, so a watch attached to <lock> gets the code.
  if [ "$own" -eq 1 ]; then
    printf '%s\n' "$rc" > "$lock/done.tmp" && mv -f "$lock/done.tmp" "$lock/done"
    _wk_leave_record "$lock" "$pid" "$rc"
    _wk_drop_run_lock "$lock" "$pid"
  fi
  # shellcheck disable=SC2034  # read by the caller
  WK_RAN_CODE="$rc"
  return "$rc"
}

# wk_run_detached <log> <lock> [--root <root>] -- <cmd> [args...]: <cmd> through
# detach.js (checked by <root>'s tests.check), attached from <log>'s first byte;
# 3 with WK_HELD_PID set is a live holder of <lock>. INT ends the run, setting
# WK_RAN_INT; under WORKKIT_SUPERVISED=1 it runs here (_wk_run_foreground).
wk_run_detached() {
  local log="$1" lock="$2" root=() checked=0 detach node=node pid rc=0 saved_int saved_hup_term mark retire
  # shellcheck disable=SC2034  # read by the caller
  WK_HELD_PID="" WK_RAN_CODE="" WK_RAN_LOOK="" WK_RAN_INT=""
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
  # A supervisor started inside another would leave the outer one's reach.
  if wk_supervised; then
    _wk_run_foreground "$log" "$lock" "$@"
    return
  fi
  wk_take_run_lock "$lock" || return
  # Until the supervisor's pid is written, a signal retires the pidless lock by
  # its mark, so the next call takes it at once. The caller's traps come back after.
  mark="$WK_LOCK_MARK"
  retire="wk_retire_lock $(printf '%q' "$lock") $(printf '%q' "$mark") || :"
  saved_int=$(trap -p INT)
  saved_hup_term=$(trap -p HUP TERM)
  # shellcheck disable=SC2064  # the lock and its mark are fixed for this run
  trap "$retire; exit 129" HUP
  # shellcheck disable=SC2064
  trap "$retire; WK_RAN_INT=1; exit 130" INT
  # shellcheck disable=SC2064
  trap "$retire; exit 143" TERM
  detach="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/detach.js"
  # A root's settings loader needs the kit's node floor; a run without one, any node.
  if ! mkdir -p "${log%/*}"; then
    rc=1
  elif [ "$checked" -eq 1 ] && ! node=$(wk_node); then
    printf 'detach: no node at or above %s is installed to run %s\n' "$WK_NODE_FLOOR" "$detach" >&2
    rc=1
  else
    # The run's own lock, so a call inside it under the same lock runs in its stead.
    pid=$(WK_RUN_LOCK="$lock" "$node" "$detach" "$log" "$lock/done" ${root[@]+"${root[@]}"} -- "$@") || rc=$?
  fi
  if [ "$rc" -ne 0 ]; then
    wk_retire_lock "$lock" "$mark" || :
    trap - HUP INT TERM
    eval "$saved_int"
    eval "$saved_hup_term"
    printf 'detach: could not start %s (log %s)\n' "$1" "$log" >&2
    return "$rc"
  fi
  _wk_write_pid "$lock" "$pid"

  # shellcheck disable=SC2064  # the pid and the lock are fixed for this run
  trap "_wk_end_on_int $(printf '%q' "$lock") $(printf '%q' "$pid")" INT
  trap - HUP TERM
  eval "$saved_hup_term"
  wk_attach_run "$log" "$lock" "$pid" || rc=$?
  eval "${saved_int:-trap - INT}"
  return "$rc"
}

# wk_view_paints: 0 when the view of a run on this stdout is painted: the kit's
# color gate says yes, and the painter's filter and a node at the kit's floor
# are here, set in WK_VIEW_PAINT and WK_VIEW_NODE for wk_view_paint.
wk_view_paints() {
  declare -F wk_color_on >/dev/null || . "${BASH_SOURCE[0]%/*}/voice.sh"
  wk_color_on || return 1
  WK_VIEW_PAINT="$(cd "${BASH_SOURCE[0]%/*}/../.." && pwd -P)/packages/core/test/lib/paint.js"
  [ -f "$WK_VIEW_PAINT" ] && WK_VIEW_NODE=$(wk_node)
}

# wk_view_paint: standard input to standard output through the painter's
# filter, each whole line painted. The gate judged the caller's stdout already,
# and this one may be a pipe, so the color is forced.
wk_view_paint() {
  FORCE_COLOR=1 "$WK_VIEW_NODE" "$WK_VIEW_PAINT"
}

# wk_attach_run <log> <lock> <pid> [<offset>]: tail <log> from <offset>, painted
# when wk_view_paints says so, to <pid>'s done file (or the record <lock>.done),
# drop <lock>, return the code, also in WK_RAN_CODE (empty: the runner failed). A
# look prints and consumes the look file, keeps the lock, sets WK_RAN_LOOK=1, 125.
wk_attach_run() {
  local state rc gone saved_int
  if ! wk_view_paints; then
    _wk_attach_tail "$@"
    return
  fi
  # A Ctrl-C is only noted while the tail runs, then handed to the caller's own
  # INT disposition: its trap, or bash's own end by the signal.
  saved_int=$(trap -p INT)
  WK_VIEW_INT=""
  trap 'WK_VIEW_INT=1' INT
  # The tail runs in the pipe's subshell, its answer back on fd 4 (`<code>
  # <WK_RAN_CODE> <WK_RAN_LOOK> <gone>`, `-` for empty), the painted lines on fd 3.
  # Its own INT trap ends it every time; bash's default may let it run on.
  { state=$( { { trap 'exit 130' INT; set +o pipefail; WK_TAIL_PIPED=1; WK_TAIL_GONE=""
    _wk_attach_tail "$@"
    printf '%s %s %s %s\n' "$?" "${WK_RAN_CODE:--}" "${WK_RAN_LOOK:--}" "${WK_TAIL_GONE:--}" >&4
  } | wk_view_paint >&3; } 4>&1 ); } 3>&1
  eval "${saved_int:-trap - INT}"
  if [ -n "$WK_VIEW_INT" ]; then kill -INT $$; fi
  read -r rc WK_RAN_CODE WK_RAN_LOOK gone <<<"$state"
  [ "$WK_RAN_CODE" != - ] || WK_RAN_CODE=""
  [ "$WK_RAN_LOOK" != - ] || WK_RAN_LOOK=""
  if [ "$gone" = 1 ]; then
    printf 'detach: the painted view of the run ended, so this call stops; the run goes on, and workkit watch follows it\n' >&2
  fi
  return "${rc:-1}"
}

# _wk_attach_tail: wk_attach_run's tail itself, the log's bytes on stdout.
_wk_attach_tail() {
  # The look line names `workkit watch` with the caller's WK_WATCH_NAME, when set.
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
      if [ -z "${WK_TAIL_PIPED:-}" ]; then
        tail -c "+$(( off + 1 ))" "$log" | head -c "$(( size - off ))"
      # Painted, a filter that is gone ends the tail quietly, the lock kept for a watch.
      elif ! tail -c "+$(( off + 1 ))" "$log" | head -c "$(( size - off ))" 2>/dev/null; then
        WK_TAIL_GONE=1
        return 1
      fi
      off="$size"
    fi
    [ -n "$code" ] && break
    if [ "$look" -eq 1 ]; then
      cat "$lock/look" && rm -f "$lock/look"
      printf 'detach: the run goes on; read %s, then run workkit watch%s to keep waiting or workkit watch --end%s to end it (exit 125)\n' \
        "$(wk_native_path "$log")" "${WK_WATCH_NAME:+ $WK_WATCH_NAME}" "${WK_WATCH_NAME:+ $WK_WATCH_NAME}"
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
