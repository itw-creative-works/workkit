#!/usr/bin/env bash
# manager:spawn-guard: PreToolUse hook on the Agent tool. Warns, never blocks
# or rewrites, on rule 1 (a class spawn carrying a hand-passed `model`, silent
# in advise mode) and rule 2 (a frontier session spawning the advisor). The
# output carries no permissionDecision, since "allow" would auto-approve the
# spawn. Hooks on one event run in parallel on the original tool_input, so the
# resolver's rewrite never reaches rule 1. Fails open like the resolver.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

tool_name=$(printf '%s' "$input" | hook_jq -r '.tool_name // empty' 2>/dev/null || true)
case "$tool_name" in Task|Agent) ;; *) exit 0 ;; esac

# Both spellings, normalized exactly as the resolver normalizes them.
class=$(printf '%s' "$input" | hook_jq -r '.tool_input.subagent_type // empty' 2>/dev/null || true)
case "$class" in
  scout|worker|verifier|advisor) ;;
  workkit:scout|workkit:worker|workkit:verifier|workkit:advisor) class="${class#workkit:}" ;;
  *) exit 0 ;;
esac

ladder="${MANAGER_LADDER:-${BASH_SOURCE[0]%/*}/../resources/ladder.json}"
cwd=$(printf '%s' "$input" | hook_jq -r '.cwd // empty' 2>/dev/null || true)
hook_manager_config "$ladder" "$cwd" || exit 0
config="$HOOK_MANAGER_CONFIG"
# A ladder that carries no rungs is not a ladder: nothing below can be judged.
[ "$(printf '%s' "$config" | hook_jq_default '0' -r '(.ladder // {}) | length')" -gt 0 ] 2>/dev/null || exit 0

mode=$(printf '%s' "$config" | hook_jq_default 'rewrite' -r 'if .mode == "advise" then "advise" else "rewrite" end')
spawn_model=$(printf '%s' "$input" | hook_jq -r '.tool_input.model // empty' 2>/dev/null || true)

warning=""
add() { [ -z "$warning" ] && warning="$1" || warning="$warning $1"; }

if [ -n "$spawn_model" ] && [ "$mode" = "rewrite" ]; then
  add "the $class spawn passed model: $spawn_model. The manager:resolver hook owns crew models; drop the param and let the ladder resolve it."
fi

if [ "$class" = "advisor" ]; then
  frontier=$(printf '%s' "$config" | hook_jq_default 'fable' -r '.tiers.frontier // empty')
  session_id=$(printf '%s' "$input" | hook_jq -r '.session_id // empty' 2>/dev/null || true)
  transcript_path=$(printf '%s' "$input" | hook_jq -r '.transcript_path // empty' 2>/dev/null || true)
  if hook_session_model "$session_id" "$transcript_path" 2>/dev/null \
    && hook_model_tier "$HOOK_SESSION_MODEL" 2>/dev/null \
    && [ "$HOOK_MODEL_TIER" = "$frontier" ]; then
    add "this session already runs the frontier model: the advisor is redundant here."
  fi
fi

[ -n "$warning" ] || exit 0

hook_pretool_notice "manager:spawn-guard: $warning"
exit 0
