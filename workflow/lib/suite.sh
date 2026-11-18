#!/usr/bin/env bash
# workflow/lib/suite.sh: the shell's names for the proved-tree records: the
# tree ids (lib/tree-hash.js) and the records' writes and reads (lib/records.js),
# each a call into Node; the records' paths, the has-a-test-script read and the
# paths of the root suite's and the narrowed runs' logs and locks, and the sweep of
# the narrowed runs' slots (lib/runs.js). Sourced, functions only, by script-shell.sh,
# workkit.sh and the hooks' _lib.sh; it reads wk_jq, wk_marker_path,
# wk_node and WK_NODE_FLOOR from platform.sh, wk_setting from participation.sh, and
# _wk_runs from detach.sh, which it sources when the caller has not.

# _wk_lib_node <file> [<arg>...]: lib/<file> (tree-hash.js or records.js) run
# under wk_node with the args. With no node at WK_NODE_FLOOR, that file's one
# line on stderr, naming what was not done, and 1.
_wk_lib_node() {
  local node so='no record was read or written'
  if ! node=$(wk_node); then
    [ "$1" != tree-hash.js ] || so='no tree id was taken'
    printf '%s: no node %s or newer found, so %s\n' "${1%.js}" "$WK_NODE_FLOOR" "$so" >&2
    return 1
  fi
  "$node" "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/$1" "${@:2}"
}

# wk_has_test_script <dir>: <dir>/package.json declares scripts.test as a
# non-empty string. Consumer: cmd_test; the module's twin is hasTestScript in
# hooks/mods/suite.js, which workflow/prove.js reads.
wk_has_test_script() {
  [ -f "$1/package.json" ] \
    && wk_jq -e '.scripts.test | type == "string" and length > 0' "$1/package.json" >/dev/null 2>&1
}

# wk_suite_marker_path <repo_root>: the suite record's file for the repo.
wk_suite_marker_path() { wk_marker_path claude-suite-marker "$1"; }

# wk_pkg_marker_path <repo_root>: the package record's file, never the suite's:
# a green whole suite and a green package run answer different questions.
wk_pkg_marker_path() { wk_marker_path claude-package-marker "$1"; }

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
# `.<id>` ends the name in both places.
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

# The root suite's log and lock. The lock is a directory taken by takeRunLock
# (lib/run-lock.js). These and the slot's two below are runPaths' twins (lib/run-paths.js).
wk_suite_log_path() { wk_log_path "$1" suite.log; }
wk_suite_lock_path() { wk_marker_path claude-suite-lock "$1"; }

# wk_test_log_path <repo_root> <pid> and wk_test_lock_path <repo_root> <pid>: a
# narrowed run's slot, named by its wrapper's pid, so several run at once in one
# repo. A slot no call collected is removed by a later run's wk_test_slots_sweep.
wk_test_log_path() { wk_log_path "$1" test.log "$2"; }
wk_test_lock_path() {
  local lock
  lock=$(wk_marker_path claude-test-lock "$1") || return 1
  printf '%s.%s\n' "$lock" "$2"
}

# wk_test_slot_clear <repo_root> <pid>: a narrowed run's log and its lock's
# record removed, once a call has read its end (the lock is dropped already).
wk_test_slot_clear() {
  local log lock
  log=$(wk_test_log_path "$1" "$2") && lock=$(wk_test_lock_path "$1" "$2") || return 1
  rm -f "$log" "$lock.done"
}

# wk_test_slots_sweep <repo_root>: remove the repo's narrowed-run slots (lock
# folder, log, done record) left behind. `runs.js sweep-slots`, under the node
# wk_node picks or else any node, retires each lock whose run was cut off and
# names its slot; the log and record go only once it went.
wk_test_slots_sweep() {
  local base slot
  base=$(wk_test_lock_path "$1" "") || return 1
  # shellcheck source=./detach.sh
  declare -F _wk_runs >/dev/null || . "${BASH_SOURCE[0]%/*}/detach.sh"
  while IFS= read -r slot; do
    wk_test_slot_clear "$1" "$slot"
  done < <(_wk_runs sweep-slots "$base")
}

# wk_tree_hash <repo_root> [<pkg>]: the WORKING tree's id, untracked files in,
# ignored ones and `.workkit/` out; a package's own id leaves out the workspace
# members it cannot see.
wk_tree_hash() { _wk_lib_node tree-hash.js "${1:-}" ${2:+"$2"}; }

# wk_elapsed_ms <start>: the milliseconds since <start>, a `$SECONDS` reading,
# in whole seconds (bash 3.2 has no finer clock), ample for a budget in
# minutes. Consumers: the suite record's two writers, timing their run.
wk_elapsed_ms() { printf '%s\n' "$(( (SECONDS - $1) * 1000 ))"; }

# wk_ci_set: CI holds any value but the empty string. A root script may run only
# part of its suite under CI, so a run with it set writes no record. Consumer:
# script-shell.sh (both records); workflow/prove.js reads CI alike.
wk_ci_set() { [ -n "${CI:-}" ]; }

# wk_suite_marker_write <repo_root> <tree> <ms>: record <tree>, the id hashed
# BEFORE the green run, and `ms=<ms>`, the run's wall time. Consumer:
# script-shell.sh (the working tree a root run started on).
wk_suite_marker_write() { _wk_lib_node records.js suite-write "${1:-}" "${2:-}" "${3:-}"; }

# wk_pkg_marker_write <repo_root> <tree> <pkg>: record `<tree> <pkg>`, <pkg> a
# folder relative to the root (`.` the root), <tree> its id hashed BEFORE its
# green run, every other package's line kept. Consumer: script-shell.sh.
wk_pkg_marker_write() { _wk_lib_node records.js pkg-write "${1:-}" "${2:-}" "${3:-}"; }

# wk_suite_index_tree <repo_root>: the real index's tree less `.workkit/`.
# Consumer: the hold workflow/prove.js asks.
wk_suite_index_tree() { _wk_lib_node tree-hash.js "${1:-}" -i; }

# wk_suite_proved <repo_root> <tree>: the suite record's first line is <tree>.
# Consumer: wk_suite_hold (lib/hold.sh).
wk_suite_proved() { _wk_lib_node records.js suite-proved "${1:-}" "${2:-}"; }

# wk_pkg_proved <repo_root> <tree> <pkg>: a line of the package record is
# `<tree> <pkg>`, <tree> the package's own id.
wk_pkg_proved() { _wk_lib_node records.js pkg-proved "${1:-}" "${2:-}" "${3:-}"; }
