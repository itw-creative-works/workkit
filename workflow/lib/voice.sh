#!/usr/bin/env bash
# workflow/lib/voice.sh: the engine's style and voice. The color gate, the
# palette, the line shape and its five levels, the headings, the browser opener,
# the relay strip and the spinner. SOURCED by lib.sh, never executed, and it
# runs nothing at load: it defines functions and sets nothing. It reads lib.sh's
# WK_C_* palette variables, WK_LOG_INDENT and WK_SPIN_FRAMES; wk_palette writes
# the palette variables and lib.sh calls it once at load.

# ── Style ─────────────────────────────────────────────────────────────────────
# One palette for every part of the engine that speaks to a person, so a color
# is chosen once rather than per command (issue #90). Color is a TERMINAL's
# affordance and nothing else's: a log file, a captured hook payload and a piped
# run all get the same words uncolored, byte for byte what a terminal is shown
# minus the codes: the level is in the line, never in a color.
#
# Three ways to say no, every one of them final: WORKKIT_COLOR=0, NO_COLOR set
# (https://no-color.org), or a TERM that cannot render any of it. WORKKIT_COLOR=1
# stands in for the ONE yes (a terminal on stdout) and for nothing else, so a
# machine that asked for no color never gets some anyway; it is also what lets
# the suite read the styled shape out of a pipe. (A shell with no TERM at all
# reports `dumb`, which is why that check sits above the seam rather than under
# it: the answer must not depend on whether a caller cleared the environment.)
wk_color_on() {
  [[ "${WORKKIT_COLOR:-}" != '0' ]] || return 1
  [[ -z "${NO_COLOR:-}" ]] || return 1
  [[ "${TERM:-}" != 'dumb' ]] || return 1
  [[ "${WORKKIT_COLOR:-}" == '1' || -t 1 ]] || return 1
  return 0
}

# ── Voice ─────────────────────────────────────────────────────────────────────
# ONE voice for every human line the engine, the jobs and the tower print
# (issue #237): a GLYPH says what kind of line it is, the `task:` the line
# belongs to is bold, and the steps sit indented under the title or the section
# that opened them. No timestamp and no module tag: a person reading a command
# reads what it did, and one command's transcript is short enough to read whole.
#
# The glyphs, one per outcome: `✓` acted, `·` nothing to do, `›` worth knowing,
# `⚠` needs judgment, `✖` stopping, `✨` everything is current, and a braille
# frame while a call is awaited. A title, a section and the closing line carry
# an EMOJI the caller picks for what that part of the command does; a level line
# carries its glyph and nothing else. The full table: workflow/README.md.

# One palette, settled once from wk_color_on above, and called by lib.sh at
# load, so a script speaks in color from its first line without an init step of
# its own to forget.
wk_palette() {
  if wk_color_on; then
    WK_C_GREEN='\033[0;32m' WK_C_YELLOW='\033[0;33m' WK_C_RED='\033[0;31m'
    WK_C_CYAN='\033[0;36m' WK_C_MAGENTA='\033[0;35m' WK_C_DIM='\033[0;90m'
    WK_C_BOLD='\033[1m' WK_C_OFF='\033[0m'
  else
    WK_C_GREEN='' WK_C_YELLOW='' WK_C_RED='' WK_C_CYAN='' WK_C_MAGENTA='' WK_C_DIM='' WK_C_BOLD='' WK_C_OFF=''
  fi
  return 0
}

# One line, one printf: the codes ride the format string and the text rides
# `%s`, so a message carrying a percent or a backslash prints exactly as it was
# handed in.
#
# The `task:` split is what makes a column of lines scannable: a message that
# opens `<word>: <rest>` (`engine:`, `schedule:`, `site:`) has that word painted
# bold and the rest left to the level's own color. One word only, so a message
# whose opening clause happens to carry a colon is printed as it was written.
#
# Usage: wk_say <glyph> <glyph color> <task color> <message color> <message>
wk_say() {
  local glyph="$1" gc="$2" tc="$3" mc="$4" msg="$5" task=''
  # The reset belongs to whichever part was actually painted: a level whose
  # message takes the level's plain color must not trail an escape a no-color
  # run would never print.
  local goff='' toff='' moff=''
  [[ -z "$gc" ]] || goff="$WK_C_OFF"
  [[ -z "$tc" ]] || toff="$WK_C_OFF"
  [[ -z "$mc" ]] || moff="$WK_C_OFF"
  case "$msg" in
    [a-z]*': '*) task="${msg%%: *}" ;;
  esac
  case "$task" in *' '*) task='' ;; esac
  if [[ -n "$task" ]]; then
    printf "%s${gc}%s${goff} ${tc}%s:${toff} ${mc}%s${moff}\n" \
      "$WK_LOG_INDENT" "$glyph" "$task" "${msg#*: }"
  else
    printf "%s${gc}%s${goff} ${mc}%s${moff}\n" "$WK_LOG_INDENT" "$glyph" "$msg"
  fi
}

# The calm levels go to stdout, because a person reading a command reads its
# stdout. A caller whose stdout is a MACHINE answer says so with
# WK_LOG_STDERR=1 and every level goes to stderr instead (standards.sh: a
# `$(standards.sh --state)` capture must hold the state and nothing else).
wk_out() {
  if [[ "${WK_LOG_STDERR:-0}" == '1' ]]; then
    "$@" >&2
  else
    "$@"
  fi
}

# The five levels. QUIET=1 in the caller silences the two that only report
# (`wk_skip`, `wk_info`), which is what `update --auto` and the session-start
# heal lean on: a session that found nothing to do says nothing at all, while an
# action, a warning and a stop still speak.
wk_ok()    { wk_out wk_say '✓' "$WK_C_BOLD$WK_C_GREEN" "$WK_C_BOLD" '' "$1"; return 0; }
wk_skip()  { if [[ "${QUIET:-0}" != '1' ]]; then wk_out wk_say '·' "$WK_C_DIM" "$WK_C_DIM" "$WK_C_DIM" "$1"; fi; return 0; }
wk_info()  { if [[ "${QUIET:-0}" != '1' ]]; then wk_out wk_say '›' "$WK_C_CYAN" "$WK_C_BOLD" '' "$1"; fi; return 0; }
wk_warn()  { wk_say '⚠' "$WK_C_YELLOW" "$WK_C_BOLD$WK_C_YELLOW" "$WK_C_YELLOW" "$1" >&2; return 0; }
wk_error() { wk_say '✖' "$WK_C_RED" "$WK_C_BOLD$WK_C_RED" "$WK_C_RED" "$1" >&2; return 0; }

# A whole command's title, in bold, and the indent every line under it takes.
# The indent is set whatever QUIET says: it is the shape of the run, not output.
wk_title() {
  WK_LOG_INDENT='  '
  if [[ "${QUIET:-0}" == '1' ]]; then return 0; fi
  wk_out printf "${WK_C_BOLD}%s${WK_C_OFF}\n" "$1"
  return 0
}

# A run of steps under one title (issue #90): a blank line, then the title in
# bold cyan. A full setup is ~25 lines, and flat they read as one
# undifferentiated list.
wk_section() {
  WK_LOG_INDENT='  '
  if [[ "${QUIET:-0}" == '1' ]]; then return 0; fi
  wk_out printf '\n'
  wk_out printf "${WK_C_BOLD}${WK_C_CYAN}%s${WK_C_OFF}\n" "$1"
  return 0
}

# The browser opener this machine has, printed, for the steps that hand a page
# to the owner (the token handover, the Discussion categories). `open` on
# Darwin, `xdg-open` everywhere else; a machine with neither returns 1 and the
# caller prints the URL instead.
wk_opener() {
  local opener
  if [[ "$(uname -s)" == 'Darwin' ]]; then opener='open'; else opener='xdg-open'; fi
  command -v "$opener" >/dev/null 2>&1 || return 1
  printf '%s' "$opener"
}

# The closing line of a command that found nothing left to do. A command that
# DID find something says so with a warning instead, so the last line of a run
# is always the answer to "is there anything for me here?".
wk_done() {
  if [[ "${QUIET:-0}" == '1' ]]; then return 0; fi
  wk_out printf "${WK_C_BOLD}${WK_C_GREEN}✨ %s${WK_C_OFF}\n" "$1"
  return 0
}

# The indent and the glyph of a line ANOTHER part of the kit printed, stripped
# off, so a relay re-says it under its own glyph rather than letting a line wear
# two (`workkit update` relaying the heal and the installer,
# jobs/morning/runner.sh logging what the runner reconcile printed). Reads
# stdin, writes stdout, and touches nothing else on the line.
#
# An ALTERNATION, never a bracket class: in the C locale a class of multibyte
# characters is a set of their BYTES, and an anchored match of one byte followed
# by a space matches none of these glyphs (proved on this machine, 2026-09-10).
wk_plain() {
  sed -E 's/^ *(✓|·|›|⚠|✖|⏳) //'
}

# The animation itself, run as a background job by wk_spin below.
wk_spin_draw() {
  local msg="$1" i=0 start elapsed frame
  start="$(date +%s)"
  while :; do
    frame="${WK_SPIN_FRAMES[$(( i % ${#WK_SPIN_FRAMES[@]} ))]}"
    elapsed=$(( $(date +%s) - start ))
    printf "\r%s${WK_C_CYAN}%s${WK_C_OFF} %s ${WK_C_DIM}(%ss)${WK_C_OFF}" \
      "$WK_LOG_INDENT" "$frame" "$msg" "$elapsed" >&2
    i=$(( i + 1 ))
    sleep 0.1
  done
}

# Wrap an awaited call: `wk_spin "<message>" <command...>` (issue #237). Every
# `gh` call, every clone, fetch and push, every build and every poll goes
# through it, so a command that is waiting says what it is waiting for.
#
# The command runs in the FOREGROUND and the animation in the background, which
# is the only arrangement that leaves the command's stdout and its exit status
# untouched: `url="$(wk_spin 'reading the roster' gh api ...)"` captures exactly
# what gh wrote. For the same reason the static line goes to STDERR, never to
# stdout: this wrapper's stdout belongs to the command it runs.
#
# Two forms, one mechanism: a terminal on stderr gets the animation, everything
# else (a pipe, a log file, a launchd run, the suites) gets the one static
# `⏳ <message>...`. WORKKIT_SPIN=0 forces the static form.
wk_spin() {
  local msg="$1"; shift
  local rc=0 pid
  if [[ "${WORKKIT_SPIN:-}" == '0' ]] || [[ ! -t 2 ]]; then
    if [[ "${QUIET:-0}" != '1' ]]; then
      printf "%s⏳ %s...\n" "$WK_LOG_INDENT" "$msg" >&2
    fi
    "$@" || rc=$?
    return "$rc"
  fi
  wk_spin_draw "$msg" &
  pid=$!
  "$@" || rc=$?
  { kill "$pid"; wait "$pid"; } >/dev/null 2>&1 || true
  printf '\r%*s\r' 72 '' >&2
  return "$rc"
}
