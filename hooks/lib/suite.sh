#!/bin/bash
# hooks/lib/suite.sh: the full-suite record: which command runs the ROOT suite,
# the working tree's hash, and the marker that holds the tree a green run proved.
# Sourced by hooks/_lib.sh; defines functions and sets nothing.

# _hook_suite_at_root <repo_root> <cwd>: <cwd>'s nearest tested package is the
# root, so `npm test` there is the root's suite. Internal to the two helpers below.
_hook_suite_at_root() {
  local cwd_prefix
  cwd_prefix=$(cd "$2" 2>/dev/null && git rev-parse --show-prefix 2>/dev/null) || cwd_prefix=""
  [ -z "$(hook_test_package_dir "$1" "${cwd_prefix%/}")" ]
}

# hook_suite_root_run <cmd> <repo_root> <cwd>: prints `full` when <cmd> runs the
# root's scripts.test directly, or npm's spellings of it from a directory whose
# nearest tested package is the root. Every occurrence is judged; a redirect is
# never an argument. Consumer: safety/suite-guard.
hook_suite_root_run() {
  local script use_npm=0 npm_re
  script=$(hook_test_script_text "$2")
  [ -n "$script" ] || return 0
  # From inside a nested tested package, `npm test` is that package's suite.
  _hook_suite_at_root "$2" "$3" && use_npm=1
  # npm's own spellings of the whole suite: the `run` form, the bare form, the
  # `t` alias, and npm's flags in front of any of them.
  npm_re='(^|[^[:alnum:]_./-])npm([[:space:]]+-[^[:space:]]+)*[[:space:]]+(run[[:space:]]+test|test|t)'
  printf '%s' "$1" | awk -v usenpm="$use_npm" -v npmre="$npm_re" -v needle="$script" '
    function verdict(tail, kind,   s) {
      s = tail
      sub(/[[:space:]]*[0-9]*[;|&<>].*$/, "", s)
      if (s != "" && s !~ /^[[:space:]]/) return 0
      if (kind == "npm") return (s ~ /^[[:space:]]*--[[:space:]]+[^[:space:]]/) ? 0 : 1
      return (s ~ /[^[:space:]]/) ? 0 : 1
    }
    {
      rest = $0
      while (usenpm == 1 && match(rest, npmre)) {
        rest = substr(rest, RSTART + RLENGTH)
        if (verdict(rest, "npm")) { print "full"; exit }
      }
      pos = 1
      while ((i = index(substr($0, pos), needle)) > 0) {
        start = pos + i - 1
        pre = (start == 1) ? "" : substr($0, start - 1, 1)
        pos = start + length(needle)
        if (pre != "" && pre !~ /[[:space:];|&(]/) continue
        if (verdict(substr($0, pos), "script")) { print "full"; exit }
      }
    }
  ' 2>/dev/null || true
}

# hook_suite_exact_run <cmd> <repo_root> <cwd>: prints `full` only when the whole
# trimmed <cmd> is `npm test`, `npm run test`, `npm t` or the root's scripts.test
# text, from a directory whose nearest tested package is the root: nothing else
# on the line, so its exit status is the suite's. Consumer: safety/suite-marker.
hook_suite_exact_run() {
  local script cmd="$1"
  script=$(hook_test_script_text "$2")
  [ -n "$script" ] || return 0
  _hook_suite_at_root "$2" "$3" || return 0
  cmd="${cmd#"${cmd%%[![:space:]]*}"}"
  cmd="${cmd%"${cmd##*[![:space:]]}"}"
  case "$cmd" in
    'npm test'|'npm run test'|'npm t'|"$script") printf 'full\n' ;;
  esac
}

# hook_tree_hash <repo_root>: the WORKING tree's `git write-tree` id, from a
# throwaway index seeded by a copy of the real one: untracked files count,
# ignored ones never, only changed files are re-hashed. `cp -p` keeps the mtime
# git's racy check reads, so a same-second edit is not trusted.
hook_tree_hash() {
  local dir index tree="" rc=0 git_dir
  dir=$(mktemp -d "${TMPDIR:-/tmp}/suite-index.XXXXXX" 2>/dev/null) || return 1
  index="$(wk_git_path "$dir")/index" || { rm -rf "$dir"; return 1; }
  git_dir=$(git -C "$1" rev-parse --absolute-git-dir 2>/dev/null) || { rm -rf "$dir"; return 1; }
  [ -f "$git_dir/index" ] && cp -p "$git_dir/index" "$index" 2>/dev/null
  if GIT_INDEX_FILE="$index" git -C "$1" add -A >/dev/null 2>&1; then
    tree=$(GIT_INDEX_FILE="$index" git -C "$1" write-tree 2>/dev/null) || rc=1
  else
    rc=1
  fi
  rm -rf "$dir"
  [ "$rc" -eq 0 ] && [ -n "$tree" ] || return 1
  printf '%s\n' "$tree"
}

# hook_suite_marker_write <repo_root>: record the tree a green root run proved.
# Consumers: safety/suite-marker, safety/commit-gate (check 5).
hook_suite_marker_write() {
  local marker tree
  marker=$(hook_suite_marker_path "$1") || return 1
  tree=$(hook_tree_hash "$1") || return 1
  mkdir -p "${marker%/*}"
  printf '%s\n' "$tree" > "$marker"
}

# hook_suite_index_tree <repo_root>: the REAL index's `git write-tree` id, the
# tree a plain commit carries. Consumer: safety/commit-gate (check 5).
hook_suite_index_tree() {
  git -C "$1" write-tree 2>/dev/null
}

# hook_suite_proved <repo_root> <tree>: the marker exists and holds <tree>. The
# guard passes the working tree's hash, the gate the real index's id.
# Consumers: safety/suite-guard, safety/commit-gate (check 5).
hook_suite_proved() {
  local marker recorded
  [ -n "$2" ] || return 1
  marker=$(hook_suite_marker_path "$1") || return 1
  [ -f "$marker" ] || return 1
  recorded=$(cat "$marker" 2>/dev/null) || return 1
  [ -n "$recorded" ] && [ "$recorded" = "$2" ]
}
