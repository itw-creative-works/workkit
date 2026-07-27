#!/usr/bin/env bash
# manager:resolver — PreToolUse hook on the Agent tool (issue #11).
# Supplies each CLASS agent spawn (scout / worker / verifier / advisor) its
# concrete model from the tier ladder (../ladder.json) and the LIVE session
# model, so a mid-session /model switch takes effect on the very next spawn.
# Decision table:
#   advisor          → the frontier rung, always (its whole point)
#   worker/verifier  → the WEAKER of the workhorse rung and the session's own
#                      rung — the crew never outspends the session model, and
#                      the frontier is never burned on implementation
#   scout            → the fast rung, always
#   anything else    → pass through UNTOUCHED (Explore, Plan, general-purpose,
#                      reviewer, unknown types — this hook must never break them)
# The ladder is the GLOBAL layer: `hook_manager_config` merges the `manager`
# block of this repo's `.workkit/settings.json` over the one in
# `~/.workkit/settings.json` over it, so a repo can move a class onto a
# cheaper rung (`tiers`), pick a `mode`, or turn the crew off entirely
# (`enabled: false` — every spawn then passes through untouched).
# Modes (the merged "mode"):
#   rewrite — emit hookSpecificOutput.updatedInput carrying the resolved model
#   advise  — allow a spawn already carrying the resolved model; block any
#             other class spawn (exit 2) naming the exact model to re-issue
#             with. The landing spot for CC versions that ignore updatedInput
#             on the Agent tool.
# Fails OPEN on every missing precondition (no jq, no ladder, garbage stdin):
# a broken resolver must degrade to "agents spawn as before", never to a
# broken session. MANAGER_DEBUG=1 appends one decision line per spawn to
# ${TMPDIR:-/tmp}/claude-manager-resolver.log (used by the live probe).
#
# Probed live 2026-07-26 (CC 2.1.219): updatedInput IS honored on the Agent
# tool — a scout under a sonnet session ran on haiku. The one constraint:
# the tool's model param is an ALIAS ENUM (sonnet/opus/haiku/fable); a full
# model id fails schema validation before the spawn runs, which is why the
# ladder's model values are aliases.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

tool_name=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null || true)
case "$tool_name" in Task|Agent) ;; *) exit 0 ;; esac

class=$(printf '%s' "$input" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null || true)
# Both spellings: the class agents answer to their bare names while they live
# in ~/.claude/agents, and to `workkit:<name>` once they ship with this plugin
# (agents in a plugin are namespaced by it). The prefix is stripped here so
# everything below — the ladder lookup, the advise message — reads one name.
case "$class" in
  scout|worker|verifier|advisor) ;;
  workkit:scout|workkit:worker|workkit:verifier|workkit:advisor) class="${class#workkit:}" ;;
  *) exit 0 ;;
esac

# The effective config (ladder, then the user's overrides, then this repo's) —
# resolved only once a class spawn is confirmed, so the layer reads and the git
# call never sit on an ordinary tool use. `enabled: false` = a solo repo.
ladder="${MANAGER_LADDER:-${BASH_SOURCE[0]%/*}/../ladder.json}"
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
hook_manager_config "$ladder" "$cwd" || exit 0
config="$HOOK_MANAGER_CONFIG"

spawn_model=$(printf '%s' "$input" | jq -r '.tool_input.model // empty' 2>/dev/null || true)
mode=$(printf '%s' "$config" | jq -r 'if .mode == "advise" then "advise" else "rewrite" end' 2>/dev/null || echo "rewrite")

# In rewrite mode an explicit model param is the manager's deliberate override
# and wins; in advise mode it is checked against the resolution below instead.
if [ "$mode" = "rewrite" ] && [ -n "$spawn_model" ]; then exit 0; fi

# rung_rank <rung> — position in the ladder's key order (0 = strongest);
# prints -1 for a rung the ladder does not carry.
rung_rank() {
  printf '%s' "$config" | jq -r --arg r "$1" '.ladder | keys_unsorted | index($r) // -1' 2>/dev/null || printf '%s' "-1"
}

# The class's default rung, via its capability tier.
tier=$(printf '%s' "$config" | jq -r --arg c "$class" '.classes[$c] // empty' 2>/dev/null || true)
rung=$(printf '%s' "$config" | jq -r --arg t "$tier" '.tiers[$t] // empty' 2>/dev/null || true)
[ -n "$rung" ] || exit 0
[ "$(rung_rank "$rung")" -ge 0 ] 2>/dev/null || exit 0

# The session cap: worker/verifier never run a STRONGER rung than the session
# model itself. Unknown session (fresh VS Code first prompt) → no cap.
if [ "$class" = "worker" ] || [ "$class" = "verifier" ]; then
  session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
  transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)
  if hook_session_model "$session_id" "$transcript_path" 2>/dev/null \
    && hook_model_tier "$HOOK_SESSION_MODEL" 2>/dev/null; then
    session_rank=$(rung_rank "$HOOK_MODEL_TIER")
    if [ "$session_rank" -gt "$(rung_rank "$rung")" ] 2>/dev/null; then
      rung="$HOOK_MODEL_TIER"
    fi
  fi
fi

model=$(printf '%s' "$config" | jq -r --arg r "$rung" '.ladder[$r] // empty' 2>/dev/null || true)
[ -n "$model" ] || exit 0

if [ "${MANAGER_DEBUG:-}" = "1" ]; then
  printf '%s class=%s mode=%s model=%s session=%s\n' \
    "$(date '+%H:%M:%S')" "$class" "$mode" "$model" "${HOOK_SESSION_MODEL:-?}" \
    >> "${TMPDIR:-/tmp}/claude-manager-resolver.log" 2>/dev/null || true
fi

if [ "$mode" = "advise" ]; then
  [ "$spawn_model" = "$model" ] && exit 0
  printf 'manager:resolver: %s runs on %s for this session — re-issue the Agent call with model: %s\n' \
    "$class" "$model" "$model" >&2
  exit 2
fi

tool_input=$(printf '%s' "$input" | jq -c '.tool_input // {}' 2>/dev/null || printf '{}')
jq -n --argjson ti "$tool_input" --arg m "$model" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "updatedInput": ($ti + {"model": $m})
  }
}'
exit 0
