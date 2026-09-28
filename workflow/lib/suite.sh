#!/usr/bin/env bash
# workflow/lib/suite.sh: the proved-tree record: the tree a green root suite
# proved, where it is kept, and the two tree ids it is compared with. Sourced,
# functions only, by script-shell.sh (the writer) and the hooks' _lib.sh (the
# readers); it reads wk_jq, wk_marker_path and wk_git_path from platform.sh.

# wk_has_test_script <dir>: <dir>/package.json declares scripts.test as a
# non-empty string. Consumer: hook_has_test_script.
wk_has_test_script() {
  [ -f "$1/package.json" ] \
    && wk_jq -e '.scripts.test | type == "string" and length > 0' "$1/package.json" >/dev/null 2>&1
}

# wk_suite_marker_path <repo_root>: the record's file for the repo.
wk_suite_marker_path() { wk_marker_path claude-suite-marker "$1"; }

# wk_tree_hash <repo_root> [-u]: the WORKING tree's `git write-tree` id, from
# a throwaway index seeded by a copy of the real one: untracked files count
# (none under -u, the tree `git commit -a` carries), ignored ones never. `cp -p`
# keeps the mtime git's racy check reads, so a same-second edit is not trusted.
wk_tree_hash() {
  local dir index tree="" rc=0 git_dir scope="-A"
  [ "${2:-}" = "-u" ] && scope="-u"
  dir=$(mktemp -d "${TMPDIR:-/tmp}/suite-index.XXXXXX" 2>/dev/null) || return 1
  index="$(wk_git_path "$dir")/index" || { rm -rf "$dir"; return 1; }
  git_dir=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null) || { rm -rf "$dir"; return 1; }
  [ -f "$git_dir/index" ] && cp -p "$git_dir/index" "$index" 2>/dev/null
  if GIT_INDEX_FILE="$index" git -C "$1" add "$scope" >/dev/null 2>&1; then
    tree=$(GIT_INDEX_FILE="$index" git -C "$1" write-tree 2>/dev/null) || rc=1
  else
    rc=1
  fi
  rm -rf "$dir"
  [ "$rc" -eq 0 ] && [ -n "$tree" ] || return 1
  printf '%s\n' "$tree"
}

# wk_suite_marker_write <repo_root> <tree>: record <tree>, the id hashed
# BEFORE the green run, so an edit made while it ran is never counted proved.
# Consumer: script-shell.sh, the record's one writer.
wk_suite_marker_write() {
  local marker
  [ -n "$2" ] || return 1
  marker=$(wk_suite_marker_path "$1") || return 1
  mkdir -p "${marker%/*}"
  printf '%s\n' "$2" > "$marker"
}

# wk_suite_index_tree <repo_root>: the REAL index's `git write-tree` id, the
# tree a plain commit carries. Consumer: safety/commit-gate (check 5).
wk_suite_index_tree() {
  git -C "$1" write-tree 2>/dev/null
}

# wk_suite_proved <repo_root> <tree>: the marker exists and holds <tree>. The
# guard passes the working tree's hash, the gate the real index's id.
# Consumers: safety/suite-guard, safety/commit-gate (check 5).
wk_suite_proved() {
  local marker recorded
  [ -n "$2" ] || return 1
  marker=$(wk_suite_marker_path "$1") || return 1
  [ -f "$marker" ] || return 1
  recorded=$(cat "$marker" 2>/dev/null) || return 1
  [ -n "$recorded" ] && [ "$recorded" = "$2" ]
}
