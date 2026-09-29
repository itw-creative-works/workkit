#!/bin/bash
# docs:board-guard: PostToolUse hook (Edit|Write). Holds AGENTS.md to its budget
# (the limits in hooks/_lib.sh), exiting 2 with a fix-list so the writing agent
# corrects at once. Detail: docs/hooks.md § docs:board-guard.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

file_path=$(hook_jq -r '.tool_input.file_path // ""' <<<"$input")
[ -n "$file_path" ] || exit 0

base="$(basename "$file_path")"
[ "$base" = "AGENTS.md" ] || exit 0

[ -f "$file_path" ] || exit 0

# Spec ships in this kit; resolve it relative to this hook.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
SPEC="$SCRIPT_DIR/../../../docs/project-state.md"
if SPEC_DIR="$(cd "$(dirname "$SPEC")" 2>/dev/null && pwd)"; then
  SPEC="$SPEC_DIR/$(basename "$SPEC")"
fi

violations=""
add() {
  violations="${violations}  - $1
"
}

read -r total dense named <<<"$(hook_agents_budget "$file_path")"
[ "$total" -le "$HOOK_AGENTS_MAX_LINES" ] || add "AGENTS BUDGET: $total lines (max $HOOK_AGENTS_MAX_LINES). AGENTS.md is the architectural overview; deep references move to docs/<topic>.md and AGENTS.md keeps a pointer line."
# The first few density offenders are named so the writer goes straight to them.
[ "$dense" -eq 0 ] || add "AGENTS DENSITY: $named. No line may exceed $HOOK_AGENTS_MAX_BYTES bytes. A markdown paragraph is one source line, so AGENTS.md passes the $HOOK_AGENTS_MAX_LINES-line budget while carrying a book. Bulletize those lines, or move the detail to docs/<topic>.md and keep a pointer here."

if [ -n "$violations" ]; then
  {
    echo "board-guard: $base violates the document rules of the project-state spec v4 (spec: $SPEC). Fix these NOW, before any other work:"
    printf '%s' "$violations"
  } >&2
  exit 2
fi

exit 0
