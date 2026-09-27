#!/bin/bash
# docs:changelog-guard: PostToolUse hook (Edit|Write). Holds each CHANGELOG
# entry this write adds to its format (one short paragraph opening with its
# issue link); the rules live in workflow/changelog/changelog.js, shared with
# safety/commit-gate, which runs the same linter on the staged diff and is the
# authority for hand edits.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

file_path=$(hook_jq -r '.tool_input.file_path // ""' <<<"$input")
[ -n "$file_path" ] || exit 0
[ "$(basename "$file_path")" = "CHANGELOG.md" ] || exit 0
[ -f "$file_path" ] || exit 0

linter="$(hook_changelog_linter)" || exit 0

if ! out=$(node "$linter" "$file_path" --added-only 2>&1); then
  {
    echo "changelog-guard: fix the entry before any other work."
    printf '%s\n' "$out"
  } >&2
  exit 2
fi

exit 0
