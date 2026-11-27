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

# wk_native_path <path>: the native spelling (`D:/a/x`, never `/d/a/x`), git's
# own, the path unchanged off Windows. On Windows a path already spelled for it
# (a drive letter, `:` and a separator, or two separators) has each `\` made `/`;
# any other goes through `cygpath -m`, keeping the letter case, a failure passed on.
wk_native_path() {
  local p="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*)
      case "$p" in
        [A-Za-z]:[\\/]*|[\\/][\\/]*) p="${p//\\//}" ;;
        *) p="$(cygpath -m "$p")" || return 1 ;;
      esac
      ;;
  esac
  printf '%s' "$p"
}

# wk_user_dir: the machine's own workkit folder, ~/.workkit, which WORKFLOW_HOME
# moves. Every engine script, hook and job reads the folder through this one;
# its Node twin is ../user-dir.js, shape for shape.
wk_user_dir() {
  printf '%s\n' "${WORKFLOW_HOME:-${HOME:-}/.workkit}"
}

# wk_is_cloud: a claude.ai/code cloud session, which Claude Code marks with
# CLAUDE_CODE_REMOTE=true. The gh shim (identity/gh) reads it.
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
