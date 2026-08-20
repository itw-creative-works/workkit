#!/bin/bash
# docs:session — SessionStart hook (issue #56).
# Hands the session its own task state back: `.workkit/agents/session.md` is what keeps
# the LOCAL AGENT on task across a compaction, a resume, or a restart, so it is
# injected on EVERY source (no matcher) — the compaction case is the one the
# file exists for, and it is the one that would be missed by a startup-only hook.
#
# The file is a QUEUE, not a journal: `## Active`, `## Queue`, `## Notes`, with
# everything durable promoted to its issue the moment it exists. Past the light
# bar (LIGHT_BAR content lines) the injection says so — a session.md growing
# into the retired PROGRESS.md shape is the failure this hook would otherwise
# feed, one session start at a time.
#
# The injection CLOSES, under a `---` rule that keeps them out of whatever
# heading the file body trailed off in, with two lines, one per reader: the
# session is told to open its first reply after a restart or compaction with
# this state in plain words, and the owner — who cannot see that anything
# survived — is told last that saying "continue" resumes the queue above.
#
# That owner line is also emitted as a top-level `systemMessage`, the one
# channel a hook has to the user's screen (hooks reference § JSON output: a
# universal field, every event, "shown to the user"), and the same channel the
# manager close-guard and spawn-guard hooks warn on. `additionalContext` is
# read by the MODEL alone, so the line addressed to the owner has to leave by
# both doors or it never arrives.
#
# It carries a second reader (issue #173): the cloud brief's marker, written by
# the 9am job into `~/.workkit/brief-status.json`. The brief runs on a runner and
# its failures are silent — a token that expired stops the morning and no chat
# session hears about it — so a brief that stopped arriving is named HERE, where
# the manager reads it before its first reply. A FILE is all this reads; a
# session start never waits on the network. The marker's own age is part of the
# answer: past the same bar the line names this machine's last check rather than
# the runner, because a laptop that was off is not a token that expired.
#
# Silent for an absent file, a file holding only its header, a marker that is
# missing or unreadable, and a repo that has not opted in. Always exits 0 — a
# context injection must never cost a session.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

cwd=$(jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || exit 0

# The repo root, so a session opened in a subdirectory still finds the file.
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root="$cwd"

# This hook sources nothing, so the directory name is spelled out; its SSOT is
# WORKKIT_DIR in hooks/_lib.sh — change both together.
SETTINGS="$root/.workkit/settings.json"
SESSION_FILE="$root/.workkit/agents/session.md"

# Participation gate. The committed settings.json is the repo's yes; a
# deliberate `"enabled": false` is its no. An undecided repo has no session.md
# to read anyway — the heal never writes into one — so the committed file is the
# whole signal this hook needs, and it stays free of the engine.
[ -f "$SETTINGS" ] || exit 0
grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$SETTINGS" 2>/dev/null && exit 0

# The MACHINE's folder, where the 9am job leaves the brief marker. Spelled out
# for the same reason the two paths above are — this hook sources nothing.
USER_DIR="$HOME/.workkit"
BRIEF_MARKER="$USER_DIR/brief-status.json"

# Whole CALENDAR days between a YYYY-MM-DD and today, both ends pinned to UTC
# midnight, so an answer never depends on the hour a session opened in. jq does
# the arithmetic because it is already the one tool this hook requires and the
# date maths is portable in it — `date -d` is GNU, `date -j -f` is BSD, and
# neither is on both.
#
# Prints the count. Non-zero and silent for a date that cannot be placed and for
# one ahead of today, which arrives here with a leading `-` and is dropped with
# every other answer that is not a count.
days_since() {
  local n
  n=$(jq -n --arg d "$1" '
    def day: . + "T00:00:00Z" | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime;
    (((now | todate | .[0:10]) | day) - ($d | day)) / 86400 | floor' 2>/dev/null) || return 1
  case "$n" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$n"
}

# A date at the front of a marker field, or nothing: `lastBrief` is a day and
# `checkedAt` is an ISO moment, and the day is the whole of what is counted.
marker_day() {
  local value
  value=$(jq -r --arg k "$1" '.[$k] // empty' "$BRIEF_MARKER" 2>/dev/null) || return 1
  value="${value:0:10}"
  case "$value" in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) printf '%s' "$value" ;;
    (*) return 1 ;;
  esac
}

# The stale-brief line, or nothing at all (issue #173). Every way this can fail
# — no marker, a marker that does not parse, a `lastBrief` or `checkedAt` that
# is not a date — is silence: a machine that has never run the morning has no
# brief to be late, and a guess here is worse than saying nothing.
brief_alert() {
  local last checked days checked_days slug why line
  [ -f "$BRIEF_MARKER" ] || return 0
  last=$(marker_day 'lastBrief') || return 0
  checked=$(marker_day 'checkedAt') || return 0

  days=$(days_since "$last") || return 0
  # ONE whole day is the ORDINARY morning, not a late brief: the marker is
  # written by the 9am job and the cloud posts minutes after it, so the newest
  # brief on the board is normally yesterday's.
  #
  # The same bar is FRESH_DAYS in tower/api/lib/history.js (issue #172), which
  # asks the same question of the same board for the tower's pages — change both
  # together. What they COUNT diverges on purpose: that one reads the dates off
  # briefs carrying a `workkit-stats` line, because a chart is what it feeds,
  # while the marker behind this line counts any `brief: `-titled Discussion. A
  # brief published without a stats line is still a morning that arrived, and
  # whether one arrived is the only question this line asks.
  [ "$days" -gt 1 ] || return 0

  # WHOSE silence it is. The board is read by the 9am job and by nothing else,
  # so a marker is only ever as fresh as the last morning that ran on this
  # machine: a laptop shut for a long weekend has an old answer, not a broken
  # runner. Sending the owner to mint a token that was never the problem is the
  # one way this line could cost more than it is worth, so past the same bar it
  # names the machine instead and leaves the diagnosis alone.
  checked_days=$(days_since "$checked") || return 0
  if [ "$checked_days" -gt 1 ]; then
    why="this machine last checked $checked, so the marker is that old too — run the morning here before blaming the runner"
  else
    why="the runner likely needs a fresh token; fix: workkit setup --token"
  fi

  line="cloud brief: last posted $last ($days days ago) — $why"
  # The check clause names the home repo, and only when this machine's settings
  # already say which one it is — a command the owner is about to run gets no
  # guessed argument. It rides either wording: what the runs on that repo say is
  # worth reading whichever half went quiet.
  slug=$(jq -r '.site.repo // empty' "$USER_DIR/settings.json" 2>/dev/null) || slug=''
  [ -z "$slug" ] || line="$line · check: gh run list --repo $slug --workflow brief.yml"
  printf '%s' "$line"
}

alert=$(brief_alert)

# The session state, when there is any. It is no longer this hook's only reason
# to speak, so an absent or header-only file leaves the block empty rather than
# ending the run — the brief alert above may still have something to say.
state=''
owner=''
if [ -f "$SESSION_FILE" ]; then
  # Content lines: non-blank, not a heading, not a blockquote note, not an HTML
  # comment — the template's own scaffolding is all four, so a freshly seeded
  # file counts zero and says nothing. This count and the bar below also live in
  # the docs/session-guard hook, which bounces a write past the same bar —
  # change both together (a test asserts they still agree).
  # (grep -c prints its count even when exiting 1 on zero matches — don't add a
  # fallback echo or the count doubles.)
  lines=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#|^[[:space:]]*>|^[[:space:]]*<!--' "$SESSION_FILE" 2>/dev/null) || true
  lines="${lines:-0}"
  case "$lines" in ''|*[!0-9]*) lines=0 ;; esac

  LIGHT_BAR=40

  if [ "$lines" -gt 0 ]; then
    state="SESSION STATE — $SESSION_FILE (your task queue across compactions; keep it current):
$(cat "$SESSION_FILE")"

    if [ "$lines" -gt "$LIGHT_BAR" ]; then
      state="$state
NOTE: session.md is $lines content lines (bar $LIGHT_BAR) — it is a queue, not a journal. Promote anything durable to its issue and prune the rest."
    fi

    # The two closing lines (issue #134), one per reader, and only where the
    # state above them exists — a silent injection stays silent, on both
    # channels. The duty rides with the state it is about rather than with the
    # manager instruction, so it reaches a non-manager session too; the owner
    # line is LAST, the last thing read before the session's first reply, under
    # the rule that separates both from the file body.
    state="$state

---
Manager: open your first reply after a restart or compaction with this state in plain words.
Owner: state carried over — say \"continue\" and this session resumes the queue above."
    owner='workkit: state carried over — say "continue" to resume the session queue'
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

# The owner line rides the visible channel only when there is state to resume —
# a stale brief is the manager's to report, in its own words, in the reply the
# owner is already reading.
jq -n --arg ctx "$msg" --arg owner "$owner" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
} + (if $owner == "" then {} else { "systemMessage": $owner } end)'
exit 0
