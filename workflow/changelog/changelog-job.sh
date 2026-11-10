#!/usr/bin/env bash
# workflow/changelog/changelog-job.sh: a repo's checks.yml as the heal writes it,
# the kit's caller, and the retired linter copies.
# SOURCED by standards.sh, where it defines functions and sets nothing. RUN directly, the hooks module's entry for safety:commit-gate:
# `bash changelog-job.sh rewrite|copies|names [args]` (the foot of the
# file). One rewrite, so the gate never accepts a change the heal would not make.

# The linter copies an earlier heal vendored, one path per line: the current
# name and the older .js one.
wk_linter_copies() {
  printf '%s\n' .github/changelog-lint.cjs .github/changelog-lint.js
}

# The checks.yml template in the engine folder, the one home of the caller's text.
wk_checks_template() {
  printf '%s/templates/github-workflows/checks.yml\n' "$(cd "${BASH_SOURCE[0]%/*}/.." && pwd -P)"
}

# wk_names_linter_copy [copy]: 0 when stdin names the copy (or any copy)
# outside a comment line, since naming it is running it; 1 when it does not; 2
# when a grep failed. Both greps read all of stdin, so no writer is cut short.
wk_names_linter_copy() {
  local copy args=() status
  if [[ $# -gt 0 ]]; then
    args=(-e "$1")
  else
    while IFS= read -r copy; do args+=(-e "$copy"); done < <(wk_linter_copies)
  fi
  grep -v '^[[:space:]]*#' | grep -F "${args[@]}" >/dev/null
  status=("${PIPESTATUS[@]}")
  if (( status[0] > 1 || status[1] > 1 )); then return 2; fi
  return "${status[1]}"
}

# wk_workflows_run_copy <root> [copy]: 0 when any file under
# <root>/.github/workflows names the copy (or any copy), 1 when none does, 2
# when the folder could not be read; find's stderr is the caller's to keep.
wk_workflows_run_copy() {
  local dir="$1/.github/workflows" text
  [[ -d "$dir" ]] || return 1
  text="$(find "$dir" -type f -exec cat {} +)" || return 2
  wk_names_linter_copy "${@:2}" <<<"$text"
}

# wk_has_core_package [dir]: 0 when <dir>/package.json (the cwd's by default)
# names workkit-core in its devDependencies; check_test_runner asks it too. Only
# jq's status is read, so no carriage return reaches a comparison.
wk_has_core_package() {
  local pkg="${1:-.}/package.json"
  [[ -f "$pkg" ]] && wk_jq -e '(.devDependencies // {}) | type == "object" and has("workkit-core")' "$pkg" >/dev/null 2>&1
}

# wk_default_branch: the cwd repo's default branch, the one read the caller and
# branch protection share: GitHub's answer, else origin/HEAD's. Neither is a
# failure, never a guess.
wk_default_branch() {
  local branch=""
  if command -v gh >/dev/null 2>&1; then
    branch="$(gh api 'repos/{owner}/{repo}' --jq .default_branch 2>/dev/null)" || branch=""
  fi
  if [[ -z "$branch" ]]; then
    branch="$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)" || branch=""
    branch="${branch#origin/}"
  fi
  [[ -n "$branch" ]] || return 1
  printf '%s\n' "$branch"
}

# wk_checks_heal_rewrite <template>: checks.yml as the heal writes it, whatever
# the file held: the template with the repo's default branch (wk_default_branch)
# for its __DEFAULT_BRANCH__ placeholder. 1 an unread template, 2 no branch.
wk_checks_heal_rewrite() {
  local text branch
  text="$(cat "$1")" || return 1
  branch="$(wk_default_branch)" || return 2
  printf '%s\n' "${text//__DEFAULT_BRANCH__/$branch}"
}

# The entry the hooks module runs, each mode the function it names, output and
# status passed through: `rewrite [template]` (wk_checks_heal_rewrite, the template
# wk_checks_template names by default; no branch names the fix on stderr), `copies`,
# and `names <file|-> [copy]`, `-` its stdin. Run as a file only: sourced, it does nothing.
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${#BASH_SOURCE[@]}" -eq 1 ]; then
  set -uo pipefail
  set -f
  # shellcheck source=../lib/platform.sh
  . "$(dirname "${BASH_SOURCE[0]}")/../lib/platform.sh"
  usage() { echo "changelog-job.sh: usage: rewrite [template] | copies | names <file|-> [copy]" >&2; exit 64; }
  case "${1:-}" in
    rewrite)
      rc=0
      wk_checks_heal_rewrite "${2:-$(wk_checks_template)}" || rc=$?
      [ "$rc" -ne 2 ] || echo "changelog-job.sh: no default branch: GitHub did not answer and origin/HEAD is unset; run git remote set-head origin -a" >&2
      exit "$rc" ;;
    copies) wk_linter_copies ;;
    names)
      [ -n "${2:-}" ] || usage
      # A socket stdin (Linux, Git Bash) cannot be reopened by path, so `-` reads fd 0 as it is.
      if [ "$2" = - ]; then wk_names_linter_copy "${@:3}"
      else
        { exec 3< "$2"; } 2>/dev/null || { echo "changelog-job.sh: cannot read $2" >&2; exit 2; }
        wk_names_linter_copy "${@:3}" <&3
      fi ;;
    *) usage ;;
  esac
fi
