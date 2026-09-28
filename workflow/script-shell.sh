#!/usr/bin/env bash
# workflow/script-shell.sh: npm's script shell, once `npm config set
# script-shell` names it. The proved-tree record (lib/suite.sh) is the
# engine-agnostic contract and this file is npm's adapter: the root package's
# `test` event records the tree it proved green; every other script is plain sh.

# One function: bash reads a script as it runs, but parses a function whole.
main() {
  [ "${npm_lifecycle_event:-}" = test ] || exec sh "$@"
  # npm appends a narrowed run's arguments (`npm test -- <file>`) to the script
  # text, so only the bare script is the whole suite.
  [ "${2:-}" = "${npm_lifecycle_script:-}" ] || exec sh "$@"

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  # shellcheck source=./lib/platform.sh
  . "$SCRIPT_DIR/lib/platform.sh"
  # shellcheck source=./lib/suite.sh
  . "$SCRIPT_DIR/lib/suite.sh"

  # The package npm is running must be the git root's own: a nested package's or
  # a workspace member's `test` is that package's suite, never the root's. npm may
  # hand a native Windows path, so either separator ends the folder.
  root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || exec sh "$@"
  [ -n "${npm_package_json:-}" ] || exec sh "$@"
  pkg_dir=$(cd "${npm_package_json%[/\\]*}" 2>/dev/null && pwd -P) || exec sh "$@"
  [ "$pkg_dir" = "$(cd "$root" && pwd -P)" ] || exec sh "$@"

  # Hashed before and after: an edit made while the suite runs is never proved.
  before=$(wk_tree_hash "$root") || before=""
  rc=0
  sh "$@" || rc=$?
  [ "$rc" -eq 0 ] || exit "$rc"
  after=$(wk_tree_hash "$root") || after=""
  if [ "$before" != "$after" ]; then
    printf 'script-shell: the suite passed, but the tree changed during the run, so no record was written; run npm test again\n' >&2
    exit 0
  fi
  if ! wk_suite_marker_write "$root" "$before"; then
    printf 'script-shell: the suite passed, but the record of %s could not be written\n' "$root" >&2
    exit 1
  fi
  exit 0
}

main "$@"
