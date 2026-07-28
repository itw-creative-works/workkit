#!/bin/bash
# docs:session — SessionStart hook (issue #56).
# Hands the session its own task state back: `.workkit/session.md` is what keeps
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
# Silent for an absent file, a file holding only its header, and a repo that has
# not opted in. Always exits 0 — a context injection must never cost a session.

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
SESSION_FILE="$root/.workkit/session.md"

# Participation gate. The committed settings.json is the repo's yes; a
# deliberate `"enabled": false` is its no. An undecided repo has no session.md
# to read anyway — the heal never writes into one — so the committed file is the
# whole signal this hook needs, and it stays free of the engine.
[ -f "$SETTINGS" ] || exit 0
grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$SETTINGS" 2>/dev/null && exit 0

[ -f "$SESSION_FILE" ] || exit 0

# Content lines: non-blank, not a heading, not a blockquote note, not an HTML
# comment — the template's own scaffolding is all four, so a freshly seeded file
# counts zero and says nothing.
# (grep -c prints its count even when exiting 1 on zero matches — don't add a
# fallback echo or the count doubles.)
lines=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#|^[[:space:]]*>|^[[:space:]]*<!--' "$SESSION_FILE" 2>/dev/null) || true
lines="${lines:-0}"
case "$lines" in ''|*[!0-9]*) lines=0 ;; esac
[ "$lines" -gt 0 ] || exit 0

LIGHT_BAR=40

msg="SESSION STATE — $SESSION_FILE (your task queue across compactions; keep it current):
$(cat "$SESSION_FILE")"

if [ "$lines" -gt "$LIGHT_BAR" ]; then
  msg="$msg
NOTE: session.md is $lines content lines (bar $LIGHT_BAR) — it is a queue, not a journal. Promote anything durable to its issue and prune the rest."
fi

jq -n --arg ctx "$msg" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
exit 0
