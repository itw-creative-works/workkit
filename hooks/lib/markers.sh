#!/bin/bash
# hooks/lib/markers.sh: the files the hooks name by content: the review,
# full-panel and triage marker paths, the one writer the marker scripts share, the
# per-session marker path, and hook_file_mtime. The digest and the key rule
# are the engine's (wk_sha1, wk_marker_path in workflow/lib/platform.sh).
# Sourced by hooks/_lib.sh; defines functions and sets nothing.

# _hook_write_marker <path>: make the marker at <path> and print it. Internal to
# the two marker scripts, which have nothing else to do: one tail, so the review
# marker and the triage marker are written exactly alike.
_hook_write_marker() {
  mkdir -p "${1%/*}"
  : > "$1"
  printf '%s\n' "$1"
}

# The skill marker paths: the writers (the two marker scripts) and the readers
# (commit-gate, capture-guard, review-covers.sh for the full panel) name the file
# here, so the two sides never drift apart. The suite record's is wk_suite_marker_path.
hook_review_marker_path() { wk_marker_path claude-review-marker "$1"; }
hook_review_full_marker_path() { wk_marker_path claude-review-full-marker "$1"; }
hook_triage_marker_path() { wk_marker_path claude-triage-marker "$1"; }

# hook_session_marker <dir-name> <session_id>: the per-session file under
# ${TMPDIR:-/tmp}/<dir-name>, the id with every non-alphanumeric as `_`. Prints
# the path; the caller makes the directory. Consumers: safety/test-reminder,
# docs/checkpoint, workflow/reload-guard, workflow/feature, hook_session_model.
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
