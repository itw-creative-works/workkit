#!/usr/bin/env bash
# workflow:feature: UserPromptSubmit hook. A line about working an issue loads
# the workkit:feature skill: deterministic, where the skill's own description
# triggers are the model's call. A strong fire writes the session marker, and every
# later fire is then silent, the skill already being in context. Always exits 0.
# Detail: docs/hooks.md § workflow:feature.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

prompt=$(printf '%s' "$input" | hook_jq -r '.prompt // ""' 2>/dev/null || true)
session_id=$(printf '%s' "$input" | hook_jq -r '.session_id // empty' 2>/dev/null || true)

[ -n "$prompt" ] || exit 0
# A hand-back or notification is not the owner's line, whatever words it holds.
hook_prompt_is_system "$prompt" && exit 0

# STRONG: `#N` or a whole-word queue phrase (`presume` is not `resume`). WEAK: a
# bare 2 to 4 digits bounded by non-alphanumerics (`1.2.3` and `a1234b` stay
# silent), which may be a port or a year. Double-quoted for the apostrophes.
STRONG="#[0-9]+|(^|[^a-z])(work on|work the|do issue|the issues|next issue|what next|what'?s next|what'?s left|continue|resume|keep going|what now|next one|go now|lets do|let's do|finish up|task list|the queue|the batch|open items|the board)([^a-z]|\$)"
WEAK="(^|[^a-z0-9])[0-9]{2,4}([^a-z0-9]|\$)"

# The curly apostrophe goes straight by its bytes in bash: GNU tr is bytewise,
# so a multibyte character in its sets would map byte by byte.
curly=$'\xe2\x80\x99' straight="'"
lower=$(printf '%s' "${prompt//$curly/$straight}" | tr '[:upper:]' '[:lower:]')
strong=0
if grep -qE "$STRONG" <<<"$lower"; then
  strong=1
else
  grep -qE "$WEAK" <<<"$lower" || exit 0
fi

# No session id means no marker to key: the full line every time. Only a strong
# match spends the session's one load, so a false weak fire cannot silence it.
if [ -n "$session_id" ]; then
  marker=$(hook_session_marker claude-feature-marker "$session_id")
  [ -f "$marker" ] && exit 0
  if [ "$strong" = 1 ]; then
    mkdir -p "${marker%/*}" 2>/dev/null || true
    : > "$marker" 2>/dev/null || true
  fi
fi

hook_jq -n --arg ctx "[Issue work detected (#374): load the workkit:feature skill before working the issue.]" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
exit 0
