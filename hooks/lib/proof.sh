#!/bin/bash
# hooks/lib/proof.sh: the proof read, hook_issue_has_proof, and with it the
# shell home of the `Proof:` line pattern. SOURCED by hooks/_lib.sh, never
# executed, and it runs nothing at load: it defines functions and sets nothing.
# It reads hook_jq from the entry.

# hook_issue_has_proof <number> [repo]: does the issue carry a comment whose
# line starts `Proof:`? That line is the spec's proof (docs/project-state.md,
# "The proof"), a hard gate since issue #233, and this is the ONE read behind
# both halves of it: safety/proof-guard on the complete flip and the close,
# safety/commit-gate check 6 on the `Fixes #N` trailer.
#   0 = proved, 1 = unproved, 2 = unreadable
# Unreadable is every way the question cannot be ASKED: no gh, no jq, a view
# that exits non-zero, or output that does not parse. It is deliberately its own
# code, because a guard must fail OPEN on it while an unproved issue blocks; the
# sentence that says so belongs to each caller, since only they know what they
# were about to gate.
# The gh call runs in the CURRENT directory, so an issue number with no <repo>
# resolves the way the gated command itself would; a caller judging another
# directory cds first, in a subshell.
# Consumers: safety/proof-guard, safety/commit-gate (check 6). The pattern has
# four homes, which change together: this one, workflow/ship-items.sh (the
# ship's read), and PROOF_LINE in tower/api/server/validate.js and in the dashboard's
# libs/tower/github/writes.js. tests/scripts/ship-items.test.js pins the ship's copy
# to this one, and tests/tower/app/github-writes.test.js the endpoint's.
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
