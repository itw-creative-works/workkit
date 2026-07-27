#!/bin/bash
# safety/vendor-guard — PreToolUse hook (Edit|Write)
# Blocks edits to generated/vendor/installed files BEFORE they happen:
#   - vendor/build dir segments: node_modules/, dist/, build/, vendor/, .bundle/
#   - package-manager lockfiles (owned by their tools, never hand-edited)
#   - gitignored files (git check-ignore) — generated/runtime files aren't hand-edited
# Mechanical half of the AGENTS.md "edit the SOURCE, not the output" rule.
# Designed exceptions (owner ruling, 2026-07-22, plan Q1: default-deny + tiny visible allowlist):
#   _attic/ (gitignored holding pen, written on purpose — checked FIRST, since
#   an attic may hold a parked dist/), .env / .env.* (secrets live there BECAUSE
#   they're gitignored), and .workkit/ (session state and the local inbox,
#   gitignored by the workflow spec and written on purpose — 2026-07-24; only
#   .workkit/settings.json is committed, and a tracked file never trips the
#   gitignore check anyway). .workkit/ is checked AFTER the vendor/lockfile
#   block, so a .workkit/ inside node_modules/ or dist/ is still blocked.
# The directory name is spelled out rather than read from a variable: this guard
# sources nothing, so a broken shared file can never keep it from running. Its
# SSOT is WORKKIT_DIR in hooks/_lib.sh — change both together.
# Fail open on missing jq/file_path — a broken guard must never wedge the session.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" || true)
[ -n "$file_path" ] || exit 0

# _attic/ outranks everything: an attic may hold a parked dist/ or vendor/, and
# putting something there is exactly the deliberate act the guard protects.
case "$file_path" in
  */_attic/*|_attic/*) exit 0 ;;
esac

block() {
  echo "vendor-guard: BLOCKED edit to $file_path — $1 Edit the SOURCE, not the output; a bug in a dependency gets fixed upstream, never patched in place." >&2
  exit 2
}

case "$file_path" in
  */node_modules/*|node_modules/*) block "node_modules/ is installed output." ;;
  */dist/*|dist/*|*/build/*|build/*|*/vendor/*|vendor/*|*/.bundle/*|.bundle/*) block "generated/vendored directory." ;;
esac

case "$(basename "$file_path")" in
  package-lock.json|yarn.lock|pnpm-lock.yaml|bun.lock|bun.lockb|Gemfile.lock|Podfile.lock|composer.lock)
    block "lockfiles are owned by their package managers." ;;
  .env|.env.*)
    exit 0 ;;   # secrets live in .env BECAUSE it is gitignored — allowed by design
esac

# .workkit/ is session state, gitignored by the workflow spec and written on
# purpose. It sits AFTER the vendor checks on purpose: a .workkit/ nested in a
# node_modules/ or dist/ tree is still installed output and stays blocked.
case "$file_path" in
  */.workkit/*|.workkit/*) exit 0 ;;
esac

dir="$(dirname "$file_path")"
if git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if git -C "$dir" check-ignore -q -- "$file_path" 2>/dev/null; then
    block "the file is gitignored — generated/runtime files are not hand-edited (designed exceptions: _attic/, .workkit/, .env*)."
  fi
fi

exit 0
