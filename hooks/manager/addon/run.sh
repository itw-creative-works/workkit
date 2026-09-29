#!/usr/bin/env bash
# manager:addon: SubagentStart hook. Stacks a personal add-on onto a workkit
# agent: a spawn of workkit:<name> gets the text of the workkit home's
# agents/<name>.md as added context. No file, or a blank one, adds nothing; a
# file that exists but cannot be read fails loudly. Detail: docs/hooks.md.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

agent_type=$(printf '%s' "$input" | hook_jq -r '.agent_type // empty' 2>/dev/null || true)
case "$agent_type" in workkit:?*) ;; *) exit 0 ;; esac

# The workkit GLOBAL layer, by the engine's own variable (workflow/lib.sh).
file="${WORKFLOW_HOME:-$HOME/$WORKKIT_DIR}/agents/${agent_type#workkit:}.md"
[ -e "$file" ] || exit 0

if ! text=$(cat -- "$file" 2>/dev/null); then
  printf 'manager:addon: %s exists but cannot be read; fix its permissions or remove it\n' "$file" >&2
  exit 1
fi
[ -n "${text//[[:space:]]/}" ] || exit 0

hook_jq -n --arg ctx "Personal add-on for $agent_type (from $file):
$text" '{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": $ctx
  }
}'
exit 0
