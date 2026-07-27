#!/bin/bash
# docs:changelog-guard — PostToolUse hook (Edit|Write)
# Holds a CHANGELOG entry to its format the moment it is written: one short
# paragraph that starts with its issue link, with the depth left in the commit
# message. The rules themselves live in workflow/changelog.js (one home, shared
# with the safety/commit-gate hook).
#
# Only entries this change ADDS are judged, so a repo carrying a legacy
# CHANGELOG is never bounced for its history — the format arrives going forward.
#
# This hook sees only writes made through the tools. The commit gate runs the
# same linter on the staged diff and is the authority; a hand edit in an editor
# reaches git through a commit either way.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
[ -n "$file_path" ] || exit 0
[ "$(basename "$file_path")" = "CHANGELOG.md" ] || exit 0
[ -f "$file_path" ] || exit 0

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"
linter="$(hook_changelog_linter)" || exit 0

if ! out=$(node "$linter" "$file_path" --added-only 2>&1); then
  {
    echo "changelog-guard: fix the entry before any other work."
    printf '%s\n' "$out"
  } >&2
  exit 2
fi

exit 0
