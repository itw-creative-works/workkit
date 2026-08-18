#!/bin/bash
# docs:board-guard — PostToolUse hook (Edit|Write)
# Enforces the document rules of the project-state spec v4 at write time,
# two surfaces:
#   CLAUDE.md — pointer doctrine: exactly a bare '@AGENTS.md' import, no content.
#   AGENTS.md — size budget: ≤250 lines, AND density: no line over 400 BYTES.
#     A markdown paragraph is ONE source line, so the line count alone let the
#     file grow into a book while passing every check (issue #161). Both halves
#     of the budget are judged here; the meat lives in docs/<topic>.md.
#     The unit is bytes and the measure is pinned to it (LC_ALL=C): one-true-awk
#     counts bytes and gawk counts characters under a UTF-8 locale, so an
#     unpinned rule would judge the same file differently on macOS and Linux.
# Violations exit 2 with a precise fix-list so the WRITING agent corrects
# immediately — prevention at write time, not cleanup later.
# Board checks retired with the board itself (spec v4): work-item state lives
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

  # Density: the same budget judged per line, in BYTES (LC_ALL=C). The first few
  # offenders are named so the writing agent can go straight to them. An awk that
  # fails names nothing rather than blocking on an empty read.
  dense=$(LC_ALL=C awk '
    length($0) > 400 {
      n++
      if (n <= 3) printf "%sline %d (%d bytes)", (n > 1 ? ", " : ""), NR, length($0)
    }
    END { if (n > 3) printf ", and %d more", n - 3 }
  ' "$file_path" 2>/dev/null) || dense=""
  [ -z "$dense" ] || add "AGENTS DENSITY: $dense — no line may exceed 400 bytes. A markdown paragraph is one source line, so AGENTS.md passes the 250-line budget while carrying a book. Bulletize those lines, or move the detail to docs/<topic>.md and keep a pointer here."
fi

if [ -n "$violations" ]; then
  {
    echo "board-guard: $base violates the document rules of the project-state spec v4 (spec: $SPEC). Fix these NOW, before any other work:"
    printf '%s' "$violations"
  } >&2
  exit 2
fi

exit 0
