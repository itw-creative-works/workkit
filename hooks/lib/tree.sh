#!/bin/bash
# hooks/lib/tree.sh: the working diff's path list, the one spelling
# hooks/lib/snapshot.sh, workflow/proof/red.sh and workflow/review/covers.sh
# read, and whether a path differs from HEAD in its version alone.
# SOURCED by hooks/_lib.sh, never executed: it defines functions and sets
# nothing.

# hook_working_paths <root>: the root-relative paths the working diff touches,
# NUL-separated: modified, staged and deleted against HEAD (a rename as both its
# halves), then the untracked files. Returns 2 when a read failed, git's words
# dropped so each caller says it in its own. Changes together with touchedOf's
# first two reads in hooks/mods/proof-guard.js.
hook_working_paths() {
  local rc=0
  git -C "$1" diff HEAD --name-only --no-renames -z 2>/dev/null || rc=2
  git -C "$1" ls-files --others --exclude-standard -z 2>/dev/null || rc=2
  return "$rc"
}

# hook_version_only_change <root> <path>: whether <path>, tracked in HEAD,
# differs from HEAD's copy only in its top-level "version", both parsed as JSON
# objects; untracked, missing or unparsable is a no. The JS twin is versionOnly
# in hooks/mods/commit-gate/checks.js, which also lets lockstep pins move.
hook_version_only_change() {
  [ -f "$1/$2" ] || return 1
  git -C "$1" rev-parse -q --verify "HEAD:$2" >/dev/null 2>&1 || return 1
  git -C "$1" show "HEAD:$2" 2>/dev/null \
    | hook_jq -e -s --slurpfile copy "$1/$2" \
      '. as $head | ($head + $copy | length == 2 and all(type == "object"))
        and ($head[0] | del(.version)) == ($copy[0] | del(.version))' >/dev/null 2>&1
}
