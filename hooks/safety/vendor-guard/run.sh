#!/bin/bash
# safety/vendor-guard: PreToolUse hook (Edit|Write), the mechanical half of
# "edit the SOURCE, not the output": blocks vendor segments (node_modules/,
# vendor/, .bundle/), a dist/ or build/ directly under a package root,
# lockfiles, and gitignored files. The allowlist: _attic/ (checked first),
# .env and .env.*, and .workkit/ (checked after the vendor block). It sources
# no hook helper, so `.workkit` is spelled out; WORKKIT_DIR in hooks/_lib.sh is
# its SSOT. Fails open on missing jq or file_path.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# The two engine seams, from this file's physical location: wk_jq and
# wk_is_repo_root. Both define functions and set nothing. Unguarded: a missing
# one is an incomplete plugin, which workflow:standards already names.
# shellcheck source=../../../workflow/lib/platform.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../../../workflow/lib/platform.sh"
# shellcheck source=../../../workflow/lib/participation.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../../../workflow/lib/participation.sh"

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

# A dist/ or build/ directly under a package root (the repo root or a folder
# holding a package.json) is output; deeper in a source tree it is source. A
# path whose parent does not exist cannot be disproved and stays blocked.
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
