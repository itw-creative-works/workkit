#!/bin/bash
# docs:changelog-guard: PostToolUse hook (Edit|Write). Holds each CHANGELOG
# entry this write adds to its format (one short paragraph opening with its
# issue link); the rules live in workflow/changelog/changelog.js, run through
# workflow/lib/changelog.sh, shared with safety/commit-gate, which lints the
# staged diff and is the authority for hand edits.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

file_path=$(hook_jq -r '.tool_input.file_path // ""' <<<"$input")
[ -n "$file_path" ] || exit 0
wk_is_changelog "$file_path" || exit 0
[ -f "$file_path" ] || exit 0

wk_changelog_linter >/dev/null || exit 0

if ! out=$(wk_changelog_lint_file "$file_path" 2>&1); then
  {
    echo "changelog-guard: fix the entry before any other work."
    printf '%s\n' "$out"
  } >&2
  exit 2
fi

exit 0
