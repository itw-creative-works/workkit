#!/usr/bin/env bash
# workflow/githooks/hook.sh: the body every hook in this folder shares. On
# pre-commit and commit-msg, in a Claude session, in a repo holding
# .workkit/settings.json, the judge rules on the commit git is making; then, for
# every hook in every session, the hook the repo had before ours runs. Sourced,
# functions only, no file loaded; KIT_DIR is the hook's.

# wk_githooks_kit <root> <folder>: 0 and prints the kit root when <folder>, a
# relative one read against <root> as git reads it, is a kit's hooks folder under
# any spelling (its physical path ends /workflow/githooks and it holds both hooks
# and judge.js); 1 otherwise.
wk_githooks_kit() {
  local real
  [[ -n "$2" ]] || return 1
  real="$(cd "$1" 2>/dev/null && cd -P "$2" 2>/dev/null && pwd -P)" || return 1
  [[ "$real" == */workflow/githooks && -x "$real/pre-commit" && -x "$real/commit-msg" && -f "$real/judge.js" ]] || return 1
  (cd -P "$real/../.." && pwd -P)
}

# wk_githooks_spelled <folder>: 0 when <folder> is spelled as a kit's hooks
# folder, the kit's own path or the engine link's.
wk_githooks_spelled() {
  case "$1" in
    */workflow/githooks|*/workkit/githooks) return 0 ;;
  esac
  return 1
}

# wk_githooks_kitlike <root> <folder>: 0 when <folder> is a kit's (wk_githooks_kit),
# or spelled as one and gone, a plugin update's leftover or a dangling link. An
# existing folder of the repo's own that only ends /workflow/githooks is not.
wk_githooks_kitlike() {
  wk_githooks_kit "$1" "$2" >/dev/null && return 0
  wk_githooks_spelled "$2" || return 1
  ! (cd "$1" 2>/dev/null && [ -e "$2" ])
}

# wk_githook_chain <hook> [args]: exec the repo's own <hook>, in the folder saved
# to workkit.hooksPath unless that is kit-like (wk_githooks_kitlike, so no hook
# chains to itself), else in the git dir's hooks folder; none is 0. Git runs a
# hook from the work tree's root, which a relative path is read against.
wk_githook_chain() {
  local hook="$1" saved common
  shift
  saved="$(git config --local --path workkit.hooksPath 2>/dev/null)" || saved=""
  if [ -n "$saved" ] && ! wk_githooks_kitlike "$PWD" "$saved" && [ -x "$saved/$hook" ]; then
    exec "$saved/$hook" "$@"
  fi
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || exit 0
  if [ -x "$common/hooks/$hook" ]; then
    exec "$common/hooks/$hook" "$@"
  fi
  exit 0
}

# wk_githook_run <hook> [args]: for pre-commit and commit-msg, in a Claude
# session with HOOK_DISABLE not 1, in a repo holding .workkit/settings.json, the
# judge under the first node on PATH, which decides whether the session is
# judged; then for every hook the chain. A non-zero judge ends the commit.
wk_githook_run() {
  local hook="$1" root=""
  shift
  case "$hook" in
    pre-commit|commit-msg)
      if [ "${CLAUDECODE:-}" = 1 ] && [ "${HOOK_DISABLE:-}" != 1 ]; then root="$(git rev-parse --show-toplevel 2>/dev/null)" || root=""; fi
      ;;
  esac
  if [ -n "$root" ] && [ -e "$root/.workkit/settings.json" ]; then
    if ! command -v node >/dev/null 2>&1; then
      printf '%s: the workkit check cannot run: no node on PATH\n' "$hook" >&2
      exit 1
    fi
    node "$KIT_DIR/workflow/githooks/judge.js" "$hook" "$@" || exit $?
  fi
  wk_githook_chain "$hook" "$@"
}
