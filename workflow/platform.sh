#!/usr/bin/env bash
# workflow/platform.sh: the spellings that differ per platform, and the read
# shapes built on them, for the engine and for the hooks beside it. SOURCED,
# never executed, and it runs nothing at load: it defines functions and sets
# nothing.
#
# The shell twin of tests/lib/platform.js, name for name: one home for what
# macOS, Windows (Git Bash) and Linux disagree about, so no script that needs
# an answer carries a branch of its own. Every function here is the identity on
# macOS and Linux, so their behavior is unchanged by construction.
#
# A shape built on one of those spellings lives here beside it rather than in a
# library above (`wk_jq_default` on `wk_jq`), so one jq read has one home for
# both of its questions: which jq answers it, and what its default means.

# wk_jq: the one jq the engine and the hooks call, on every platform.
#
# jq on Windows is a native program whose stdout is in TEXT MODE, so it writes
# CRLF. A single-value `v=$(jq ...)` comes back clean, since the substitution
# drops the trailing `\r\n`; a multi-line substitution keeps a `\r` on every
# line but the last, a piped read keeps it always, and the last field of a
# tab-separated line keeps it too. A value read that way compares equal to
# nothing, and is written on to `gh` (and to GitHub) exactly as it was read.
#
# Every jq call goes through this, uniformly, rather than a judgment per call
# about which reads are single-line: there is nothing to strip where there was
# no `\r`, and jq's OWN exit status is what comes back, so a predicate
# (`jq -e`, `jq empty`) answers exactly what the bare call answered.
wk_jq() {
  jq "$@" | tr -d '\r'
  return "${PIPESTATUS[0]}"
}

# wk_jq_default <default> <jq args...>: jq's answer, or <default> when jq
# answered nothing at all. Beside wk_jq because it is the one shape every read
# that carries a default is written in, engine and hooks alike.
#
# jq writes the output of every value it PARSED before it fails on a later one,
# so `$(wk_jq ... || printf '<default>')` hands back that partial answer with
# the default stuck on the end of it: one string that is neither answer. The
# status is dropped here and the default taken only when nothing was written,
# which is the one state a default is for.
#
# The default comes FIRST so the jq arguments keep their own order and
# spelling. jq's diagnostics are dropped and the status is always 0: a read
# carrying a default has already decided that a failure is an expected
# condition, not a fault to report.
wk_jq_default() {
  local default="$1" out
  shift
  out="$(wk_jq "$@" 2>/dev/null || true)"
  [ -n "$out" ] || out="$default"
  printf '%s' "$out"
}

# wk_mv_link: rename a path ONTO an address that may already be a symlink,
# without following it. This is the one way to replace an address in a single
# step, and the two `mv` implementations spell the flag for it differently: GNU
# (Linux, and the coreutils inside Git Bash) says -T, BSD (macOS) says -h, and
# each one refuses the other's letter. Which one is here is asked of `mv`
# itself rather than of the platform, so a machine carrying the other one still
# gets the right call.
#
# Without the flag, `mv` stats the destination, follows the symlink to the
# directory behind it, and moves the source INSIDE that directory. The engine's
# address points at the engine folder, so the replacement would land in the
# tracked checkout instead of on the address.
wk_mv_link() {
  local flag=-T
  mv --version 2>/dev/null | grep -qi 'GNU coreutils' || flag=-h
  mv -f "$flag" "$1" "$2"
}

# wk_git_path: git's spelling of a path, the one a roster key is written and
# looked up under. Feed it a path git printed: `cygpath -m` keeps the letter
# case it is handed while git canonicalizes it, so any other input can still
# spell one directory two ways.
#
# Windows gives one directory two names. Git for Windows prints the MIXED form
# (`C:/Users/x`) and the Git Bash around it says `/c/Users/x`, so a roster that
# takes whichever spelling reached it holds one repo under two keys: the tower
# lists it twice, a decline recorded under one never answers a lookup under the
# other, and the prune finds both directories and keeps both. Git's is THE
# spelling, because git and the tower's Node reader already agree on it.
#
# `cygpath -m` is that form, and it ships with the MSYS runtime that IS the
# shell running this, so the branch cannot be taken on a machine without it. A
# failure is passed on rather than swallowed: an empty key is worse than none.
# macOS and Linux spell a path one way, so there the answer is the path.
wk_git_path() {
  local p="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*) p="$(cygpath -m "$p")" || return 1 ;;
  esac
  printf '%s' "$p"
}

# wk_port_pids: the pids listening on a TCP port, one per line, so a script that
# has to take a port back never carries the lookup itself.
#
# `lsof` answers it on macOS and Linux, and Git Bash ships none, so Windows is
# asked with `netstat -ano`, which every Windows carries and which prints the
# OWNING pid of each connection. PowerShell's `Get-NetTCPConnection` answers the
# same question, through a startup that costs more than the whole takeover it
# would serve.
#
# netstat prints `TCP <local> <remote> LISTENING <pid>`, and the local address
# ENDS in `:<port>` whichever stack it holds (`0.0.0.0:8693`, `[::]:8693`,
# `127.0.0.1:8693`), so the match is that suffix rather than the port appearing
# somewhere in the line: `1.1.1.1:18693` is not port 8693. A pid is printed
# once even where it listens on both stacks, since a caller ends what it is
# handed. Its stdout is CRLF like every other native Windows tool (wk_jq
# above), so the lines are cleaned before anything reads them.
#
# A port nothing listens on prints NOTHING, on every platform: an empty answer
# is how "the port is free" reads, and no caller has to know which tool said so.
#
# The lookup's own stderr is dropped: a machine that ships no lsof would
# otherwise print "command not found" once per lookup, and macOS lsof warns
# about every mount it cannot stat while answering the port correctly. So a
# machine carrying NEITHER tool answers nothing and its caller reads the port as
# free, which is the deliberate fallback here: a lookup a machine cannot make is
# not a reason to refuse to start.
wk_port_pids() {
  local port="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*)
      netstat -ano | tr -d '\r' | awk -v suffix=":$port" '
        $1 == "TCP" && $4 == "LISTENING" &&
        index($2, suffix) == length($2) - length(suffix) + 1 &&
        !seen[$5]++ { print $5 }'
      ;;
    *) lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null ;;
  esac
}

# wk_end_pid: end a pid `wk_port_pids` answered with, and only such a pid, never
# a shell's OWN child (`$!`, a `pgrep -P` walk): on Windows those are MSYS ids
# and the branch below spells a WINDOWS pid, so it would end a stranger or
# nothing at all. Written the way `kill` is written, so a caller that escalates
# keeps its own flow: `wk_end_pid <pid>` for the polite signal and
# `wk_end_pid -9 <pid>` for the one nothing survives.
#
# A Windows pid is not a pid `kill` knows: bash's builtin speaks MSYS ids and
# says "No such process" for it, and the `-W` option that takes a Windows pid
# belongs to Git Bash's `kill.exe`, which that builtin shadows. `env kill` is
# the program itself, and `-f` is the win32 interface it needs for a process
# MSYS never started, which is every process started by anything but this shell.
#
# That path is forceful whatever signal it is handed, because Windows has NO
# polite end for a process without a window: `taskkill` without `/F` answers
# "This process can only be terminated forcefully" and leaves it running. So
# the escalation is macOS and Linux's distinction, and on Windows the second
# pass ends what the first one already ended.
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
