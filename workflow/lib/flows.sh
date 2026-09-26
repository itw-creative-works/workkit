#!/usr/bin/env bash
# workflow/lib/flows.sh: the engine's browser flows and its link maker. The
# Enter gate, the poll and its countdown, and the atomic symlink the machine's
# two addresses are written through. SOURCED by lib.sh, never executed, and it
# runs nothing at load: it defines functions and sets nothing. It reads lib.sh's
# WK_C_* palette variables, WK_LOG_INDENT, WK_SPIN_FRAMES and WK_POLL_PID (which
# wk_poll sets), and calls wk_opener (lib/voice.sh) and wk_mv_link
# (platform.sh).

# ── Browser flows ─────────────────────────────────────────────────────────────
# omega's walkthrough shape (that monorepo's `packages/devkit/src/flows.js`,
# `openBrowserAndPoll`), in shell and in this file's voice: say what to do on
# the page and print its URL, gate the open behind Enter, then poll a check
# until it passes, Enter meaning "check now" and `s` meaning skip. Both are for
# a caller that already knows it has a terminal; a piped run prints its own
# pointer instead of asking anyone anything.

# The Enter gate and the open. The URL is printed either way, so a terminal
# with link support keeps it clickable; a machine with no opener says so in one
# dim line and the caller goes on, since the URL is already on screen.
# Usage: wk_enter_to_open <url> <label> <what to do there>
wk_enter_to_open() {
  local url="$1" label="$2" prompt="$3" opener answer=''
  # The palette's codes are backslash text for a FORMAT string, never a %s
  # argument, the same as every other line in this file.
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

# Poll a check until it passes. The check is a command run in THIS shell (so a
# global it sets survives), and exit 0 means done. Between checks the countdown
# draws (a static line where stderr is not a terminal, as wk_spin does) and the
# keys are read one at a time: Enter checks now, `s` skips, and stdin closing
# counts as a skip, because nobody is there to press anything. Returns 0 when
# the check passed, 1 when skipped.
#
# Telling a closed stdin from a one-second timeout: bash 4 reports a timeout
# with a status above 128, but bash 3.2 (macOS's own) returns 1 for both. The
# closed pipe is the one that comes back at once, so three failed reads inside
# one clock second cannot be timeouts of a second each: that is the closed
# pipe, on either bash.
#
# Ctrl+C: a background job ignores the interrupt, so without a trap the shell
# dies and the countdown goes on redrawing over the prompt that came back,
# which reads as a poll nothing can stop. The trap takes the frame down, clears
# the line, then re-raises the interrupt so the run ends the way it was asked to.
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
# The two links are the engine address in standards.sh and the
# `~/.local/bin/workkit` command in workkit.sh; the MSYS flag that makes them
# real links on Windows is set at load, in lib.sh's section of this name.
#
# Make one of those two links, and say whether the address now IS it.
#
# Both addresses are the MACHINE's, one path shared by every session on it, so
# sessions opening at once in several repos all write the same one. The link is
# therefore made under a name nobody reads and RENAMED onto the address: a
# rename replaces whatever is there in a single step, and told not to follow
# the address (`wk_mv_link`, platform.sh, where the two `mv` spellings for that
# live) it never walks into the directory behind it. `ln -sfn` cannot do this
# job. It unlinks the address and then creates it, so a session reading the
# address in that gap finds nothing, and another session's checks in that gap
# can delete the link the first one just made.
#
# It removes nothing at the address: WHAT is there when the link did not land
# is the caller's to judge (a Git Bash copy is the engine's to clear, a real
# file a human put there is not), and what comes back here is the one fact
# worth judging, whether the address now resolves to the target that was asked
# for. `ln` and `mv` keep their stderr for the same reason: a permission error
# has to name itself instead of coming back as a silent no.
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
