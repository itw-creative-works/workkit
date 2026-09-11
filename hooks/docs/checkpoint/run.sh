#!/usr/bin/env bash
# docs:checkpoint, a UserPromptSubmit hook (issue #238).
# Any line about compacting, clearing, or restarting the chat fires the
# workkit:checkpoint skill BEFORE the line is answered: a long chat holds
# verdicts, decisions and questions that exist nowhere else, and a compaction
# throws away whatever was never written to the board.
#
# The skill's own description already asks for this, but a description is
# judgment: it competes with everything else in the turn and loses exactly when
# the context is full, which is the moment the line is spoken. The pattern here
# is deterministic, so the instruction arrives every time.
#
# Fired twice in one session, the second injection is a DELTA: a marker under
# ${TMPDIR:-/tmp}/claude-checkpoint-marker, keyed by session id, carries the
# time of the last fire, so a second run files only what has been spoken since
# rather than walking the whole chat again.
#
# Always exits 0: it never blocks a prompt, and a missing jq, an unreadable
# marker or an unparseable payload is silence rather than noise.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

prompt=$(printf '%s' "$input" | jq -r '.prompt // ""' 2>/dev/null || true)
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)

[ -n "$prompt" ] || exit 0

# `compact` is deliberately a substring: it carries `compaction` and `/compact`
# with it. `context` only fires beside one of its four followers, on the same
# line, so "the context of the bug" is not a compaction line, and each follower
# is bounded by a non-letter so "below" is not "low". The spoken order runs
# the other way too ("running out of context", "low on context"), so the
# reversed arm carries those three forms. The prompt is lowercased
# rather than matched with `grep -i`, which is what keeps those negated classes
# meaning what they say.
PATTERN='compact|clear the chat|clear this chat|new chat|fresh session|start over|context.*(^|[^a-z])(full|low|running out|window)([^a-z]|$)|(running out of|out of|low on) context'

lower=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')
grep -qE "$PATTERN" <<<"$lower" || exit 0

FIRST="[Compaction line detected (#238): run the workkit:checkpoint skill before anything else in this turn, then answer the line. It files every verdict, decision and question from this chat onto its issue and trims session.md, so nothing is lost when the context is compacted.]"

ctx="$FIRST"

# No session id means no marker to key: the full line every time, which is the
# safe direction (a whole-chat pass files more than a delta, never less).
if [ -n "$session_id" ]; then
  marker_dir="${TMPDIR:-/tmp}/claude-checkpoint-marker"
  marker="$marker_dir/${session_id//[^a-zA-Z0-9]/_}"
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

jq -n --arg ctx "$ctx" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
exit 0
