#!/usr/bin/env bash
# manager:profile — UserPromptSubmit hook (issue #11).
# Injects the MANAGER standing instruction: the main chat is the conversation
# and judgment layer; the class agents (scout / worker / verifier / advisor)
# do the work, with models supplied per spawn by the manager/resolver hook.
# Re-injected every turn for the same reason comms/style is: standing rules
# stated once get buried under competing instructions.
#
# Injection condition: only manager-capable sessions get the profile — the
# session tier is the frontier or workhorse rung (read from ../ladder.json),
# or unknown (a fresh VS Code first prompt; the owner's default model is frontier,
# so silence there would drop the profile exactly where it matters most).
# A sonnet/haiku session is a deliberately cheap solo session: no crew, no
# profile, no output at all. The tier names come from the LAYERED config
# (`hook_manager_config`): this repo's `.workkit/settings.json` `manager`
# block over the user's over the ladder, and `enabled: false` silences the
# profile outright. Always exits 0 — never blocks a prompt.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

ladder="${MANAGER_LADDER:-${BASH_SOURCE[0]%/*}/../ladder.json}"
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
hook_manager_config "$ladder" "$cwd" || exit 0
frontier=$(printf '%s' "$HOOK_MANAGER_CONFIG" | jq -r '.tiers.frontier // "fable"' 2>/dev/null || printf 'fable')
workhorse=$(printf '%s' "$HOOK_MANAGER_CONFIG" | jq -r '.tiers.workhorse // "opus"' 2>/dev/null || printf 'opus')

session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)
transcript_path=$(printf '%s' "$input" | jq -r '.transcript_path // empty' 2>/dev/null || true)

tier=""
if hook_session_model "$session_id" "$transcript_path" 2>/dev/null \
  && hook_model_tier "$HOOK_SESSION_MODEL" 2>/dev/null; then
  tier="$HOOK_MODEL_TIER"
fi

# Known cheap session → solo mode, no profile.
if [ -n "$tier" ] && [ "$tier" != "$frontier" ] && [ "$tier" != "$workhorse" ]; then
  exit 0
fi

# Advisor clause: a frontier session IS the advisor; anything else (including
# unknown — treated as frontier-capable above, but the consult line is only
# offered when the tier is POSITIVELY below frontier) gets the consult line.
if [ -n "$tier" ] && [ "$tier" != "$frontier" ]; then
  advisor='Consult the workkit:advisor agent for plans and hard judgment calls — it runs on the frontier model.'
else
  advisor='You are the frontier model — the workkit:advisor agent is redundant; do not spawn it.'
fi

ctx="[Manager: you are the MANAGER — conversation, judgment, and dispatch; keep this context token-slim. Delegate the volume: recon and bulk reading to the workkit:scout agent, implementation against a brief to the workkit:worker agent, blind review of worker output to the workkit:verifier agent. ${advisor} The manager:resolver hook supplies each spawn's model — never pass a model param yourself. Dispatch by file handoff: write the brief to a file, name the report path in it, and have the agent return status only. Subagents never spawn subagents. Size the crew to the task: a small change is you alone or one worker; a feature is one worker, or a worker pair only under worktree isolation; the verifier runs once when the build claims done; the full review panel assembles only inside workkit:review and workkit:ship. Judgment stays here: design calls, contract changes, final verdicts, and anything security-adjacent are yours, not the crew's.]"

jq -n --arg ctx "$ctx" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
exit 0
