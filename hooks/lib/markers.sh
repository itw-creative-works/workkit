#!/bin/bash
# hooks/lib/markers.sh: the digest and the files the hooks name by content:
# hook_sha1, the review and triage marker paths keyed through it, the one writer
# the two marker scripts share, the per-session marker path, and hook_file_mtime.
# Sourced by hooks/_lib.sh; defines functions and sets nothing.

# hook_sha1: the hex sha1 of STDIN, through shasum or sha1sum, so every key is
# made by one rule (docs/hooks.md § Platforms). No tool is a loud refusal, never
# an empty key; parameter expansion strips the ` -` to spare a fork.
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

# The two marker paths, one derivation each: the skill writes through
# scripts/review-marker.sh or scripts/triage-marker.sh and the guard
# (commit-gate, capture-guard) reads here, so the two never drift apart.
hook_review_marker_path() { _hook_marker_path claude-review-marker "$1"; }
hook_triage_marker_path() { _hook_marker_path claude-triage-marker "$1"; }

# hook_session_marker <dir-name> <session_id>: the per-session file under
# ${TMPDIR:-/tmp}/<dir-name>, the id with every non-alphanumeric as `_`. Prints
# the path; the caller makes the directory. Consumers: safety/test-reminder,
# docs/checkpoint, workflow/reload-guard, hook_session_model.
hook_session_marker() {
  printf '%s\n' "${TMPDIR:-/tmp}/$1/${2//[^a-zA-Z0-9]/_}"
}

# hook_file_mtime <file>: epoch seconds, 0 when unreadable. GNU `stat -f %m`
# prints `?` and exits 0, so each spelling counts only when it prints digits.
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
