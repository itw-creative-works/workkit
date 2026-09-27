#!/bin/bash
# safety/suite-guard: PreToolUse hook (Bash). Bounces a REPEAT full suite run: the
# root suite on a tree the suite marker already records as proved green. A first
# run, a narrowed run and a mention pass. Fails open, silently.
# Detail: docs/hooks.md § safety:suite-guard.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat) || input=""

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

repo_root=$(cd "$cwd" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || repo_root=""
[ -n "$repo_root" ] || exit 0

[ -n "$(hook_suite_root_run "$cmd" "$repo_root" "$cwd")" ] || exit 0

# Matched, so the expensive half is worth paying for: a heredoc BODY is file
# content and a quoted span is data, and neither is a command.
stripped=$(hook_strip_quotes "$(hook_strip_heredocs "$cmd")")
[ -n "$(hook_suite_root_run "$stripped" "$repo_root" "$cwd")" ] || exit 0

hook_suite_proved "$repo_root" "$(hook_tree_hash "$repo_root")" || exit 0
marker=$(hook_suite_marker_path "$repo_root")

echo "suite-guard: this tree is already proved: the full suite ran green on it and $marker records it. Run the narrowest test that proves the change (node tests/<dir>/<name>.test.js); the commit gate reads the same record and skips its run when the staged tree matches it." >&2
exit 2
