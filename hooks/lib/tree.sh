#!/bin/bash
# hooks/lib/tree.sh: the working diff's path list, the one spelling the qa run
# at proof-guard's flip, scripts/red-proof.sh and scripts/review-covers.sh read.
# SOURCED by hooks/_lib.sh, never executed: it defines functions and sets
# nothing.

# hook_working_paths <root>: the root-relative paths the working diff touches,
# NUL-separated: modified, staged and deleted against HEAD (a rename as both its
# halves), then the untracked files. Returns 2 when a read failed, git's words
# dropped so each caller says it in its own.
hook_working_paths() {
  local rc=0
  git -C "$1" diff HEAD --name-only --no-renames -z 2>/dev/null || rc=2
  git -C "$1" ls-files --others --exclude-standard -z 2>/dev/null || rc=2
  return "$rc"
}
