#!/bin/bash
# hooks/lib/markers.sh: the digest and the files the hooks name by content:
# hook_sha1, the review and triage marker paths keyed through it, the one
# writer the two marker scripts share, and hook_file_mtime, the one
# modification-time read. SOURCED by hooks/_lib.sh, never executed, and it runs
# nothing at load: it defines functions and sets nothing. It reads no name of
# the entry's.

# hook_sha1: the hex sha1 of STDIN, and nothing else. macOS ships `shasum` and
# no `sha1sum`; a Linux machine ships `sha1sum` and often no `shasum`; Git Bash has
# both. A key computed with a different tool is a different key, so every hook
# that names a marker or a cache file by content asks here instead of spelling
# a digest itself.
# The trailing ` -` both tools print is stripped by parameter expansion: this
# runs on hook paths where a fork is worth avoiding, and `cut` is one more tool
# a stripped PATH may not carry.
# Neither tool present is LOUD (non-zero, one line on stderr): the alternative
# is an empty key, and an empty key is one marker shared by every repo on the
# machine. Callers decide what a refusal means for them.
# Consumers: safety/commit-gate, safety/capture-guard, docs/state-check,
# docs/change-tracker, workflow/standards, workflow/reload-guard, and the two
# marker scripts (scripts/review-marker.sh, scripts/triage-marker.sh).
hook_sha1() {
  local out
  if command -v shasum >/dev/null 2>&1; then
    out=$(shasum)
  elif command -v sha1sum >/dev/null 2>&1; then
    out=$(sha1sum)
  else
    printf 'hook_sha1: neither shasum nor sha1sum is on PATH\n' >&2
    return 1
  fi
  printf '%s\n' "${out%% *}"
}

# _hook_marker_path <dir> <anchor>: the marker file <dir> holds for <anchor>.
# Internal to the two helpers below, which are the only marker names there are.
_hook_marker_path() {
  local key
  key=$(printf '%s' "$2" | hook_sha1) || return 1
  [ -n "$key" ] || return 1
  printf '%s\n' "${TMPDIR:-/tmp}/$1/$key"
}

# _hook_write_marker <path>: make the marker at <path> and print it. Internal to
# the two marker scripts, which have nothing else to do: one tail, so the review
# marker and the triage marker are written exactly alike.
_hook_write_marker() {
  mkdir -p "${1%/*}"
  : > "$1"
  printf '%s\n' "$1"
}

# hook_review_marker_path <repo root>: where the workkit:review skill records
# that review ran, and where safety/commit-gate looks for it.
# hook_triage_marker_path <anchor>: where the workkit:triage skill records that
# a drain is under way, and where safety/capture-guard looks for it.
# ONE derivation per marker, called by both sides: the skill writes through
# scripts/review-marker.sh and scripts/triage-marker.sh, the hook reads here, so
# the writer and the reader cannot drift apart into two spellings of one path.
hook_review_marker_path() { _hook_marker_path claude-review-marker "$1"; }
hook_triage_marker_path() { _hook_marker_path claude-triage-marker "$1"; }

# A file's modification time, in seconds since the epoch; 0 when it cannot be
# read. `stat` disagrees across platforms and does NOT fail cleanly: on GNU
# coreutils `-f` selects filesystem status, where `%m` is undefined, so
# `stat -f %m` prints `?` and exits 0. A plain `||` chain never reaches the
# GNU spelling and hands the caller a non-numeric string. Each spelling is
# therefore accepted only when its output is all digits.
hook_file_mtime() {
  local ts
  for ts in "$(stat -c %Y "$1" 2>/dev/null)" "$(stat -f %m "$1" 2>/dev/null)"; do
    case "$ts" in
      ''|*[!0-9]*) ;;
      *) printf '%s\n' "$ts"; return 0 ;;
    esac
  done
  printf '0\n'
}
