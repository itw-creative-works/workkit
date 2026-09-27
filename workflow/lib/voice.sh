#!/usr/bin/env bash
# workflow/lib/voice.sh: the engine's style and voice, the shell home of
# workflow/README.md § Output. Sourced by lib.sh, functions only. Reads lib.sh's
# WK_C_* palette, WK_LOG_INDENT and WK_SPIN_FRAMES; wk_palette writes the
# palette, and lib.sh calls it once at load.

# ── Style ─────────────────────────────────────────────────────────────────────
# Every no is final: WORKKIT_COLOR=1 stands in only for the terminal on stdout,
# so it never overrides NO_COLOR or a `dumb` TERM.
wk_color_on() {
  [[ "${WORKKIT_COLOR:-}" != '0' ]] || return 1
  [[ -z "${NO_COLOR:-}" ]] || return 1
  [[ "${TERM:-}" != 'dumb' ]] || return 1
  [[ "${WORKKIT_COLOR:-}" == '1' || -t 1 ]] || return 1
  return 0
}

# ── Voice ─────────────────────────────────────────────────────────────────────
# The glyphs: `✓` acted, `·` nothing to do, `›` worth knowing, `⚠` needs
# judgment, `✖` stopping, `✨` everything is current.

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

# The codes ride the format string and the text rides `%s`, so a percent or a
# backslash prints as handed in. The `task:` is one word, so a clause that
# happens to carry a colon prints as written.
# Usage: wk_say <glyph> <glyph color> <task color> <message color> <message>
wk_say() {
  local glyph="$1" gc="$2" tc="$3" mc="$4" msg="$5" task=''
  # A reset only after a part that was painted.
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

# A caller whose stdout is a machine answer sets WK_LOG_STDERR=1.
wk_out() {
  if [[ "${WK_LOG_STDERR:-0}" == '1' ]]; then
    "$@" >&2
  else
    "$@"
  fi
}

# The five levels. QUIET=1 silences the two that only report.
wk_ok()    { wk_out wk_say '✓' "$WK_C_BOLD$WK_C_GREEN" "$WK_C_BOLD" '' "$1"; return 0; }
wk_skip()  { if [[ "${QUIET:-0}" != '1' ]]; then wk_out wk_say '·' "$WK_C_DIM" "$WK_C_DIM" "$WK_C_DIM" "$1"; fi; return 0; }
wk_info()  { if [[ "${QUIET:-0}" != '1' ]]; then wk_out wk_say '›' "$WK_C_CYAN" "$WK_C_BOLD" '' "$1"; fi; return 0; }
wk_warn()  { wk_say '⚠' "$WK_C_YELLOW" "$WK_C_BOLD$WK_C_YELLOW" "$WK_C_YELLOW" "$1" >&2; return 0; }
wk_error() { wk_say '✖' "$WK_C_RED" "$WK_C_BOLD$WK_C_RED" "$WK_C_RED" "$1" >&2; return 0; }

# The indent is set whatever QUIET says: it is the shape of the run, not output.
wk_title() {
  WK_LOG_INDENT='  '
  if [[ "${QUIET:-0}" == '1' ]]; then return 0; fi
  wk_out printf "${WK_C_BOLD}%s${WK_C_OFF}\n" "$1"
  return 0
}

wk_section() {
  WK_LOG_INDENT='  '
  if [[ "${QUIET:-0}" == '1' ]]; then return 0; fi
  wk_out printf '\n'
  wk_out printf "${WK_C_BOLD}${WK_C_CYAN}%s${WK_C_OFF}\n" "$1"
  return 0
}

# The browser opener this machine has, or 1 so the caller prints the URL.
wk_opener() {
  local opener
  if [[ "$(uname -s)" == 'Darwin' ]]; then opener='open'; else opener='xdg-open'; fi
  command -v "$opener" >/dev/null 2>&1 || return 1
  printf '%s' "$opener"
}

# The closing line when nothing is left to do; otherwise a command closes on a
# warning.
wk_done() {
  if [[ "${QUIET:-0}" == '1' ]]; then return 0; fi
  wk_out printf "${WK_C_BOLD}${WK_C_GREEN}✨ %s${WK_C_OFF}\n" "$1"
  return 0
}

# Strips a relayed line's indent and glyph, so the relay re-says it under its
# own. An alternation, never a bracket class: in the C locale a class of
# multibyte characters is a set of their bytes and matches none of these.
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

# Usage: wk_spin "<message>" <command...>. The command runs in the foreground
# and every line of this goes to stderr, so the command's stdout and exit
# status pass through untouched.
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
