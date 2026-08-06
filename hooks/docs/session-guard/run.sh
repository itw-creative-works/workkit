#!/bin/bash
# docs:session-guard — PostToolUse hook (Edit|Write), issue #126.
# Holds `.workkit/agents/session.md` to the shape it exists in: a TASK QUEUE, read
# back on every session start, not a journal of what already shipped. Two caps,
# both constants below — a bullet that has grown into a paragraph, and a file
# that has grown into the retired PROGRESS.md.
#
# POST, not pre: an Edit's result is only knowable once it is on disk, and the
# caps judge the resulting file, never the patch. A write that shrinks an
# oversized file but leaves it over still bounces — the message is what
# finishes the prune.
#
# The backstop for what this never saw (hand edits, files predating the hook)
# is the docs/session hook, which warns past the same bar at injection time.
# The ship skill's close step is where entries normally leave: their facts move
# to the CHANGELOG and the closed issue.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" 2>/dev/null || true)
[ -n "$file_path" ] || exit 0

# This hook sources nothing, so the directory name is spelled out; its SSOT is
# WORKKIT_DIR in hooks/_lib.sh — change both together.
[ "$(basename "$file_path")" = "session.md" ] || exit 0
session_dir="$(dirname "$file_path")"
[ "$(basename "$session_dir")" = "agents" ] || exit 0
[ "$(basename "$(dirname "$session_dir")")" = ".workkit" ] || exit 0
[ -f "$file_path" ] || exit 0

MAX_BULLET_CHARS=350
MAX_CONTENT_LINES=40

problems=""

# The first bullet over the cap — optional indent, then `- ` or `* `. One is
# enough to bounce; the rest surface on the next write.
offender=$(awk -v cap="$MAX_BULLET_CHARS" '
  /^[ \t]*[-*][ \t]/ && length($0) > cap {
    printf "%d\t%s\n", length($0), substr($0, 1, 60)
    exit
  }' "$file_path" 2>/dev/null) || true

if [ -n "$offender" ]; then
  # length<TAB>first 60 chars — the tab is spelled $'\t' so it stays visible.
  problems="$problems
  - a bullet is ${offender%%$'\t'*} chars (cap $MAX_BULLET_CHARS): ${offender#*$'\t'}…"
fi

# Content lines: non-blank, not a heading, not a blockquote note, not an HTML
# comment — the same count the docs/session hook takes, so the two agree about
# what "over the bar" means. The count AND the bar live in both files; change
# them together.
# (grep -c prints its count even when exiting 1 on zero matches — don't add a
# fallback echo or the count doubles.)
lines=$(grep -cvE '^[[:space:]]*$|^[[:space:]]*#|^[[:space:]]*>|^[[:space:]]*<!--' "$file_path" 2>/dev/null) || true
lines="${lines:-0}"
case "$lines" in ''|*[!0-9]*) lines=0 ;; esac

if [ "$lines" -gt "$MAX_CONTENT_LINES" ]; then
  problems="$problems
  - $lines content lines (cap $MAX_CONTENT_LINES)."
fi

[ -n "$problems" ] || exit 0

{
  echo "session-guard: $file_path is a queue, not a journal — prune it before any other work.$problems"
  echo "Promote anything durable to its issue or the CHANGELOG, delete what has already shipped, and split or trim an oversized bullet."
} >&2
exit 2
