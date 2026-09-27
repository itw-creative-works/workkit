#!/usr/bin/env bash
# manager:profile: UserPromptSubmit hook. Injects the manager standing
# instruction every turn, since rules stated once get buried. Only a
# manager-capable session hears it: the frontier or workhorse rung, or an
# unknown one (a fresh VS Code first prompt, where the default is frontier);
# a cheaper session and `enabled: false` hear nothing. Always exits 0.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

ladder="${MANAGER_LADDER:-${BASH_SOURCE[0]%/*}/../resources/ladder.json}"
cwd=$(printf '%s' "$input" | hook_jq -r '.cwd // empty' 2>/dev/null || true)
hook_manager_config "$ladder" "$cwd" || exit 0
frontier=$(printf '%s' "$HOOK_MANAGER_CONFIG" | hook_jq_default 'fable' -r '.tiers.frontier // empty')
workhorse=$(printf '%s' "$HOOK_MANAGER_CONFIG" | hook_jq_default 'opus' -r '.tiers.workhorse // empty')

session_id=$(printf '%s' "$input" | hook_jq -r '.session_id // empty' 2>/dev/null || true)
transcript_path=$(printf '%s' "$input" | hook_jq -r '.transcript_path // empty' 2>/dev/null || true)

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
# unknown, treated as frontier-capable above, but the consult line is only
# offered when the tier is POSITIVELY below frontier) gets the consult line.
if [ -n "$tier" ] && [ "$tier" != "$frontier" ]; then
  advisor='Consult the workkit:advisor agent for plans and hard calls: it runs on the frontier model.'
else
  advisor='You are the frontier model. The workkit:advisor agent is redundant; do not spawn it.'
fi

ctx="[You are the MANAGER: judgment and dispatch. Delegate: recon to workkit:scout, implementation to workkit:worker, blind review to workkit:verifier. ${advisor} The resolver hook picks spawn models; never pass a model param. Keep a visible checklist with the todo tool for any multi-step task: current item in progress, updated as steps start and finish, pruned when stale. Announce every crew spawn in chat as you make it (class, model per the ladder, one-line mandate) and report what it returned when it finishes. Handoff: write the brief to a file only when dispatching now (brief me = a chat summary, never a file); it names the framework guide(s) to read first; the agent's reply IS the report. Judgment stays here: design, contracts, verdicts. Owner questions: self-contained, workkit:interview shape. Issue lines: ONE bullet, bold lead = number + link + five words, then two to three sentences for a cold reader (what was wrong, what changed, how to check; docs/project-state.md § Restating an issue).]"

hook_jq -n --arg ctx "$ctx" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
exit 0
