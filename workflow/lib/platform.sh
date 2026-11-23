#!/usr/bin/env bash
# workflow/lib/platform.sh: the spellings that differ per platform and the read
# shapes built on them, for the engine and the hooks. Sourced: functions, plus the
# one MSYS export, WK_NODE_FLOOR and MARKER_KEEP_DAYS below. The shell twin of
# test/lib/platform.js, with lib/run.js as its Node twin; on macOS and Linux every
# function is the plain POSIX spelling. What each answers: workflow/README.md, the lib/platform.sh row.

# Git Bash makes `ln -s` a copy unless MSYS says otherwise (docs/hooks.md
# § Platforms). Appended once to MSYS's space-separated list, however many
# times this is sourced; the engine and every hook source this file.
case "${OSTYPE:-}" in
  msys*|cygwin*)
    [[ " ${MSYS:-} " == *" winsymlinks:nativestrict "* ]] \
      || export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"
    ;;
esac

# wk_jq: jq on Windows writes CRLF (docs/hooks.md § Platforms). Every jq call
# goes through this, and jq's own exit status comes back, so a predicate still
# answers.
wk_jq() {
  jq "$@" | tr -d '\r'
  return "${PIPESTATUS[0]}"
}

# wk_in_plugin_cache <kit dir>: whether the kit is the workkit plugin's copy in
# Claude's plugin cache: its manifest names workkit and its physical path lies
# under the PHYSICAL <claude home>/plugins/cache/, since ~/.claude may be a
# symlink. WORKFLOW_CLAUDE_HOME is the tests' seam, as everywhere it is read.
wk_in_plugin_cache() {
  local kit home manifest
  kit="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  manifest="$kit/.claude-plugin/plugin.json"
  [[ -f "$manifest" ]] && command -v jq >/dev/null 2>&1 || return 1
  [[ "$(wk_jq -r '.name // empty' "$manifest" 2>/dev/null)" == 'workkit' ]] || return 1
  home="$(cd "${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}" 2>/dev/null && pwd -P)" || return 1
  [[ -n "$home" && "$kit" == "$home/plugins/cache/"* ]]
}

# wk_clone_outranks <kit dir> <linked dir>: a clone outranks the plugin cache,
# so a machine-wide link a cached kit finds naming a workkit clone is current.
# The clone test is wk_is_kit_checkout in lib/slug.sh, sourced beside this.
wk_clone_outranks() {
  wk_in_plugin_cache "$1" && wk_is_kit_checkout "${2:-}"
}

# wk_mv_link: rename onto an address that may be a symlink without following
# it, or the source lands inside the directory it points at. GNU spells it -T
# and BSD -h, so `mv` itself is asked which it is.
wk_mv_link() {
  local flag=-T
  mv --version 2>/dev/null | grep -qi 'GNU coreutils' || flag=-h
  mv -f "$flag" "$1" "$2"
}

# wk_native_path <path>: the native spelling (`D:/a/x`, never `/d/a/x`), git's
# own: `cygpath -m` on Windows, keeping the letter case it is handed, the path
# unchanged elsewhere. Every path a kit shell line prints for a person, hands to
# a native program, or keys the roster by goes through it. A failure is passed
# on: an empty key is worse than none.
wk_native_path() {
  local p="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*) p="$(cygpath -m "$p")" || return 1 ;;
  esac
  printf '%s' "$p"
}

# wk_user_dir: the machine's own workkit folder, ~/.workkit, which WORKFLOW_HOME
# moves. Every engine script, hook and job reads the folder through this one;
# its Node twin is ../user-dir.js, shape for shape.
wk_user_dir() {
  printf '%s\n' "${WORKFLOW_HOME:-${HOME:-}/.workkit}"
}

# wk_script_shell_exe: npm's script shell on Windows, the executable setup
# builds into the machine's own folder. Setup writes it; the commit gate reads it.
wk_script_shell_exe() {
  printf '%s\n' "$(wk_user_dir)/script-shell.exe"
}

# wk_hooks_log: sets WK_HOOKS_LOG, the log the hooks module writes a line to per
# hook fire, in wk_user_dir's folder.
wk_hooks_log() {
  WK_HOOKS_LOG="$(wk_user_dir)/hooks.log"
}

# wk_is_cloud: a claude.ai/code cloud session, which Claude Code marks with
# CLAUDE_CODE_REMOTE=true. Setup's --cloud and doctor read it.
wk_is_cloud() {
  [[ "${CLAUDE_CODE_REMOTE:-}" == 'true' ]]
}

# The oldest node every program wk_node finds runs under, the engines floor of
# both package.json files: the kit's one lowest Node.
WK_NODE_FLOOR=22.22

# _wk_node_fits <node>: whether <node> runs and its --version reaches
# WK_NODE_FLOOR, part by part as numbers, a suffix (`-nightly`, a `\r`) dropped.
_wk_node_fits() {
  local version have want i a b
  version="$("$1" --version 2>/dev/null)" || return 1
  IFS=. read -r -a have <<<"${version#v}"
  IFS=. read -r -a want <<<"$WK_NODE_FLOOR"
  for i in 0 1 2; do
    a="${have[i]:-0}"; a="${a%%[!0-9]*}"; a="${a:-0}"
    b="${want[i]:-0}"
    (( 10#$a > 10#$b )) && return 0
    (( 10#$a < 10#$b )) && return 1
  done
  return 0
}

# _wk_nvm_newest: the node of nvm's highest installed version, nothing when none.
_wk_nvm_newest() {
  local node
  for node in "${HOME:-}"/.nvm/versions/node/v*/bin/node; do
    [ -x "$node" ] || continue
    node="${node%/bin/node}"
    printf '%s %s\n' "${node##*/v}" "$node/bin/node"
  done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 | cut -d' ' -f2-
}

# wk_node: prints the first node that fits, of $WORKKIT_NODE, PATH's node, the
# dotfiles pin ~/.nvm/default-bin/node and nvm's newest install; prints
# nothing and returns 1 when none does.
wk_node() {
  local candidate found
  for candidate in "${WORKKIT_NODE:-}" node "${HOME:-}/.nvm/default-bin/node" newest; do
    [ "$candidate" != newest ] || candidate="$(_wk_nvm_newest)"
    [ -n "$candidate" ] || continue
    found="$(command -v "$candidate" 2>/dev/null)" || continue
    if _wk_node_fits "$found"; then
      printf '%s\n' "$found"
      return 0
    fi
  done
  return 1
}

# run_at_floor <prefix> <code> <file> [args]: a Node file that requires the kit's
# ES modules, run under the first node at the kit's floor (wk_node). Exec'd, so
# the file's output and exit code are the command's; with no such node, one
# `<prefix>:` line and <code>, the code the caller gives any other stop.
run_at_floor() {
  local prefix="$1" code="$2" file="$3" node
  shift 3
  if ! node="$(wk_node)"; then
    printf '%s: no node at or above %s is installed\n' "$prefix" "$WK_NODE_FLOOR" >&2
    exit "$code"
  fi
  exec "$node" "$file" "$@"
}

# wk_npm_script_shell: npm's script-shell value. npm on Windows ends it with a
# CRLF a command substitution keeps half of; npm's own exit status comes back.
wk_npm_script_shell() {
  npm config get script-shell 2>/dev/null | tr -d '\r'
  return "${PIPESTATUS[0]}"
}

# wk_physical_path <path>: <path> with its folder resolved through every link
# and its file name kept as written, so a link to the file itself stays its own
# path. The one compare of npm's script shell, for setup, doctor and the gate.
wk_physical_path() {
  local dir
  dir="$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s' "$dir" "$(basename "$1")"
}

# wk_port_pids: the pids listening on a TCP port, one per line, nothing when it
# is free. netstat matches the `:<port>` suffix on either stack (`:18693` is not
# 8693), each pid once; lsof `-b` skips stat() on every mount, which a stalled
# network share blocks 15s a call. Neither tool: nothing, the port reads free.
wk_port_pids() {
  local port="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*)
      netstat -ano | tr -d '\r' | awk -v suffix=":$port" '
        $1 == "TCP" && $4 == "LISTENING" &&
        index($2, suffix) == length($2) - length(suffix) + 1 &&
        !seen[$5]++ { print $5 }'
      ;;
    *) lsof -bti "tcp:$port" -sTCP:LISTEN 2>/dev/null ;;
  esac
}

# wk_end_pid [-9] <pid>: end a pid `wk_port_pids` answered with, never a shell's
# own child (`$!`), which on Windows is an MSYS id. `env` skips bash's builtin
# for the `kill.exe` that takes a Windows pid, and that path is always forceful:
# Windows has no polite end for a windowless process.
wk_end_pid() {
  local signal=''
  case "$1" in
    -*) signal="$1"; shift ;;
  esac
  case "${OSTYPE:-}" in
    msys*|cygwin*) env kill -f -W "$1" ;;
    *) kill ${signal:+"$signal"} "$1" ;;
  esac
}

# wk_claim_dir <dir>: 0 only for the one caller that creates <dir>/claim
# create-only (noclobber), since a `mkdir` may answer 0 to two racing callers.
# Its Node twin is claimDir in lib/lock.js, which also holds the run lock's form.
wk_claim_dir() {
  mkdir "$1" 2>/dev/null || return 1
  ( set -C; : > "$1/claim" ) 2>/dev/null
}

# wk_take_lock <dir>: a mutex taken by wk_claim_dir of <dir>, its parent made first.
# Returns 0 holding it, 1 after a 5s wait. Callers proceed either way, and only
# a caller that took it drops it (wk_drop_lock), or a third writer races the holder.
# Its Node twin, takeLock in lib/lock.js, excludes it on the same folder.
wk_take_lock() {
  local waited=0
  mkdir -p "$(dirname "$1")" 2>/dev/null || return 1
  while [ "$waited" -lt 50 ]; do
    if wk_claim_dir "$1"; then return 0; fi
    sleep 0.1
    # Never `(( waited++ ))`: its first pass evaluates to 0, a non-zero status
    # that errexit ends the run on under bash 4.1 and later.
    waited=$(( waited + 1 ))
  done
  return 1
}

# The claim goes first, then the folder, never both at once: a taker may claim
# the folder between the two, and the rmdir then fails and leaves it holding.
wk_drop_lock() {
  rm -f "$1/claim" 2>/dev/null || true
  rmdir "$1" 2>/dev/null || true
}

# wk_sha1: the hex sha1 of STDIN, through shasum or sha1sum, so every key is
# made by one rule. No tool is a loud refusal, never an empty key; parameter
# expansion strips the ` -` to spare a fork.
wk_sha1() {
  local out
  if command -v shasum >/dev/null 2>&1; then
    out=$(shasum)
  elif command -v sha1sum >/dev/null 2>&1; then
    out=$(sha1sum)
  else
    printf 'wk_sha1: neither shasum nor sha1sum is on PATH\n' >&2
    return 1
  fi
  printf '%s\n' "${out%% *}"
}

# The days a marker outlives its last write; wk_sweep_markers removes older.
MARKER_KEEP_DAYS=7

# wk_markers_dir: the folder every marker lives under, markers/ in wk_user_dir's
# folder, where no system temp cleaner reaches.
wk_markers_dir() {
  printf '%s\n' "$(wk_user_dir)/markers"
}

# wk_tower_dir: the one git repo in the global layer, the clone of `<login>/workkit`.
wk_tower_dir() {
  printf '%s\n' "$(wk_user_dir)/tower"
}

# wk_keyed_path <folder> <anchor>: the path <folder> holds for <anchor>, keyed
# by its wk_sha1; 1 when no digest comes out.
wk_keyed_path() {
  local key
  key=$(printf '%s' "$2" | wk_sha1) || return 1
  [ -n "$key" ] || return 1
  printf '%s\n' "$1/$key"
}

# wk_marker_path <dir> <anchor>: the marker file <markers dir>/<dir> holds for
# <anchor> (wk_keyed_path). Every marker name is derived here, so a writer and
# its readers never drift apart.
wk_marker_path() {
  wk_keyed_path "$(wk_markers_dir)/$1" "$2"
}

# wk_sweep_markers: remove each regular file one folder under the markers dir
# whose mtime is older than MARKER_KEEP_DAYS. A folder there (a run lock) is
# never entered. Every shell marker writer calls it; it never fails one. Its
# Node twin is sweepMarkers in lib/lock.js, which the record writers run.
wk_sweep_markers() {
  local dir
  dir=$(wk_markers_dir)
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 2 -maxdepth 2 -type f -mmin "+$((MARKER_KEEP_DAYS * 1440))" -exec rm -f {} + 2>/dev/null || true
}
