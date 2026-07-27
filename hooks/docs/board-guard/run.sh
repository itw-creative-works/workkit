#!/bin/bash
# docs:board-guard — PostToolUse hook (Edit|Write)
# Enforces the document rules of the project-state spec v3 at write time,
# two surfaces:
#   CLAUDE.md — pointer doctrine: exactly a bare '@AGENTS.md' import, no content.
#   AGENTS.md — size budget: ≤250 lines; the meat lives in docs/<topic>.md.
# Violations exit 2 with a precise fix-list so the WRITING agent corrects
# immediately — prevention at write time, not cleanup later.
# Board checks retired with the board itself (spec v3): work-item state lives
# in GitHub Issues, where label legality is the standards script's job.
# Spec checks retired with plans/ — a spec lives in its issue body under a
# '## Spec' heading, so there is no plan file left to validate.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
[ -n "$file_path" ] || exit 0

base="$(basename "$file_path")"
kind=""
case "$base" in
  CLAUDE.md) kind="pointer" ;;
  AGENTS.md) kind="agents" ;;
  *) exit 0 ;;
esac

[ -f "$file_path" ] || exit 0

# Spec ships in this kit; resolve it relative to this hook.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
SPEC="$SCRIPT_DIR/../../../../docs/project-state.md"
if SPEC_DIR="$(cd "$(dirname "$SPEC")" 2>/dev/null && pwd)"; then
  SPEC="$SPEC_DIR/$(basename "$SPEC")"
fi

violations=""
add() {
  violations="${violations}  - $1
"
}

if [ "$kind" = "pointer" ]; then
  # Pointer doctrine: every non-blank line must be the bare import.
  bad_lines=$(grep -nv -e '^[[:space:]]*$' -e '^@AGENTS\.md$' "$file_path" | head -3 || true)
  [ -z "$bad_lines" ] || add "POINTER DOCTRINE: CLAUDE.md is exactly one line — a bare '@AGENTS.md' import. Content belongs in AGENTS.md. Converting a content-bearing CLAUDE.md: 'git mv CLAUDE.md AGENTS.md', commit, THEN add the pointer in a SEPARATE commit (same-commit pointer breaks rename detection). First offending line(s): $(printf '%s' "$bad_lines" | tr '\n' ' ')"
  grep -q '^@AGENTS\.md$' "$file_path" || add "POINTER DOCTRINE: missing the bare '@AGENTS.md' import line."
fi

if [ "$kind" = "agents" ]; then
  total=$(wc -l <"$file_path" | tr -d ' ')
  [ "$total" -le 250 ] || add "AGENTS BUDGET: $total lines (max 250) — AGENTS.md is the architectural overview; deep references move to docs/<topic>.md and AGENTS.md keeps a pointer line."
fi

if [ -n "$violations" ]; then
  {
    echo "board-guard: $base violates the document rules of the project-state spec v3 (spec: $SPEC). Fix these NOW, before any other work:"
    printf '%s' "$violations"
  } >&2
  exit 2
fi

exit 0
