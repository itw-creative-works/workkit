#!/bin/bash
# safety/suite-guard: PreToolUse hook (Bash). Bounces a full suite run (the
# root `npm test`) on a tree already recorded green, or while an open issue is
# at status:building. A narrowed run and a mention pass. Fails open.
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

# `workkit prove` runs the suite on the staged tree, so its repeat is judged by
# the real index's id; every other root run by the working tree's.
if [ -n "$(hook_suite_prove_run "$stripped")" ]; then
  tree=$(wk_suite_index_tree "$repo_root") || tree=""
else
  tree=$(wk_tree_hash "$repo_root") || tree=""
fi
if wk_suite_proved "$repo_root" "$tree"; then
  marker=$(wk_suite_marker_path "$repo_root")
  echo "suite-guard: this tree is already proved: the full suite ran green on it and $marker records it. Run the narrowest test that proves the change (\`npm test -- <file>\` from the package's folder); the commit gate reads the same record for a commit whose staged tree matches it." >&2
  exit 2
fi

# The full run waits for the batch: any open issue at status:building holds
# it. A repo with no origin is outside the pipeline, and a gh that cannot
# answer passes.
hook_originless_cwd "$cwd" && exit 0
building=$(cd "$repo_root" && hook_issues_building) || exit 0
[ -n "$building" ] || exit 0
named=$(printf '%s\n' "$building" | awk -F'\t' 'NF { printf "%s#%s (%s)", (n++ ? ", " : ""), $1, $2 }')

echo "suite-guard: the full suite runs once, at the commit, after every item in the tree is parked and passed; still building: $named. That work has to finish first: its tests green and its Proof: comment posted, then its own park moves it to status:qa. Never relabel an item to get past this guard. Run the narrowest test that proves the change (\`npm test -- <file>\` from the package's folder)." >&2
exit 2
