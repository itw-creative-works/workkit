#!/usr/bin/env bash
# workflow/lib.sh: the engine's shared helpers. SOURCED, never executed.
#
# Three things every part of the home-repo machinery needs and none of them owns:
# where the user's workflow folder is, how to edit a JSON file without losing it,
# and how to say something in whatever voice the caller already speaks.
#
# It sets no shell options: a sourced file that turned on `set -e` would change
# the behavior of the script that sourced it. The one thing it runs at load is
# `wk_palette`, which only reads the environment and sets this file's own
# variables, so a caller speaks in the right colors from its very first line.

# ── The addresses ─────────────────────────────────────────────────────────────
# The user's workflow folder: a PLAIN folder and never a git repo (issue #77).
# It holds this machine's own state and nothing versioned: the site options, the
# roster, the declines, the id cache, and the job state under jobs/.
# WORKFLOW_HOME is the same override the rest of the engine honors. The suite
# points it at a fixture, so nothing here ever reaches the real one.
WK_USER_DIR="${WORKFLOW_HOME:-${HOME:-}/.workkit}"

# Three files, split by WHO WRITES THEM (issue #80).
#
# settings.json is HAND-EDITED: `version` and one nested `site` key, the home
# repo's slug (`site.repo`), the all-or-nothing publish switch (`site.publish`)
# and the custom domain (`site.url`). The site options live here rather than in
# the clone because the clone is engine territory and is never hand-edited
# (issue #79); setup writes `site.repo` once and nothing else in this file is
# ever written by a machine.
WK_HOME_SETTINGS="$WK_USER_DIR/settings.json"
# .repos.json is MACHINE-MAINTAINED: the roster the heal registers and the
# declines the CLI records, under one `repos` map. Dot-named because it is not
# the owner's to edit. The engine rewrites it on contact.
WK_HOME_REPOS="$WK_USER_DIR/.repos.json"
# .cache.json is DISPOSABLE: the Discussions GraphQL ids, and since issue #86
# nothing else. The upstream-news cursor moved onto the board, where a job that
# runs from anywhere can read it. Deleting the file costs one round trip; every
# reader rebuilds what it does not find.
WK_HOME_CACHE="$WK_USER_DIR/.cache.json"

# The ONE git repo in the global layer: the clone of `<login>/workkit`, seeded
# from this checkout's tower/app and shaped like every other omega site project.
# Everything versioned lives inside it, so the folder above stays a plain one.
WK_HOME_DIR="$WK_USER_DIR/tower"
# The one target in the brand root, and the build output it leaves. Proved
# against the real tower/app 2026-07-29: `omega build` is a command of
# @omega.js/web and resolves only inside the TARGET (at the brand root the
# `omega` bin dispatches to @omega.js/manager, which has no build), and it
# writes `dist/` beside src/.
WK_HOME_TARGET="$WK_HOME_DIR/targets/web"
WK_HOME_DIST="$WK_HOME_TARGET/dist"

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
#
# The codes are BACKSLASH literals rather than real escapes: each is used inside
# a printf FORMAT string, which is what expands them, and the empty string is
# what a no-color run interpolates instead.
WK_C_GREEN='' WK_C_YELLOW='' WK_C_RED='' WK_C_CYAN='' WK_C_MAGENTA='' WK_C_DIM='' WK_C_BOLD='' WK_C_OFF=''

# One palette, settled once from wk_color_on above, and called at the bottom of
# this section, so a script speaks in color from its first line without an init
# step of its own to forget.
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

# The indent a level line carries. A title or a section sets it to two spaces,
# so the steps that follow sit under the heading they belong to; a script that
# prints neither (the heal, the jobs) sets it itself where it wants one.
WK_LOG_INDENT=''

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
# two (`workkit update` relaying the heal and the installer, jobs/morning.sh
# logging what the runner reconcile printed). Reads stdin, writes stdout, and
# touches nothing else on the line.
#
# An ALTERNATION, never a bracket class: in the C locale a class of multibyte
# characters is a set of their BYTES, and an anchored match of one byte followed
# by a space matches none of these glyphs (proved on this machine, 2026-09-10).
wk_plain() {
  sed -E 's/^ *(✓|·|›|⚠|✖|⏳) //'
}

# omega's spinner frames (that monorepo's `packages/devkit/src/flows.js`): an
# animation on a terminal, redrawn in place and erased when the call returns, so
# it never reaches a log file, a pipe or a captured payload.
WK_SPIN_FRAMES=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

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

# Take the countdown frame down and clear its line. WK_POLL_PID is the draw job
# wk_poll started, a global so the interrupt trap reaches it too.
WK_POLL_PID=''
wk_poll_stop() {
  if [[ -n "$WK_POLL_PID" ]]; then
    { kill "$WK_POLL_PID"; wait "$WK_POLL_PID"; } >/dev/null 2>&1 || true
    WK_POLL_PID=''
    printf '\r%*s\r' 72 '' >&2
  fi
}

wk_palette

# ── JSON ──────────────────────────────────────────────────────────────────────
# Write a jq edit back to a file safely: resolve symlinks first (this system's
# whole model is symlinking config out of ~, and writing the temp file over the
# LINK would replace it with a regular file and orphan the real one), refuse to
# touch a file jq cannot parse, and never leave a .tmp behind.
#
# Usage: wk_json_edit <file> <jq args...>
wk_json_edit() {
  local file="$1"; shift
  local target tmp rc=0
  command -v jq >/dev/null 2>&1 || return 1
  target=$(readlink -f "$file" 2>/dev/null || printf '%s' "$file")
  if ! jq empty "$target" 2>/dev/null; then
    wk_warn "settings: $target is not valid JSON; fix or remove it, then try again"
    return 1
  fi
  tmp="$target.tmp.$$"
  # shellcheck disable=SC2064  # expand $tmp now: it is what this call must clean up
  trap "rm -f '$tmp'" RETURN
  jq "$@" "$target" >"$tmp" || rc=$?
  if [[ "$rc" -ne 0 ]] || [[ ! -s "$tmp" ]]; then
    wk_warn "settings: could not write $target (left unchanged)"
    return 1
  fi
  mv "$tmp" "$target" || { wk_warn "settings: could not replace $target"; return 1; }
  return 0
}

# ── The state mutex ───────────────────────────────────────────────────────────
# Every machine-written file here is edited by a whole-file read-modify-write,
# and two runs doing that at once keep only the last writer's change. A
# decline, a roster registration, the cached node ids, the home slug: whichever
# lost is simply gone. mkdir is the atomic mutex, and EVERY writer takes this
# one, which is why it lives here rather than in any of them. ONE lock covers
# all three files: the writers are the same handful of runs, and a lock per file
# would only trade a rare wait for three ways to get the pairing wrong.
#
# Returns 0 holding the lock, 1 when another run held it for the whole 5s wait.
# Every caller proceeds either way (a rare lost edit costs less than a run that
# stops) and only the caller that took it releases it: the mutex belongs to
# whichever run holds it, and removing it on the way out of a run that never had
# it would let a third writer race the current holder.
WK_STATE_LOCK="$WK_USER_DIR/.state.lock"

wk_take_state_lock() {
  local waited=0
  mkdir -p "$(dirname "$WK_STATE_LOCK")" 2>/dev/null || return 1
  while [ "$waited" -lt 50 ]; do
    if mkdir "$WK_STATE_LOCK" 2>/dev/null; then return 0; fi
    sleep 0.1
    # An assignment, never `(( waited++ ))`: that form yields the value BEFORE
    # the increment, so the first pass evaluates to 0, which is a non-zero exit
    # status. Bash 4.1 and later apply errexit to it and the whole run ends
    # silently mid-wait; bash 3.2 (stock macOS) does not, so the defect only
    # ever surfaced off this machine.
    waited=$(( waited + 1 ))
  done
  return 1
}

wk_drop_state_lock() {
  rmdir "$WK_STATE_LOCK" 2>/dev/null || true
}

# One value out of a JSON file, or empty for an absent key, an unreadable file,
# or a machine without jq, the three ways an answer can be missing, all of
# which mean the caller has no answer to act on.
wk_json_get() {
  local file="$1" filter="$2"
  [[ -f "$file" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  jq -r "$filter // empty" "$file" 2>/dev/null || true
}

# ── Slugs ─────────────────────────────────────────────────────────────────────
# `owner/repo` from a git remote URL, in either form git writes it. The same
# three shapes tower/api/lib/repos.js parses, so the roster and the home repo's
# project list can never disagree about what a repo is called.
wk_slug_from_remote() {
  local url="${1:-}" trimmed
  [[ -n "$url" ]] || return 0
  trimmed="${url%.git}"
  trimmed="${trimmed%/}"
  [[ "$trimmed" =~ [:/]([^:/]+)/([^/]+)$ ]] || return 0
  printf '%s/%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
}

# The origin slug of a git working tree, or empty when it has none.
wk_repo_slug() {
  local dir="${1:-.}" url
  url="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  wk_slug_from_remote "$url"
}
