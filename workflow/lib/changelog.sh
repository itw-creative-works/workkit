#!/usr/bin/env bash
# workflow/lib/changelog.sh: the CHANGELOG format check, its one resolution of
# the linter and its message, for the commit gate (check 3), docs/changelog-guard
# and script-shell.sh (before a root suite). Sourced, functions only; the rules
# themselves are ../changelog/changelog.js.

# wk_is_changelog <path>: <path> names a CHANGELOG.md, at the root or below.
wk_is_changelog() {
  case "$1" in
    CHANGELOG.md|*/CHANGELOG.md) return 0 ;;
  esac
  return 1
}

# wk_changelog_linter: the linter's path, the workflow folder beside this lib
# or WORKFLOW_DIR (the tests' override). Returns 1 when node or the linter is
# missing, which the two hooks read as standing aside.
wk_changelog_linter() {
  local dir="${WORKFLOW_DIR:-}"
  command -v node >/dev/null 2>&1 || return 1
  [ -n "$dir" ] || dir="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd -P)"
  [ -f "$dir/changelog/changelog.js" ] || return 1
  printf '%s\n' "$dir/changelog/changelog.js"
}

# wk_changelog_lint_file <file> [--staged]: lint the entries <file> adds (vs
# HEAD; the index under --staged). The linter's findings go to stderr, and its
# exit code comes back; no linter to run is a loud 1.
wk_changelog_lint_file() {
  local linter
  if ! linter=$(wk_changelog_linter); then
    printf 'changelog: no node or no changelog.js to lint %s with\n' "$1" >&2
    return 1
  fi
  node "$linter" "$1" --added-only ${2:+"$2"} >/dev/null
}

# wk_changelog_lint <root> [--staged] <path>...: wk_changelog_lint_file per
# path under <root>. The first failure prints the message on stderr and
# returns 1; clean paths, or none, return 0.
wk_changelog_lint() {
  local root="$1" path out staged=""
  shift
  if [ "${1:-}" = --staged ]; then
    staged=--staged
    shift
  fi
  for path in "$@"; do
    if ! out=$(wk_changelog_lint_file "$root/$path" "$staged" 2>&1); then
      printf 'the CHANGELOG entry does not match the format (see docs/project-state.md). %s\n' "$out" >&2
      return 1
    fi
  done
  return 0
}
