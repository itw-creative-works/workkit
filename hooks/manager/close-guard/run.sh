#!/usr/bin/env bash
# manager:close-guard: Stop hook. Warns, never blocks, over the turn that just
# ended: rule 3, a frontier session making >= MANAGER_CLOSE_EDITS (default 5)
# edits itself with no worker; rule 4, a worker spawned with no verifier. The
# line rides systemMessage alone, since a Stop hook's additionalContext would
# continue the turn. Only the transcript tail is read; fails open.
# Detail: docs/hooks.md § manager:close-guard.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

# How many transcript lines back the turn is looked for.
SCAN_LINES=4000

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

# Already continuing because of a Stop hook: the turn was judged once.
stop_hook_active=$(printf '%s' "$input" | hook_jq -r '.stop_hook_active // false' 2>/dev/null || true)
if [ "$stop_hook_active" = "true" ]; then exit 0; fi

transcript_path=$(printf '%s' "$input" | hook_jq -r '.transcript_path // empty' 2>/dev/null || true)
[ -n "$transcript_path" ] && [ -f "$transcript_path" ] || exit 0

ladder="${MANAGER_LADDER:-${BASH_SOURCE[0]%/*}/../resources/ladder.json}"
cwd=$(printf '%s' "$input" | hook_jq -r '.cwd // empty' 2>/dev/null || true)
hook_manager_config "$ladder" "$cwd" || exit 0
frontier=$(printf '%s' "$HOOK_MANAGER_CONFIG" | hook_jq_default 'fable' -r '.tiers.frontier // empty')

edit_threshold="${MANAGER_CLOSE_EDITS:-5}"
case "$edit_threshold" in ''|*[!0-9]*) edit_threshold=5 ;; esac

# One marker word per interesting entry, oldest first: PROMPT, EDIT,
# SPAWN:<class> (bare and workkit: spellings alike), and MODEL:<id>, the
# session's model read from this same pass. A PROMPT is the owner's: the
# system-delivered shapes are hook_prompt_is_system's patterns.
markers=$(tail -n "$SCAN_LINES" "$transcript_path" 2>/dev/null | hook_jq -R -r \
  --arg tag "$HOOK_PROMPT_TAG_RE" --arg paste "$HOOK_PROMPT_PASTE_RE" --arg frame "$HOOK_PROMPT_FRAME_RE" '
  fromjson?
  | select(type == "object")
  | select(.isSidechain != true)
  | if (.type == "user" and (.isMeta != true)
        and (((.message.content | type) == "string")
             or (((.message.content | type) == "array")
                 and (([.message.content[] | select(type == "object") | .type] | index("tool_result")) == null))))
    then (if (((if (.message.content | type) == "string" then .message.content
                else ([.message.content[] | select(type == "object" and .type == "text") | .text] | join(""))
                end) // "")
              | test($frame) or (test($tag) and (test($paste) | not)))
          then empty else "PROMPT" end)
    elif (.type == "assistant")
    then ((if (.message.model | type) == "string" then "MODEL:" + .message.model else empty end),
          (if (.message.content | type) == "array"
           then (.message.content[]
                 | select(type == "object" and .type == "tool_use")
                 | if (.name == "Edit" or .name == "Write") then "EDIT"
                   elif (.name == "Task" or .name == "Agent")
                   then "SPAWN:" + ((.input.subagent_type // "?") | sub("^workkit:"; ""))
                   else empty end)
           else empty end))
    else empty end' 2>/dev/null || true)

[ -n "$markers" ] || exit 0
printf '%s\n' "$markers" | grep -q '^PROMPT$' || exit 0

# Everything after the LAST prompt is this turn.
window=$(printf '%s\n' "$markers" | awk '{a[NR] = $0} /^PROMPT$/ {last = NR} END {for (i = last + 1; i <= NR; i++) print a[i]}')

edits=$(printf '%s\n' "$window" | grep -c '^EDIT$' || true)
workers=$(printf '%s\n' "$window" | grep -c '^SPAWN:worker$' || true)
verifiers=$(printf '%s\n' "$window" | grep -c '^SPAWN:verifier$' || true)

# The session model from the tail's last assistant entry, which at Stop is the
# model that ran this turn. hook_session_model is only the fallback: the
# statusline cache, then the transcript's last 200 lines.
model=$(printf '%s\n' "$markers" | grep '^MODEL:' | tail -1 || true)
model="${model#MODEL:}"
if [ -z "$model" ]; then
  session_id=$(printf '%s' "$input" | hook_jq -r '.session_id // empty' 2>/dev/null || true)
  if hook_session_model "$session_id" "$transcript_path" 2>/dev/null; then
    model="$HOOK_SESSION_MODEL"
  fi
fi

tier=""
if [ -n "$model" ] && hook_model_tier "$model" 2>/dev/null; then
  tier="$HOOK_MODEL_TIER"
fi

warning=""
add() { [ -z "$warning" ] && warning="$1" || warning="$warning; $1"; }

if [ "$tier" = "$frontier" ] && [ "$edits" -ge "$edit_threshold" ] && [ "$workers" -eq 0 ]; then
  add "the frontier model made $edits edits itself this turn with no worker spawn: implementation belongs with workkit:worker"
fi

if [ "$workers" -ge 1 ] && [ "$verifiers" -eq 0 ]; then
  add "$workers worker spawn(s) this turn and no verifier: consider a verifier pass over the build"
fi

[ -n "$warning" ] || exit 0

hook_jq -n --arg w "manager:close-guard: $warning." '{"systemMessage": $w}'
exit 0
