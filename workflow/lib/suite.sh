#!/usr/bin/env bash
# workflow/lib/suite.sh: the has-a-test-script read and where a detached run
# logs, for the shell. Sourced, functions only, by workkit.sh and the hooks'
# _lib.sh; it reads wk_jq and wk_marker_path from platform.sh and wk_setting
# from participation.sh, which it sources when the caller has not.

# wk_has_test_script <dir>: <dir>/package.json declares scripts.test as a
# non-empty string. Consumer: cmd_test; the module's twin is hasTestScript in
# hooks/mods/suite.js, which workflow/prove.js reads.
wk_has_test_script() {
  [ -f "$1/package.json" ] \
    && wk_jq -e '.scripts.test | type == "string" and length > 0' "$1/package.json" >/dev/null 2>&1
}

# wk_setting (participation.sh) reads logs.dir; a caller that sourced only
# platform.sh gets it here.
# shellcheck source=./participation.sh
declare -f wk_setting >/dev/null 2>&1 || . "${BASH_SOURCE[0]%/*}/participation.sh"

# wk_log_dir <repo_root>: `logs.dir` (wk_setting) walked to a path from the
# root, empty for the root itself; empty reads as `.workkit`, as with no jq.
# Absolute or leaving the repo: one line naming the key, and 1. The module's
# twin is logDirOf in hooks/mods/commit-gate.js.
wk_log_dir() {
  local value part out='' bad=0 parts=()
  value=$(wk_setting "$1" logs.dir) || return 1
  [ -n "$value" ] || value=.workkit
  case "$value" in
    /*|\\*|[A-Za-z]:*) bad=1 ;;
    *)
      IFS=/ read -r -a parts <<< "${value//\\//}"
      for part in ${parts[@]+"${parts[@]}"}; do
        case "$part" in
          ''|.) ;;
          ..)
            [ -n "$out" ] || { bad=1; break; }
            case "$out" in */*) out=${out%/*} ;; *) out='' ;; esac
            ;;
          *) out=${out:+$out/}$part ;;
        esac
      done
      ;;
  esac
  if [ "$bad" -eq 1 ]; then
    printf 'workkit: logs.dir must be a folder inside the repo, written from its root (got %s)\n' "$value" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

# wk_log_path <repo_root> <name> [<id>]: where a detached run logs. In the log
# folder (wk_log_dir) only when git ignores it there, else a marker file, so a
# log never changes the tree hash. An <id> keeps one of several runs apart:
# `.<id>` ends the name in both places. Its Node twin is runPaths in lib/run-paths.js.
wk_log_path() {
  local marker dir suffix="${3:+.$3}"
  dir=$(wk_log_dir "$1") || return 1
  dir="${dir:+$dir/}"
  if git -C "$1" check-ignore -q "$dir$2$suffix" 2>/dev/null; then
    printf '%s\n' "$1/$dir$2$suffix"
  else
    marker=$(wk_marker_path "claude-$2" "$1") || return 1
    printf '%s\n' "$marker$suffix"
  fi
}
