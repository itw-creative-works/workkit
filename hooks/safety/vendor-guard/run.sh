#!/bin/bash
# safety/vendor-guard: PreToolUse hook (Edit|Write)
# Blocks edits to generated/vendor/installed files BEFORE they happen:
#   - vendor dir segments anywhere: node_modules/, vendor/, .bundle/
#   - dist/ and build/ only DIRECTLY under a package root (see check_output_dir)
#   - package-manager lockfiles (owned by their tools, never hand-edited)
#   - gitignored files (git check-ignore): generated/runtime files aren't hand-edited
# Mechanical half of the AGENTS.md "edit the SOURCE, not the output" rule.
# Designed exceptions (default-deny plus a tiny visible allowlist):
#   _attic/ (gitignored holding pen, written on purpose, checked FIRST, since
#   an attic may hold a parked dist/), .env / .env.* (secrets live there BECAUSE
#   they're gitignored), and .workkit/ (agent state and the local capture file,
#   gitignored by the workflow spec and written on purpose, 2026-07-24; only
#   .workkit/settings.json is committed, and a tracked file never trips the
#   gitignore check anyway). .workkit/ is checked AFTER the vendor/lockfile
#   block, so a .workkit/ inside node_modules/ or dist/ is still blocked.
# The directory name is spelled out rather than read from a variable: this guard
# sources no hook helper, so the variable holding it is not defined here. Its
# SSOT is WORKKIT_DIR in hooks/_lib.sh. Change both together.
# Fail open on missing jq/file_path: a broken guard must never wedge the session.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# The two files this hook sources, both from its own physical location: the
# CRLF-safe jq (workflow/platform.sh, `wk_jq`) and the repo-root predicate
# (workflow/participation.sh, `wk_is_repo_root`), each carrying its rule and the
# reason for it. Both define functions and set nothing, so a seam that is THERE
# costs an edit nothing.
#
# UNGUARDED, the way every other source of these two files is: a checkout
# missing one is an incomplete plugin, which the workflow:standards hook already
# names, and a guard here would leave this guard reading an undefined predicate.
# shellcheck source=../../../workflow/platform.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../../../workflow/platform.sh"
# shellcheck source=../../../workflow/participation.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../../../workflow/participation.sh"

file_path=$(wk_jq -r '.tool_input.file_path // ""' <<<"$input" || true)
[ -n "$file_path" ] || exit 0

# _attic/ outranks everything: an attic may hold a parked dist/ or vendor/, and
# putting something there is exactly the deliberate act the guard protects.
case "$file_path" in
  */_attic/*|_attic/*) exit 0 ;;
esac

block() {
  echo "vendor-guard: BLOCKED edit to $file_path: $1 Edit the SOURCE, not the output; a bug in a dependency gets fixed upstream, never patched in place." >&2
  exit 2
}

# A package root is the repo root or any directory holding a package.json; a
# dist/ or build/ sitting DIRECTLY under one is that package's output. Deeper in
# a source tree the name means nothing (…/src/test/suites/build/ is committed
# source, 2026-07-28), so only the anchored case blocks. A path whose parent
# does not exist can't be disproved and stays blocked: default-deny.
is_package_root() {
  local dir="${1:-/}"
  [ -d "$dir" ] || return 0
  [ -f "$dir/package.json" ] && return 0
  wk_is_repo_root "$dir" && return 0
  return 1
}

check_output_dir() {
  local prefix rest seg
  case "$1" in
    /*) prefix=""; rest="${1#/}" ;;
    *)  prefix="."; rest="$1" ;;
  esac
  while [ -n "$rest" ]; do
    seg="${rest%%/*}"
    [ "$seg" = "$rest" ] && break   # last component is the basename, not a directory
    rest="${rest#*/}"
    case "$seg" in
      dist|build) is_package_root "$prefix" && return 0 ;;
    esac
    prefix="$prefix/$seg"
  done
  return 1
}

case "$file_path" in
  */node_modules/*|node_modules/*) block "node_modules/ is installed output." ;;
  */vendor/*|vendor/*|*/.bundle/*|.bundle/*) block "generated/vendored directory." ;;
esac

if check_output_dir "$file_path"; then
  block "a dist/ or build/ directly under a package root is generated output."
fi

case "$(basename "$file_path")" in
  package-lock.json|yarn.lock|pnpm-lock.yaml|bun.lock|bun.lockb|Gemfile.lock|Podfile.lock|composer.lock)
    block "lockfiles are owned by their package managers." ;;
  .env|.env.*)
    exit 0 ;;   # secrets live in .env BECAUSE it is gitignored, allowed by design
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
    block "the file is gitignored: generated/runtime files are not hand-edited (designed exceptions: _attic/, .workkit/, .env*)."
  fi
fi

exit 0
