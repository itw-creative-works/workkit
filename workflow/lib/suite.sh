#!/usr/bin/env bash
# workflow/lib/suite.sh: the proved-tree records: the suite record (the tree a
# green bare root run proved) and the package record (the tree any other green
# test run proved, with each package folder it covered), where each is kept, and
# the two tree ids they are compared with, plus the paths of the detached runs'
# logs and locks. Sourced, functions only, by script-shell.sh (the records'
# writer), ship/ci-watch.sh and the hooks' _lib.sh; it reads wk_jq,
# wk_marker_path and wk_git_path from platform.sh.

# wk_has_test_script <dir>: <dir>/package.json declares scripts.test as a
# non-empty string. Consumers: safety/commit-gate, hook_test_package_dir.
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

# _wk_record_write <path_fn> <repo_root> <tree> [<line>...]: the one fresh write
# both records share, into the file <path_fn> names for the repo, one line each,
# the tree first; an empty tree is refused.
_wk_record_write() {
  local marker
  [ -n "$3" ] || return 1
  marker=$("$1" "$2") || return 1
  mkdir -p "${marker%/*}"
  printf '%s\n' "${@:3}" > "$marker"
}

# _wk_record_holds <path_fn> <repo_root> <tree>: the suite record's read: the
# file <path_fn> names exists and holds <tree>.
_wk_record_holds() {
  local marker recorded
  [ -n "$3" ] || return 1
  marker=$("$1" "$2") || return 1
  [ -f "$marker" ] || return 1
  recorded=$(cat "$marker" 2>/dev/null) || return 1
  [ -n "$recorded" ] && [ "$recorded" = "$3" ]
}

# wk_suite_marker_write <repo_root> <tree>: record <tree>, the id hashed
# BEFORE the green run, so an edit made while it ran is never counted proved.
# Consumers: the record's two writers, script-shell.sh (the working tree a root
# run started on) and prove.sh (the staged tree, proved in a copy).
wk_suite_marker_write() { _wk_record_write wk_suite_marker_path "$1" "$2"; }

# wk_pkg_marker_write <repo_root> <tree> <pkg>: add <pkg>, a package folder
# relative to the root (`.` for the root), under <tree>, hashed BEFORE its green
# run. One file per repo: a different tree starts it over. Consumer:
# script-shell.sh (every green test run but the bare root one).
wk_pkg_marker_write() {
  local marker first=""
  [ -n "$2" ] && [ -n "$3" ] || return 1
  if wk_pkg_proved "$1" "$2" "$3"; then return 0; fi
  marker=$(wk_pkg_marker_path "$1") || return 1
  if [ -f "$marker" ]; then IFS= read -r first < "$marker" || :; fi
  if [ "$first" = "$2" ]; then
    printf '%s\n' "$3" >> "$marker"
  else
    _wk_record_write wk_pkg_marker_path "$1" "$2" "$3"
  fi
}

# wk_suite_index_tree <repo_root>: the REAL index's `git write-tree` id, the
# tree a plain commit carries. Consumer: safety/commit-gate (check 5).
wk_suite_index_tree() {
  git -C "$1" write-tree 2>/dev/null
}

# wk_suite_proved <repo_root> <tree>: the marker exists and holds <tree>. The
# guard passes the working tree's hash, the gate the real index's id.
# Consumers: safety/suite-guard, safety/commit-gate (check 5).
wk_suite_proved() { _wk_record_holds wk_suite_marker_path "$1" "$2"; }

# wk_pkg_proved <repo_root> <tree> <pkg>: the package record's first line is
# <tree>, the working tree's hash, and a later line is <pkg>. Consumer:
# safety/proof-guard (qa-tests.sh).
wk_pkg_proved() {
  local marker line first=1
  [ -n "$2" ] && [ -n "$3" ] || return 1
  marker=$(wk_pkg_marker_path "$1") || return 1
  [ -f "$marker" ] || return 1
  while IFS= read -r line; do
    if [ "$first" -eq 1 ]; then
      [ "$line" = "$2" ] || return 1
      first=0
    elif [ "$line" = "$3" ]; then
      return 0
    fi
  done < "$marker"
  return 1
}
