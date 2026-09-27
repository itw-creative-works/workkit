#!/bin/bash
# hooks/lib/proof.sh: the proof read, hook_issue_has_proof, and with it the
# shell home of the `Proof:` line pattern. SOURCED by hooks/_lib.sh, never
# executed, and it runs nothing at load: it defines functions and sets nothing.
# It reads hook_jq from the entry.

# hook_issue_has_proof <number> [repo]: does the issue carry a comment line
# starting `Proof:`? 0 proved, 1 unproved, 2 unreadable, which each caller fails
# open on in its own words. gh runs in the current directory. The pattern's
# four homes change together: docs/hooks.md § safety:proof-guard.
hook_issue_has_proof() {
  local number="$1" repo="${2:-}" view proof
  command -v gh >/dev/null 2>&1 || return 2
  command -v jq >/dev/null 2>&1 || return 2
  if [ -n "$repo" ]; then
    view=$(gh issue view "$number" --repo "$repo" --json comments 2>/dev/null) || return 2
  else
    view=$(gh issue view "$number" --json comments 2>/dev/null) || return 2
  fi
  [ -n "$view" ] || return 2
  # Any LINE may open with it, leading whitespace tolerated and nothing else:
  # jq's test is not multiline by default, hence the explicit newline branch.
  proof=$(hook_jq -r '[.comments[]?.body // "" | select(test("(^|\n)[ \t]*Proof:"))] | length' <<<"$view" 2>/dev/null) || return 2
  case "$proof" in
    ''|*[!0-9]*) return 2 ;;
  esac
  [ "$proof" -gt 0 ]
}
