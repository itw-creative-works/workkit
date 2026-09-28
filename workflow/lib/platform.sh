#!/usr/bin/env bash
# workflow/lib/platform.sh: the spellings that differ per platform and the read
# shapes built on them, for the engine and the hooks. Sourced, functions only.
# The shell twin of tests/lib/platform.js; every function is the identity on
# macOS and Linux. What each answers: workflow/README.md, the lib/platform.sh row.

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
