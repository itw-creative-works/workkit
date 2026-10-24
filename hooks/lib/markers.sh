#!/bin/bash
# hooks/lib/markers.sh: the files the hooks name by content: the review,
# full-panel and triage marker paths, the one writer the marker scripts share and
# its sweep, the per-session marker path, and hook_file_mtime. The digest, the
# key rule and the sweep are the engine's (workflow/lib/platform.sh).
# Sourced by hooks/_lib.sh; defines functions and sets nothing.

# hook_sweep_markers: the markers past MARKER_KEEP_DAYS removed; the body is
# wk_sweep_markers, since the engine's record writers sweep too.
hook_sweep_markers() { wk_sweep_markers; }

# _hook_write_marker <path>: make the marker at <path>, sweep, and print it.
# Internal to the two marker scripts, which have nothing else to do: one tail,
# so the review marker and the triage marker are written exactly alike.
_hook_write_marker() {
  mkdir -p "${1%/*}"
  : > "$1"
  hook_sweep_markers
  printf '%s\n' "$1"
}

# The skill marker paths: the writers (the two marker scripts) and
# review-covers.sh (the full panel) name the file here; the module's guards
# read it through markerPath in hooks/mods/markers.js, the same key rule. The proved-tree records' are
# wk_suite_marker_path and wk_pkg_marker_path (workflow/lib/suite.sh).
hook_review_marker_path() { wk_marker_path claude-review-marker "$1"; }
hook_review_full_marker_path() { wk_marker_path claude-review-full-marker "$1"; }
hook_triage_marker_path() { wk_marker_path claude-triage-marker "$1"; }

# hook_session_marker <dir-name> <session_id>: the per-session file under
# ${TMPDIR:-/tmp}/<dir-name>, the id with every non-alphanumeric as `_`. Prints
# the path; the caller makes the directory. Consumers: the dotfiles hooks.
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
