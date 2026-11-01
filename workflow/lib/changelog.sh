#!/usr/bin/env bash
# workflow/lib/changelog.sh: the CHANGELOG format check script-shell.sh runs
# before a root suite: the linter's resolution and its message. The hooks
# module resolves the linter itself (linterPath in hooks/mods/changelog-guard.js),
# for docs:changelog-guard and commit-gate check 3. Sourced, functions only; the
# rules themselves are ../changelog/lint.js.

# wk_is_changelog <path>: <path> names a CHANGELOG.md, at the root or below.
wk_is_changelog() {
  case "$1" in
    CHANGELOG.md|*/CHANGELOG.md) return 0 ;;
  esac
  return 1
}

# wk_changelog_linter: the linter's path, the workflow folder beside this lib
# or WORKFLOW_DIR (the tests' override). Returns 1, silent, when node or the
# linter is missing: the wrapper stands aside, wk_changelog_lint_file says so.
wk_changelog_linter() {
  local dir="${WORKFLOW_DIR:-}"
  command -v node >/dev/null 2>&1 || return 1
  [ -n "$dir" ] || dir="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd -P)"
  [ -f "$dir/changelog/lint.js" ] || return 1
  printf '%s\n' "$dir/changelog/lint.js"
}

# wk_changelog_lint_file <file> [--staged]: lint the entries <file> adds (vs
# HEAD; the index under --staged). The linter's findings go to stderr, and its
# exit code comes back; no linter to run stands aside, one stderr line and 0.
wk_changelog_lint_file() {
  local linter why="no changelog/lint.js to run"
  if ! linter=$(wk_changelog_linter); then
    command -v node >/dev/null 2>&1 || why="no node on PATH"
    printf 'changelog: the linter did not run on %s (%s), so its entries are not judged\n' "$1" "$why" >&2
    return 0
  fi
  node "$linter" "$1" --added-only ${2:+"$2"} >/dev/null
}

# wk_changelog_lint <root> [--staged] <path>...: wk_changelog_lint_file per
# path under <root>. The first failure prints the message on stderr and
# returns 1; clean paths, or none, return 0, a stand-aside line passed on.
wk_changelog_lint() {
  local root="$1" path out staged=""
  shift
  if [ "${1:-}" = --staged ]; then
    staged=--staged
    shift
  fi
  for path in "$@"; do
    if ! out=$(wk_changelog_lint_file "$root/$path" "$staged" 2>&1); then
      # Changes together with lintText in hooks/mods/commit-gate.js.
      printf 'the CHANGELOG entry does not match the format (see docs/project-state.md). %s\n' "$out" >&2
      return 1
    fi
    [ -z "$out" ] || printf '%s\n' "$out" >&2
  done
  return 0
}
