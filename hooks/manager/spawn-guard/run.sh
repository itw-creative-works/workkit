#!/usr/bin/env bash
# manager:spawn-guard — PreToolUse hook on the Agent tool (issue #18).
# The manager system's WARN-ONLY companion to manager/resolver: it watches
# class spawns for the two shapes that mean the manager is working against its
# own wiring, and says so. It never blocks and never rewrites — the output
# carries NO permissionDecision at all, so the spawn's fate is decided exactly
# as it would be with this hook absent.
# Rules:
#   1  a class spawn (scout / worker / verifier / advisor) carrying a `model`
#      param — the manager passed a model by hand, which in rewrite mode the
#      resolver reads as a deliberate override and steps aside for. Silent in
#      advise mode, where the resolver ASKS for the model param.
#   2  an advisor spawn from a frontier session — the session already is the
#      frontier model, so the consult buys nothing (the same clause the
#      manager/profile hook injects).
# Everything else is silent. Same fail-open discipline as the resolver: no jq,
# no ladder, garbage stdin, unknown session model → exit 0 with no output.
#
# Warning channel: top-level `systemMessage` (shown to the user) plus
# `hookSpecificOutput.additionalContext` (added to Claude's context alongside
# the tool result — non-blocking, unlike the Stop event's same-named field).
# Both are PreToolUse-legal without a decision; adding `permissionDecision:
# "allow"` would auto-approve the spawn, which is a behavior change this hook
# has no business making.
#
# Ordering note: PreToolUse hooks matching one event all run in PARALLEL and
# each receives the ORIGINAL tool_input (hooks reference § How a hook resolves),
# so the resolver's `updatedInput` model can never reach rule 1 — only a model
# the manager itself passed.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)
case "$tool_name" in Task|Agent) ;; *) exit 0 ;; esac

# Both spellings, normalized exactly as the resolver normalizes them.
class=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null || true)
case "$class" in
  scout|worker|verifier|advisor) ;;
  workkit:scout|workkit:worker|workkit:verifier|workkit:advisor) class="${class#workkit:}" ;;
  *) exit 0 ;;
esac

ladder="${MANAGER_LADDER:-${BASH_SOURCE[0]%/*}/../ladder.json}"
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
hook_manager_config "$ladder" "$cwd" || exit 0
config="$HOOK_MANAGER_CONFIG"
# A ladder that carries no rungs is not a ladder — nothing below can be judged.
[ "$(printf '%s' "$config" | jq -r '(.ladder // {}) | length' 2>/dev/null || printf '0')" -gt 0 ] 2>/dev/null || exit 0

mode=$(printf '%s' "$config" | jq -r 'if .mode == "advise" then "advise" else "rewrite" end' 2>/dev/null || echo "rewrite")
spawn_model=$(printf '%s' "$input" | jq -r '.tool_input.model // empty' 2>/dev/null || true)

warning=""
add() { [ -z "$warning" ] && warning="$1" || warning="$warning $1"; }

if [ -n "$spawn_model" ] && [ "$mode" = "rewrite" ]; then
  add "the $class spawn passed model: $spawn_model — the manager:resolver hook owns crew models; drop the param and let the ladder resolve it."
fi

if [ "$class" = "advisor" ]; then
  frontier=$(printf '%s' "$config" | jq -r '.tiers.frontier // "fable"' 2>/dev/null || printf 'fable')
  session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
  transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)
  if hook_session_model "$session_id" "$transcript_path" 2>/dev/null \
    && hook_model_tier "$HOOK_SESSION_MODEL" 2>/dev/null \
    && [ "$HOOK_MODEL_TIER" = "$frontier" ]; then
    add "this session already runs the frontier model — the advisor is redundant here."
  fi
fi

[ -n "$warning" ] || exit 0

jq -n --arg w "manager:spawn-guard: $warning" '{
  "systemMessage": $w,
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": $w
  }
}'
exit 0
