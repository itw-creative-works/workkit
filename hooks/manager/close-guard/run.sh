#!/usr/bin/env bash
# manager:close-guard — Stop hook (issue #18).
# Looks back over the turn that just ended and names the two manager-system
# habits worth catching: the frontier model doing bulk implementation itself,
# and built work ending the turn unreviewed. WARN-ONLY — it always exits 0 and
# never continues the conversation.
# Rules:
#   3  a frontier session that made >= MANAGER_CLOSE_EDITS (default 5) Edit or
#      Write calls itself and spawned no worker
#   4  a turn that spawned >= 1 worker and no verifier
# Both are judgment calls that are sometimes right, which is exactly why this
# hook only says so.
#
# Warning channel: top-level `systemMessage` ONLY. The Stop event's
# `hookSpecificOutput.additionalContext` CONTINUES the conversation so Claude
# can act on it (hooks reference § Stop decision control) — that is a
# continuation this hook is not entitled to, so the user-visible line is the
# whole output.
#
# The turn window: the transcript entries after the last real user prompt —
# skipping meta entries, tool results, sidechain (subagent) entries so a
# worker's own edits are never counted as the manager's, and the SYSTEM-INJECTED
# pseudo-prompts that arrive as ordinary user entries. Those are the tagged
# shapes a survey of this machine's transcripts turned up — <ide_opened_file>,
# <ide_selection>, <task-notification>, <task-id>, <command-name>,
# <command-message>, <local-command-stdout>, <system-reminder> — and the test is
# the SHAPE (the text opens with a <tag>), not that closed list, because the
# list grows with the IDE. An editing session in VS Code emits them constantly,
# and counting one as a prompt resets the window mid-turn — the exact case rule
# 3 exists to catch. A real prompt that happens to open with a markup tag is
# read as an injection and widens the window: usually that means a missed
# warning, and rarely two turns blend into one and warn together — tolerable
# because the hook only ever warns.
# Only the tail of the transcript is read (a resumed session's file reaches
# gigabytes, and this runs on every Stop); when no user prompt is visible in
# that tail the turn cannot be identified and the hook stays silent. Fails open
# on every other missing precondition too.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

# How many transcript lines back the turn is looked for.
SCAN_LINES=4000

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

# Already continuing because of a Stop hook — the turn was judged once.
stop_hook_active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || true)
if [ "$stop_hook_active" = "true" ]; then exit 0; fi

transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)
[ -n "$transcript_path" ] && [ -f "$transcript_path" ] || exit 0

ladder="${MANAGER_LADDER:-${BASH_SOURCE[0]%/*}/../ladder.json}"
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
hook_manager_config "$ladder" "$cwd" || exit 0
frontier=$(printf '%s' "$HOOK_MANAGER_CONFIG" | jq -r '.tiers.frontier // "fable"' 2>/dev/null || printf 'fable')

edit_threshold="${MANAGER_CLOSE_EDITS:-5}"
case "$edit_threshold" in ''|*[!0-9]*) edit_threshold=5 ;; esac

# One marker word per interesting entry, oldest first: PROMPT for a real user
# turn boundary, EDIT for an Edit/Write call, SPAWN:<class> for an agent spawn
# (both the bare and workkit:-prefixed spellings read as one class name), and
# MODEL:<id> for an assistant entry's model — the session's own model, read from
# the pass this hook is already making rather than from a whole-file grep.
markers=$(tail -n "$SCAN_LINES" "$transcript_path" 2>/dev/null | jq -R -r '
  fromjson?
  | select(type == "object")
  | select(.isSidechain != true)
  | if (.type == "user" and (.isMeta != true)
        and (((.message.content | type) == "string")
             or (((.message.content | type) == "array")
                 and (([.message.content[] | select(type == "object") | .type] | index("tool_result")) == null))))
    then (if (((if (.message.content | type) == "string" then .message.content
                else ([.message.content[] | select(type == "object" and .type == "text") | .text] | join(""))
                end) // "") | test("^[[:space:]]*<[A-Za-z][A-Za-z0-9_.:-]*>"))
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

# The session model, from the LAST assistant entry of the tail already read.
# hook_session_model is the fallback, not the first call: its own transcript
# path greps the WHOLE file, which on a resumed multi-gigabyte transcript costs
# seconds on every Stop, and the statusline cache that would short-circuit it is
# empty in VS Code sessions — so the slow path is the normal one there. The tail
# answers the same question from bytes already in hand, and at Stop time the
# last assistant entry IS the model that just ran this turn.
model=$(printf '%s\n' "$markers" | grep '^MODEL:' | tail -1 || true)
model="${model#MODEL:}"
if [ -z "$model" ]; then
  session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
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
  add "the frontier model made $edits edits itself this turn with no worker spawn — implementation belongs with workkit:worker"
fi

if [ "$workers" -ge 1 ] && [ "$verifiers" -eq 0 ]; then
  add "$workers worker spawn(s) this turn and no verifier — consider a verifier pass over the build"
fi

[ -n "$warning" ] || exit 0

jq -n --arg w "manager:close-guard: $warning." '{"systemMessage": $w}'
exit 0
