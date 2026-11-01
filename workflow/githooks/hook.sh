#!/usr/bin/env bash
# workflow/githooks/hook.sh: the body every hook in this folder shares. On
# pre-commit and commit-msg, in a Claude session, in a repo that opted in, the
# judge rules on the commit git is making; then, for every hook in every session,
# the hook the repo had before ours runs. Sourced, functions only; KIT_DIR is the hook's.

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

# wk_githook_run <hook> [args]: for pre-commit and commit-msg the judge, run by
# wk_node where wk_session_judges (lib/participation.sh) says it rules, then for
# every hook the chain. A judge that exits non-zero ends the commit with its code.
wk_githook_run() {
  local hook="$1" root node
  shift
  case "$hook" in
    pre-commit|commit-msg) root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="" ;;
    *) root="" ;;
  esac
  if [ -n "$root" ] && wk_session_judges "$root"; then
    if node="$(wk_node)"; then
      "$node" "$KIT_DIR/workflow/githooks/judge.js" "$hook" "$root" "$@" || exit $?
    else
      printf '%s: the workkit judge did not run (no node %s or newer found)\n' "$hook" "$WK_NODE_FLOOR" >&2
    fi
  fi
  wk_githook_chain "$hook" "$@"
}
