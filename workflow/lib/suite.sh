#!/usr/bin/env bash
# workflow/lib/suite.sh: the proved-tree records: the suite record (the tree a
# green bare root run proved) and the package record (one line per package any
# other green test run proved, on that package's own tree id), where each is
# kept, and the tree ids they are compared with, plus the paths of the detached
# runs' logs and locks. Sourced, functions only, by script-shell.sh (the records'
# writer), ship/watch.sh, tree-hash.sh, workkit.sh and the hooks' _lib.sh; it reads wk_jq,
# wk_marker_path, wk_sweep_markers, wk_native_path, wk_node, WK_NODE_FLOOR, wk_take_lock
# and wk_drop_lock from platform.sh, and runs workspaces.js beside it.

# wk_has_test_script <dir>: <dir>/package.json declares scripts.test as a
# non-empty string. Consumers: prove.sh, cmd_test, hook_test_package_dir; the module's
# twin is hasTestScript in hooks/mods/suite.js.
wk_has_test_script() {
  [ -f "$1/package.json" ] \
    && wk_jq -e '.scripts.test | type == "string" and length > 0' "$1/package.json" >/dev/null 2>&1
}

# wk_suite_marker_path <repo_root>: the suite record's file for the repo.
wk_suite_marker_path() { wk_marker_path claude-suite-marker "$1"; }

# wk_pkg_marker_path <repo_root>: the package record's file, never the suite's:
# a green whole suite and a green package run answer different questions.
wk_pkg_marker_path() { wk_marker_path claude-package-marker "$1"; }

# wk_log_path <repo_root> <name>: where a detached run logs. Inside .workkit/
# only when git ignores it there, else a marker file, so a log never changes
# the tree hash.
wk_log_path() {
  if git -C "$1" check-ignore -q ".workkit/$2" 2>/dev/null; then
    printf '%s\n' "$1/.workkit/$2"
  else
    wk_marker_path "claude-$2" "$1"
  fi
}

# The root suite's log and lock, and the CI watch's twins. The lock is a
# directory taken by mkdir (lib/detach.sh).
wk_suite_log_path() { wk_log_path "$1" suite.log; }
wk_suite_lock_path() { wk_marker_path claude-suite-lock "$1"; }
wk_ci_log_path() { wk_log_path "$1" ci.log; }
wk_ci_lock_path() { wk_marker_path claude-ci-watch-lock "$1"; }

# wk_index_write_tree <repo_root> <index> [<path>...]: drop `.workkit` and each
# <path> from the scratch <index>, then print its `git write-tree` id. `-f`,
# since a copy of the real index may stage a file that differs from disk too.
wk_index_write_tree() {
  local root="$1" index="$2"
  shift 2
  GIT_INDEX_FILE="$index" git -C "$root" rm -r -q -f --cached --ignore-unmatch -- .workkit "$@" >/dev/null 2>&1 \
    && GIT_INDEX_FILE="$index" git -C "$root" write-tree 2>/dev/null
}

# wk_tree_hash <repo_root> [<pkg>]: the WORKING tree's id, from a throwaway index
# seeded by `cp -p` of `$git_dir/index`, never `$GIT_INDEX_FILE` (the disk is hashed;
# wk_index_copy honours it): untracked files count, ignored ones and `.workkit/`
# never. `-p` keeps the mtime git's racy check reads: a same-second edit is not trusted.
wk_tree_hash() {
  local root="$1" dir index tree="" rc=0 git_dir pkg="${2:-}" excluded="" node member members=()
  dir=$(mktemp -d "${TMPDIR:-/tmp}/suite-index.XXXXXX" 2>/dev/null) || return 1
  index="$(wk_native_path "$dir")/index" || { rm -rf "$dir"; return 1; }
  git_dir=$(git -C "$root" rev-parse --absolute-git-dir 2>/dev/null) || { rm -rf "$dir"; return 1; }
  [ -f "$git_dir/index" ] && cp -p "$git_dir/index" "$index" 2>/dev/null
  # A package's id leaves out the workspace members it cannot see
  # (lib/workspaces.js); with no node it is the whole tree, and says so.
  if [ -n "$pkg" ] && [ "$pkg" != . ]; then
    if node=$(wk_node); then
      excluded=$("$node" "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/workspaces.js" "$root" "$pkg") || rc=1
    else
      printf 'tree-hash: no node %s or newer found; %s keyed to the whole tree\n' "$WK_NODE_FLOOR" "$pkg" >&2
    fi
  fi
  if [ "$rc" -eq 0 ] && GIT_INDEX_FILE="$index" git -C "$root" add -A >/dev/null 2>&1; then
    while IFS= read -r member; do
      [ -n "$member" ] && members+=("$member")
    done <<< "$excluded"
    tree=$(wk_index_write_tree "$root" "$index" ${members[@]+"${members[@]}"}) || rc=1
  else
    rc=1
  fi
  rm -rf "$dir"
  [ "$rc" -eq 0 ] && [ -n "$tree" ] || return 1
  printf '%s\n' "$tree"
}

# _wk_record_write <path_fn> <repo_root> <tree> [<line>...]: the suite record's
# fresh write, into the file <path_fn> names for the repo, one line each, the
# tree first; an empty tree is refused.
_wk_record_write() {
  local marker
  [ -n "$3" ] || return 1
  marker=$("$1" "$2") || return 1
  mkdir -p "${marker%/*}"
  printf '%s\n' "${@:3}" > "$marker"
}

# _wk_record_holds <path_fn> <repo_root> <tree>: the suite record's read: the
# file <path_fn> names exists and its first line is <tree>.
_wk_record_holds() {
  local marker recorded=""
  [ -n "$3" ] || return 1
  marker=$("$1" "$2") || return 1
  [ -f "$marker" ] || return 1
  IFS= read -r recorded < "$marker" || [ -n "$recorded" ] || return 1
  [ -n "$recorded" ] && [ "$recorded" = "$3" ]
}

# wk_elapsed_ms <start>: the milliseconds since <start>, a `$SECONDS` reading,
# in whole seconds (bash 3.2 has no finer clock), ample for a budget in
# minutes. Consumers: the suite record's two writers, timing their run.
wk_elapsed_ms() { printf '%s\n' "$(( (SECONDS - $1) * 1000 ))"; }

# wk_suite_marker_write <repo_root> <tree> <ms>: record <tree>, the id hashed
# BEFORE the green run, so an edit made while it ran is never counted proved,
# and `ms=<ms>`, the run's wall time. Consumers: script-shell.sh (the working
# tree a root run started on) and prove.sh (the staged tree, proved in a copy).
# Like every marker writer, it sweeps first (wk_sweep_markers).
wk_suite_marker_write() {
  wk_sweep_markers
  _wk_record_write wk_suite_marker_path "$1" "$2" "ms=$3"
}

# wk_pkg_marker_write <repo_root> <tree> <pkg>: record `<tree> <pkg>`, <pkg> a
# folder relative to the root (`.` the root), <tree> its id hashed BEFORE its green run.
# Under `<marker>.lock` the other packages' lines, then <pkg>'s, go to a temp file
# moved onto the record, so overlapping runs each keep their line. Consumer: script-shell.sh.
wk_pkg_marker_write() {
  local marker line lines="" locked=0 rc=0
  [ -n "$2" ] && [ -n "$3" ] || return 1
  wk_sweep_markers
  marker=$(wk_pkg_marker_path "$1") || return 1
  mkdir -p "${marker%/*}"
  if wk_take_lock "$marker.lock"; then locked=1; fi
  if [ -f "$marker" ]; then
    while IFS= read -r line; do
      [ "${line#* }" = "$3" ] || lines+="$line"$'\n'
    done < "$marker"
  fi
  lines+="$2 $3"$'\n'
  if ! { printf '%s' "$lines" > "$marker.tmp.$$" && mv -f "$marker.tmp.$$" "$marker"; } 2>/dev/null; then
    rm -f "$marker.tmp.$$"
    rc=1
  fi
  if [ "$locked" -eq 1 ]; then wk_drop_lock "$marker.lock"; fi
  return "$rc"
}

# wk_index_copy <repo_root> <dir>: copy the REAL index, the one a plain commit
# carries (`$GIT_INDEX_FILE` in a commit hook), to <dir>/index and print that
# path, so a write-tree there never writes the real one. No index is no copy.
# Consumers: wk_suite_index_tree, prove.sh (the copy's whole tree).
wk_index_copy() {
  local root="$1" index real
  real="${GIT_INDEX_FILE:-}"
  if [ -z "$real" ]; then
    real="$(git -C "$root" rev-parse --absolute-git-dir 2>/dev/null)/index" || return 1
  elif [ "${real#/}" = "$real" ] && [ "${real#?:}" = "$real" ]; then
    real="$root/$real"
  fi
  index="$(wk_native_path "$2")/index" || return 1
  if [ -f "$real" ] && ! cp -p "$real" "$index" 2>/dev/null; then return 1; fi
  printf '%s\n' "$index"
}

# wk_suite_index_tree <repo_root>: the real index's tree less `.workkit/`, taken
# from its scratch copy (wk_index_copy). Consumers: prove.sh, tree-hash.sh -i
# (the commit gate's treeId).
wk_suite_index_tree() {
  local root="$1" dir index tree="" rc=0
  dir=$(mktemp -d "${TMPDIR:-/tmp}/suite-index.XXXXXX" 2>/dev/null) || return 1
  if index=$(wk_index_copy "$root" "$dir"); then
    tree=$(wk_index_write_tree "$root" "$index") || rc=1
  else
    rc=1
  fi
  rm -rf "$dir"
  [ "$rc" -eq 0 ] && [ -n "$tree" ] || return 1
  printf '%s\n' "$tree"
}

# wk_suite_proved <repo_root> <tree>: the marker exists and its first line is <tree>.
# Consumer: wk_suite_hold (lib/hold.sh). The guards read it through its module
# twin, suiteProved in hooks/mods/suite.js: commit-gate with the real index's
# id, proof-guard with the working tree's hash.
wk_suite_proved() { _wk_record_holds wk_suite_marker_path "$1" "$2"; }

# wk_pkg_proved <repo_root> <tree> <pkg>: a line of the package record is
# `<tree> <pkg>`, <tree> the package's own id. Consumer: safety:proof-guard,
# through its module twin pkgProved in hooks/mods/suite.js.
wk_pkg_proved() {
  local marker line
  [ -n "$2" ] && [ -n "$3" ] || return 1
  marker=$(wk_pkg_marker_path "$1") || return 1
  [ -f "$marker" ] || return 1
  while IFS= read -r line; do
    [ "$line" = "$2 $3" ] && return 0
  done < "$marker"
  return 1
}
