#!/usr/bin/env bash
# docs:checkpoint: UserPromptSubmit hook. A line about compacting, clearing or
# restarting the chat fires the workkit:checkpoint skill before it is answered:
# deterministic, since the skill's description loses exactly when context is
# full. A second fire in a session asks for a delta. Always exits 0.
# Detail: docs/hooks.md § docs:checkpoint.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

prompt=$(printf '%s' "$input" | hook_jq -r '.prompt // ""' 2>/dev/null || true)
session_id=$(printf '%s' "$input" | hook_jq -r '.session_id // empty' 2>/dev/null || true)

[ -n "$prompt" ] || exit 0
# A hand-back or notification is not the owner's line, whatever words it holds.
hook_prompt_is_system "$prompt" && exit 0

# `compact` is a substring on purpose (`compaction`, `/compact`). `context` fires
# only beside a follower on the same line, each bounded by a non-letter ("below"
# is not "low"), plus the reversed spoken order. The prompt is lowercased rather
# than matched with `grep -i`, which keeps the negated classes meaning what they say.
PATTERN='compact|clear the chat|clear this chat|new chat|fresh session|start over|context.*(^|[^a-z])(full|low|running out|window)([^a-z]|$)|(running out of|out of|low on) context'

lower=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')
grep -qE "$PATTERN" <<<"$lower" || exit 0

FIRST="[Compaction line detected (#238): run the workkit:checkpoint skill before anything else in this turn, then answer the line. It files every verdict, decision and question from this chat onto its issue and trims session.md, so nothing is lost when the context is compacted.]"

ctx="$FIRST"

# No session id means no marker to key: the full line every time, which is the
# safe direction (a whole-chat pass files more than a delta, never less).
if [ -n "$session_id" ]; then
  marker=$(hook_session_marker claude-checkpoint-marker "$session_id")
  marker_dir="${marker%/*}"
  if [ -f "$marker" ]; then
    mtime=$(hook_file_mtime "$marker")
    # BSD `date -r` takes the epoch seconds; GNU spells it `-d @<epoch>` and
    # reads `-r` as a filename, so the first form simply fails there.
    stamp=$(date -r "$mtime" +%H:%M 2>/dev/null || date -d "@$mtime" +%H:%M 2>/dev/null || date +%H:%M)
    ctx="[Compaction line detected (#238): the workkit:checkpoint instruction was already issued this session at ${stamp}. Run the skill again only for verdicts, decisions and questions spoken since then, as a delta, then answer the line.]"
  fi
  mkdir -p "$marker_dir" 2>/dev/null || true
  : > "$marker" 2>/dev/null || true
fi

hook_jq -n --arg ctx "$ctx" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
exit 0
