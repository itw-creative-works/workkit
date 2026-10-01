#!/usr/bin/env bash
# workflow/lib/platform.sh: the spellings that differ per platform and the read
# shapes built on them, for the engine and the hooks. Sourced: functions, plus
# the one MSYS export below. The shell twin of tests/lib/platform.js; on macOS
# and Linux every function is the plain POSIX spelling. What each answers:
# workflow/README.md, the lib/platform.sh row.

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

# wk_jq_default <default> <jq args...>: jq's answer, or <default> when it wrote
# nothing. Never `|| printf <default>`: jq writes what it parsed before failing,
# and the default would be stuck on the end. Always exits 0.
wk_jq_default() {
  local default="$1" out
  shift
  out="$(wk_jq "$@" 2>/dev/null || true)"
  [ -n "$out" ] || out="$default"
  printf '%s' "$out"
}

# wk_mv_link: rename onto an address that may be a symlink without following
# it, or the source lands inside the directory it points at. GNU spells it -T
# and BSD -h, so `mv` itself is asked which it is.
wk_mv_link() {
  local flag=-T
  mv --version 2>/dev/null | grep -qi 'GNU coreutils' || flag=-h
  mv -f "$flag" "$1" "$2"
}

# wk_git_path: git's spelling of a path (`C:/Users/x`, never `/c/Users/x`), the
# one a roster key is written and looked up under. Feed it a path git printed:
# `cygpath -m` keeps the letter case it is handed. A failure is passed on, since
# an empty key is worse than none.
wk_git_path() {
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

# wk_npm_script_shell: npm's script-shell value. npm on Windows ends it with a
# CRLF a command substitution keeps half of; npm's own exit status comes back.
wk_npm_script_shell() {
  npm config get script-shell 2>/dev/null | tr -d '\r'
  return "${PIPESTATUS[0]}"
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

# _wk_group_gone <pgid>: wait up to 1.5s for a process group to empty.
_wk_group_gone() {
  local waited=0
  while kill -0 -- "-$1" 2>/dev/null; do
    [ "$waited" -lt 15 ] || return 1
    sleep 0.1
    waited=$(( waited + 1 ))
  done
}

# wk_end_run <pid>: end a detached run, the supervisor and everything under it.
# Windows ends its process tree (taskkill /T; wk_end_pid where there is none).
# Elsewhere the supervisor leads its own process group: INT first, so the body
# logs its own code, then TERM, then KILL, 1.5s apart. Always 0.
wk_end_run() {
  case "${OSTYPE:-}" in
    msys*|cygwin*)
      if command -v taskkill >/dev/null 2>&1; then
        taskkill //T //F //PID "$1" >/dev/null 2>&1 || true
      else
        wk_end_pid "$1" || true
      fi
      return 0
      ;;
  esac
  kill -INT -- "-$1" 2>/dev/null || return 0
  _wk_group_gone "$1" && return 0
  kill -TERM -- "-$1" 2>/dev/null || return 0
  _wk_group_gone "$1" && return 0
  kill -KILL -- "-$1" 2>/dev/null || true
}

# wk_pid_alive <pid>: <pid> is running. A pid Node printed is a Windows pid
# there, which bash's kill cannot see, so Node is asked.
wk_pid_alive() {
  case "${OSTYPE:-}" in
    msys*|cygwin*) node -e 'process.kill(Number(process.argv[1]), 0)' "$1" 2>/dev/null ;;
    *) kill -0 "$1" 2>/dev/null ;;
  esac
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

# wk_marker_path <dir> <anchor>: the marker file ${TMPDIR:-/tmp}/<dir> holds for
# <anchor>, keyed by its wk_sha1. Every marker name is derived here, so a
# writer and its readers never drift apart.
wk_marker_path() {
  local key
  key=$(printf '%s' "$2" | wk_sha1) || return 1
  [ -n "$key" ] || return 1
  printf '%s\n' "${TMPDIR:-/tmp}/$1/$key"
}
