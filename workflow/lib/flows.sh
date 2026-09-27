#!/usr/bin/env bash
# workflow/lib/flows.sh: the browser flows and the atomic link maker. Sourced by
# lib.sh, functions only. Reads lib.sh's WK_C_* palette, WK_LOG_INDENT,
# WK_SPIN_FRAMES and WK_POLL_PID; calls wk_opener (lib/voice.sh) and wk_mv_link
# (platform.sh).

# ── Browser flows ─────────────────────────────────────────────────────────────
# omega's walkthrough shape (`packages/devkit/src/flows.js`,
# `openBrowserAndPoll`), for a caller that already knows it has a terminal.

# The URL is printed either way, so a machine with no opener still has it.
# Usage: wk_enter_to_open <url> <label> <what to do there>
wk_enter_to_open() {
  local url="$1" label="$2" prompt="$3" opener answer=''
  # The palette's codes go in the format string, never a %s argument.
  printf "\n%s%s\n%sURL: ${WK_C_CYAN}%s${WK_C_OFF}\n\n" "$WK_LOG_INDENT" "$prompt" "$WK_LOG_INDENT" "$url" >&2
  printf "${WK_C_GREEN}?${WK_C_OFF} Press Enter to open %s in your browser... " "$label" >&2
  read -r answer || true
  if opener="$(wk_opener)"; then
    "$opener" "$url" >/dev/null 2>&1 || true
  else
    printf "%s${WK_C_DIM}(no browser could be launched: open the URL above by hand)${WK_C_OFF}\n" "$WK_LOG_INDENT" >&2
  fi
  return 0
}

# The countdown frame of a poll, run as a background job by wk_poll below: the
# spinner, the message, and the seconds left until the next check.
wk_poll_draw() {
  local msg="$1" deadline="$2" i=0 left frame
  while :; do
    frame="${WK_SPIN_FRAMES[$(( i % ${#WK_SPIN_FRAMES[@]} ))]}"
    left=$(( deadline - $(date +%s) ))
    if [[ "$left" -lt 0 ]]; then left=0; fi
    printf "\r%s${WK_C_CYAN}%s${WK_C_OFF} %s... ${WK_C_DIM}(%ss)${WK_C_OFF}" \
      "$WK_LOG_INDENT" "$frame" "$msg" "$left" >&2
    i=$(( i + 1 ))
    sleep 0.1
  done
}

# Poll a check, run in this shell so a global it sets survives, until it exits
# 0 (return 0). Enter checks now; `s` or a closed stdin skips (return 1). The
# INT trap takes the background countdown down before re-raising.
# Usage: wk_poll <message> <interval-seconds> <check command...>
wk_poll() {
  local msg="$1" interval="$2"; shift 2
  local key rc deadline waited now fast=0 lastfail=''
  printf "\n%s${WK_C_DIM}(enter)=check now, (s)=skip${WK_C_OFF}\n\n" "$WK_LOG_INDENT" >&2
  trap 'wk_poll_stop; trap - INT; kill -INT $$' INT
  while :; do
    if "$@"; then trap - INT; return 0; fi
    deadline=$(( $(date +%s) + interval ))
    if [[ "${WORKKIT_SPIN:-}" != '0' ]] && [[ -t 2 ]]; then
      wk_poll_draw "$msg" "$deadline" &
      WK_POLL_PID=$!
    else
      printf '%s⏳ %s...\n' "$WK_LOG_INDENT" "$msg" >&2
    fi
    waited=0
    key=''
    while [[ "$waited" -lt "$interval" ]]; do
      key=''; rc=0
      read -rsn1 -t 1 key || rc=$?
      if [[ "$rc" -eq 0 ]]; then
        # Enter is an empty read, or the carriage return a raw terminal can
        # hand over: check now. Any other key is read and dropped.
        if [[ -z "$key" || "$key" == $'\r' || "$key" == $'\n' ]]; then key=''; break; fi
        if [[ "$key" == 's' || "$key" == 'S' ]]; then key='s'; break; fi
        continue
      fi
      # bash 3.2 returns 1 for both a timeout and a closed stdin; three failed
      # reads in one clock second can only be the closed pipe.
      now="$(date +%s)"
      if [[ "$rc" -le 128 && "$now" == "$lastfail" ]]; then
        fast=$(( fast + 1 ))
        if [[ "$fast" -ge 2 ]]; then key='s'; break; fi
      else
        fast=0
      fi
      lastfail="$now"
      waited=$(( waited + 1 ))
    done
    wk_poll_stop
    if [[ "$key" == 's' ]]; then trap - INT; return 1; fi
  done
}

# Take the countdown frame down and clear its line.
wk_poll_stop() {
  if [[ -n "$WK_POLL_PID" ]]; then
    { kill "$WK_POLL_PID"; wait "$WK_POLL_PID"; } >/dev/null 2>&1 || true
    WK_POLL_PID=''
    printf '\r%*s\r' 72 '' >&2
  fi
}

# ── Real symlinks on Windows ──────────────────────────────────────────────────
# Make a machine address and answer whether it now resolves to the target.
# Renamed onto the address, never `ln -sfn`, whose unlink-then-create gap races
# other sessions. It removes nothing: what sits there is the caller's to judge.
wk_link() {
  local target="$1" address="$2" tmp="$2.tmp.$$"
  if ! ln -s "$target" "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  if ! wk_mv_link "$tmp" "$address"; then
    rm -f "$tmp"
    return 1
  fi
  [ "$(readlink "$address" 2>/dev/null)" = "$target" ]
}
