#!/bin/bash
# safety/suite-guard: PreToolUse hook (Bash). The commit gate owns the full
# suite (docs/project-state.md § The proof), so this bounces the hand-run from
# every class: npm's test spellings and the repo's test script run directly. A
# narrowed run passes, WORKKIT_SUITE=1 is the deliberate escape, and a mention
# bounces nothing. Fails open, silently. Detail: docs/hooks.md § safety:suite-guard.

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

# The repo, and its test script: the nearest package at or above the session
# directory that declares one, else the git root's.
repo_root=$(cd "$cwd" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null) || repo_root=""
[ -n "$repo_root" ] || exit 0

pkg_dir="$repo_root"
cwd_prefix=$(cd "$cwd" 2>/dev/null && git rev-parse --show-prefix 2>/dev/null) || cwd_prefix=""
cwd_prefix="${cwd_prefix%/}"
if [ -n "$cwd_prefix" ]; then
  nested_pkg=$(hook_test_package_dir "$repo_root" "$cwd_prefix")
  if [ -n "$nested_pkg" ]; then pkg_dir="$repo_root/$nested_pkg"; fi
fi

script=$(hook_jq -r '.scripts.test // ""' "$pkg_dir/package.json" 2>/dev/null || true)
[ -n "$script" ] || exit 0
# The root's script is a full run from inside a nested package too (`cd .. &&
# node tests/run.js`), so both are judged when they differ.
scripts="$script"
if [ "$pkg_dir" != "$repo_root" ]; then
  root_script=$(hook_jq -r '.scripts.test // ""' "$repo_root/package.json" 2>/dev/null || true)
  if [ -n "$root_script" ] && [ "$root_script" != "$script" ]; then scripts="$scripts"$'\n'"$root_script"; fi
fi

# npm's own spellings of the whole suite: the `run` form, the bare form, the `t`
# alias, and npm's flags in front of any of them.
sg_npm_re='(^|[^[:alnum:]_./-])npm([[:space:]]+-[^[:space:]]+)*[[:space:]]+(run[[:space:]]+test|test|t)'

# sg_full_run <text>: prints `full` when <text> carries at least one full suite
# run, each judged on what follows it to its clause's end: an npm scope after
# `--`, or any argument to the script run directly, narrows it. A redirect is
# never an argument; a continued word (`test:unit`) or a path suffix is not a run.
sg_full_run() {
  while IFS= read -r needle; do
    [ -n "$needle" ] || continue
    if [ -n "$(sg_full_run_for "$1" "$needle")" ]; then echo full; return 0; fi
  done <<<"$scripts"
}

# sg_full_run_for <text> <script>: the awk pass for one script's spelling.
sg_full_run_for() {
  printf '%s' "$1" | awk -v npmre="$sg_npm_re" -v needle="$2" '
    function verdict(tail, kind,   s) {
      s = tail
      sub(/[[:space:]]*[0-9]*[;|&<>].*$/, "", s)
      if (s != "" && s !~ /^[[:space:]]/) return 0
      if (kind == "npm") return (s ~ /^[[:space:]]*--[[:space:]]+[^[:space:]]/) ? 0 : 1
      return (s ~ /[^[:space:]]/) ? 0 : 1
    }
    {
      rest = $0
      while (match(rest, npmre)) {
        rest = substr(rest, RSTART + RLENGTH)
        if (verdict(rest, "npm")) { print "full"; exit }
      }
      pos = 1
      while ((i = index(substr($0, pos), needle)) > 0) {
        start = pos + i - 1
        pre = (start == 1) ? "" : substr($0, start - 1, 1)
        pos = start + length(needle)
        if (pre != "" && pre !~ /[[:space:];|&(]/) continue
        if (verdict(substr($0, pos), "script")) { print "full"; exit }
      }
    }
  ' 2>/dev/null || true
}

[ -n "$(sg_full_run "$cmd")" ] || exit 0

# Matched, so the expensive half is worth paying for: a heredoc BODY is file
# content and a quoted span is data, and neither is a command.
stripped=$(hook_strip_quotes "$(hook_strip_heredocs "$cmd")")
[ -n "$(sg_full_run "$stripped")" ] || exit 0

# The deliberate full run, read off the stripped text so a mention is not one.
if hook_has_escape "$stripped" WORKKIT_SUITE; then
  exit 0
fi

echo "suite-guard: the commit gate owns the full suite and runs it at the commit. Run the narrowest test that proves the change (the touched suite: node tests/<dir>/<name>.test.js), or prefix WORKKIT_SUITE=1 for a deliberate full run." >&2
exit 2
