#!/bin/bash
# hooks/lib/suite.sh: which command runs the ROOT suite, the guard's judgment.
# The proved-tree record it is checked against is the engine's suite record
# (workflow/lib/suite.sh), never its sibling qa record. Sourced by hooks/_lib.sh; defines functions only.

# _hook_suite_at_root <repo_root> <cwd>: <cwd>'s nearest tested package is the
# root, so `npm test` there is the root's suite. Internal to the helper below.
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
