#!/bin/bash
# safety/suite-marker: PostToolUse hook (Bash). A full root suite run that ended
# green records the working tree it proved, which safety/suite-guard and the
# commit gate read. Writes nothing otherwise; fails open, silently.
# Detail: docs/hooks.md § safety:suite-marker.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat) || input=""

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cmd" ] || exit 0

# The event is the success signal: PostToolUse fires only after exit 0. A
# background launch succeeds before its tests run, and an interrupted run never
# finished, so `run_in_background`, a `backgroundTaskId` and `interrupted` write nothing.
unfinished=$(hook_jq -r '(.tool_input.run_in_background == true)
  or ((.tool_response | objects | .backgroundTaskId) != null)
  or ((.tool_response | objects | .interrupted) == true)' <<<"$input" 2>/dev/null || true)
[ "$unfinished" = "false" ] || exit 0

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || cwd="$PWD"

repo_root=$(cd "$cwd" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || repo_root=""
[ -n "$repo_root" ] || exit 0

[ -n "$(hook_suite_exact_run "$cmd" "$repo_root" "$cwd")" ] || exit 0

hook_suite_marker_write "$repo_root" 2>/dev/null || true
exit 0
