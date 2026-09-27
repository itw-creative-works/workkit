#!/bin/bash
# safety/suite-guard: PreToolUse hook (Bash)
# The commit gate owns the full suite (docs/project-state.md, "The proof", issue
# #243): it runs the repo's suite itself at every commit carrying code, so a
# suite run by hand before that pays the same minutes twice, and a 0.54.0 ship
# spent 25 of them that way. This guard bounces the hand-run, from every class,
# the manager included: `npm test`, `npm run test`, npm's `t` alias and npm's
# own flags before any of them (`npm --silent test`), and the repo's test script
# run directly (`scripts.test` of the nearest package at or above the session
# directory, up to the git root, that declares one, and the root's own from
# inside a nested package, `node tests/run.js` here).
#
# A NARROWED run passes untouched, since it is what proves a change: the touched
# test files (`node tests/<dir>/<name>.test.js`), `node --test <file>`,
# `npm test -- <scope>`, `npx omega test <scope>`. Each carries a scope, and the
# scope is what this reads. EVERY occurrence in the command is judged, not the
# first: `npm test -- one && npm test` is still a full run.
#
# The gate's own run never arrives here: it runs npm test from inside its own
# hook, never through the Bash tool, which is the only surface a PreToolUse hook
# sees.
#
# The escape is `WORKKIT_SUITE=1` on the command, the deliberate full run, the
# same shape as safety/tree-guard's WORKKIT_ALLOW_DISCARD and read by the same
# helper (hook_has_escape in hooks/lib/commit.sh).
#
# Detection is the command TEXT, in two passes, and no clause walk. The first is
# cheap and RAW: one awk pass, no sourcing and no perl, and nothing else runs
# for a command that cannot be a suite run. Only when that matches does the
# second pass pay for the house text handling (hooks/lib/commit.sh, the same
# preparation the commit hooks and tree-guard do): heredoc bodies are file
# content and quoted spans are data, so a MENTION of the suite bounces nothing
# (`git commit -m "test: cover npm test wiring"`, a `gh issue comment` quoting
# it, a heredoc carrying it). If the stripped text no longer carries a full run,
# the command was talking about one.
#
# Fail open, silently: no jq, a session directory inside no git repository, or
# no package at or above it (the root's included) declaring a test script
# leaves the command alone. The repo is resolved the way safety/commit-gate
# resolves it, from the git root, and the package the way its nested pass does
# (hook_test_package_dir), so the two hooks agree on whose suite this is.

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

# sg_full_run <text>: prints `full` when <text> carries at least one FULL suite
# run. One awk pass, line by line, since a line break is a clause break like any
# other. Each occurrence is judged on what FOLLOWS it up to that clause's end:
# a scope makes the run a narrow one, and narrow runs are the proof of a change.
# For npm the scope reaches the script after `--`, the only form that narrows
# it; the script run directly narrows on any argument at all. A redirect is
# shell syntax, never an argument, so `node tests/run.js 2>&1 | tail` is still
# the whole suite. A scope that continues the matched word (`npm run
# test:unit`, `node tests/run.js.bak`) names another script and is never this
# one, and the script is matched only at a command-word boundary, so a path
# that merely ends in it (`ls node_modules/.bin/jest`) is not a run.
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
