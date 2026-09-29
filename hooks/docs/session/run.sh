#!/bin/bash
# docs:session: SessionStart hook, every source. Injects `.workkit/agents/session.md`,
# the task queue a compaction, resume or restart reads first, warns past the
# light bar, and closes with one line for the manager and one for the owner
# (also a systemMessage, since additionalContext reaches the model alone). It
# leads with a line when the cloud brief's marker has gone stale. A file read
# only, silent when there is nothing to say, always exits 0.
# Detail: docs/hooks.md § docs:session.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

# The two engine seams, from this file's physical location: wk_jq, wk_user_dir
# and wk_settings_declined. They define functions and set nothing, so this hook
# still sources no hook helper. Unguarded: a missing one is an incomplete
# plugin, which workflow:standards already names.
# shellcheck source=../../../workflow/lib/platform.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../../../workflow/lib/platform.sh"
# shellcheck source=../../../workflow/lib/participation.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../../../workflow/lib/participation.sh"

cwd=$(wk_jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || exit 0

# The repo root, so a session opened in a subdirectory still finds the file.
# No git root, no repo: outside every repo the settings file is the machine's
# own state (docs/hooks.md § docs:session), and only git can say which repo a
# cwd sits in.
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root=""
[ -n "$root" ] || exit 0

# This hook sources no hook helper, so the directory name is spelled out; its
# SSOT is WORKKIT_DIR in hooks/_lib.sh. Change both together.
SETTINGS="$root/.workkit/settings.json"
SESSION_FILE="$root/.workkit/agents/session.md"

# Participation gate: the committed settings.json is the repo's yes, and
# `"enabled": false`, read through wk_settings_declined, its no.
[ -f "$SETTINGS" ] || exit 0
wk_settings_declined "$SETTINGS" && exit 0

# The MACHINE's folder, where the 9am job leaves the brief marker, through the
# engine's one spelling of it (wk_user_dir in platform.sh, sourced above).
USER_DIR="$(wk_user_dir)"
BRIEF_MARKER="$USER_DIR/brief-status.json"

# Whole calendar days between a YYYY-MM-DD and today, both pinned to UTC
# midnight. jq does the maths: `date -d` is GNU and `date -j -f` BSD. Prints
# the count; non-zero and silent for a date it cannot place or a future one.
days_since() {
  local n
  n=$(wk_jq -n --arg d "$1" '
    def day: . + "T00:00:00Z" | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime;
    (((now | todate | .[0:10]) | day) - ($d | day)) / 86400 | floor' 2>/dev/null) || return 1
  case "$n" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$n"
}

# A date at the front of a marker field, or nothing: `lastBrief` is a day and
# `checkedAt` is an ISO moment, and the day is the whole of what is counted.
marker_day() {
  local value
  value=$(wk_jq -r --arg k "$1" '.[$k] // empty' "$BRIEF_MARKER" 2>/dev/null) || return 1
  value="${value:0:10}"
  case "$value" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) printf '%s' "$value" ;;
    (*) return 1 ;;
  esac
}

# The stale-brief line, or nothing: every failure (no marker, one that does not
# parse, a field that is not a date) is silence, since a guess is worse.
brief_alert() {
  local last checked days checked_days slug why line
  [ -f "$BRIEF_MARKER" ] || return 0
  last=$(marker_day 'lastBrief') || return 0
  checked=$(marker_day 'checkedAt') || return 0

  days=$(days_since "$last") || return 0
  # One whole day is the ordinary morning, not a late brief. The bar is
  # FRESH_DAYS in tower/api/lib/history.js too: change both together
  # (docs/hooks.md § docs:session).
  [ "$days" -gt 1 ] || return 0

  # Whose silence it is: a marker is only as fresh as this machine's last
  # morning, and a laptop that was off is not an expired token, so past the same
  # bar the line names the machine instead.
  checked_days=$(days_since "$checked") || return 0
  if [ "$checked_days" -gt 1 ]; then
    why="this machine last checked $checked, so the marker is that old too. Run the morning here before blaming the runner"
  else
    why="the runner likely needs a fresh token; fix: workkit setup --token"
  fi

  line="cloud brief: last posted $last ($days days ago): $why"
  # The check clause names the home repo, and only when this machine's settings
  # already say which one it is. A command the owner is about to run gets no
  # guessed argument. It rides either wording: what the runs on that repo say is
  # worth reading whichever half went quiet.
  slug=$(wk_jq_default '' -r '.site.repo // empty' "$USER_DIR/settings.json")
  [ -z "$slug" ] || line="$line · check: gh run list --repo $slug --workflow brief.yml"
  printf '%s' "$line"
}

alert=$(brief_alert)

# The session state, when there is any. An absent or header-only file leaves
# the block empty rather than ending the run: the brief alert may still speak.
state=''
owner=''
if [ -f "$SESSION_FILE" ]; then
  # Content lines: the template's scaffolding counts zero. The count and the bar
  # live in docs/session-guard too; change both together (a test pins them).
  # grep -c prints its count even when exiting 1 on zero matches, so a fallback
  # echo would double it.
  lines=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#|^[[:space:]]*>|^[[:space:]]*<!--' "$SESSION_FILE" 2>/dev/null) || true
  lines="${lines:-0}"
  case "$lines" in ''|*[!0-9]*) lines=0 ;; esac

  LIGHT_BAR=40

  if [ "$lines" -gt 0 ]; then
    state="SESSION STATE: $SESSION_FILE (your task queue across compactions; keep it current):
$(cat "$SESSION_FILE")"

    if [ "$lines" -gt "$LIGHT_BAR" ]; then
      state="$state
NOTE: session.md is $lines content lines (bar $LIGHT_BAR). It is a queue, not a journal. Promote anything durable to its issue and prune the rest."
    fi

    # The two closing lines, one per reader, only where state exists. They ride
    # with the state rather than the manager instruction, so a non-manager session
    # hears them too; the owner line is last, read just before the first reply.
    state="$state

---
Manager: open your first reply after a restart or compaction with this state in plain words.
Owner: state carried over. Say \"continue\" and this session resumes the queue above."
    owner='workkit: state carried over. Say "continue" to resume the session queue'
  fi
fi

# Nothing on either front is a hook that says nothing.
[ -n "$alert$state" ] || exit 0

# The alert LEADS. It is about the machine rather than about the task, and the
# state below it closes with two lines that have to stay last.
msg="$state"
if [ -n "$alert" ]; then
  if [ -n "$state" ]; then
    msg="$alert

$state"
  else
    msg="$alert"
  fi
fi

# The owner line rides the visible channel only when there is state to resume.
# A stale brief is the manager's to report, in its own words, in the reply the
# owner is already reading.
wk_jq -n --arg ctx "$msg" --arg owner "$owner" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
} + (if $owner == "" then {} else { "systemMessage": $owner } end)'
exit 0
