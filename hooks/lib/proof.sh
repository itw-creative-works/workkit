#!/bin/bash
# hooks/lib/proof.sh: the issue reads (hook_issue_view, hook_issues_building),
# the view's two answers (the proof and the stage), and the shell home of the
# `Proof:` line pattern.
# SOURCED by hooks/_lib.sh, never executed: it defines functions and sets
# nothing. It reads hook_jq from the entry.

# hook_issue_view <number> <fields> [repo]: gh's `--json <fields>` view of the
# issue, run in the current directory; 2 when gh cannot answer.
hook_issue_view() {
  local number="$1" fields="$2" repo="${3:-}" view
  command -v gh >/dev/null 2>&1 || return 2
  command -v jq >/dev/null 2>&1 || return 2
  if [ -n "$repo" ]; then
    view=$(gh issue view "$number" --repo "$repo" --json "$fields" 2>/dev/null) || return 2
  else
    view=$(gh issue view "$number" --json "$fields" 2>/dev/null) || return 2
  fi
  [ -n "$view" ] || return 2
  printf '%s\n' "$view"
}

# hook_issues_building [repo]: the open issues at status:building, run in the
# current directory: one line each, the number, a tab and the matching label;
# 2 when gh cannot answer. Never agent:working: an agent:ok item keeps that
# claim through the park, so it would hold the ship's own run.
hook_issues_building() {
  local repo="${1:-}" list
  command -v gh >/dev/null 2>&1 || return 2
  command -v jq >/dev/null 2>&1 || return 2
  if [ -n "$repo" ]; then
    list=$(gh issue list --repo "$repo" --state open --label status:building --limit 1000 --json number,labels 2>/dev/null) || return 2
  else
    list=$(gh issue list --state open --label status:building --limit 1000 --json number,labels 2>/dev/null) || return 2
  fi
  [ -n "$list" ] || return 2
  hook_jq -r '.[] | [.number, ([.labels[]?.name // "" | select(. == "status:building")] | join(","))]
    | select(.[1] != "") | "\(.[0])\t\(.[1])"' <<<"$list" 2>/dev/null || return 2
}

# hook_view_has_proof: does the view on stdin carry a comment line starting
# `Proof:`? 0 proved, 1 unproved, 2 unreadable. The pattern's four homes
# change together: docs/hooks.md § safety:proof-guard.
hook_view_has_proof() {
  local proof
  # Any LINE may open with it, leading whitespace tolerated and nothing else:
  # jq's test is not multiline by default, hence the explicit newline branch.
  proof=$(hook_jq -r '[.comments[]?.body // "" | select(test("(^|\n)[ \t]*Proof:"))] | length' 2>/dev/null) || return 2
  case "$proof" in
    ''|*[!0-9]*) return 2 ;;
  esac
  [ "$proof" -gt 0 ]
}

# hook_view_stage: the stage of the view on stdin (read with `url` and `state`):
# `pull` for a pull request, which gh answers by number too but is no work item;
# `closed` for anything not OPEN (a merged PR included); else its status: label,
# else `none`. Nothing printed and 2 when it cannot be read.
hook_view_stage() {
  local stage
  stage=$(hook_jq -r 'if (.url // "" | test("/pull/[0-9]+$")) then "pull"
    elif .state != "OPEN" then "closed"
    else ([.labels[]?.name // "" | select(startswith("status:"))] | first // "none") end' 2>/dev/null) || return 2
  [ -n "$stage" ] || return 2
  printf '%s\n' "$stage"
}

# hook_issue_has_proof <number> [repo]: the proof read on its own, for a caller
# that needs no stage: 0 proved, 1 unproved, 2 unreadable, which each caller
# fails open on in its own words.
hook_issue_has_proof() {
  local view
  view=$(hook_issue_view "$1" comments "${2:-}") || return 2
  hook_view_has_proof <<<"$view"
}
