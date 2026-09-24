#!/bin/bash
# scripts/triage-marker.sh: record that a workkit:triage drain is under way.
# The safety/capture-guard hook reads the same marker before it opens
# `.workkit/capture.md`, and reads it through the same helper, so the two can
# never drift into two spellings of one path.
#
# The skill calls this instead of spelling a command, because the spelling is
# platform-bound (macOS has shasum, Linux has sha1sum) and a skill's text is
# read on every platform the kit runs on.
#
# The ANCHOR is the repo root the capture file belongs to, or $HOME for a drain
# run outside every repo (where the capture file is ~/.workkit/capture.md). The
# guard derives the same anchor from the capture file's own path, which is the
# same answer whenever the session stands in the repo it is draining: the file
# it gates is that repo's.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../hooks/_lib.sh"

anchor=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$anchor" ] || anchor="$HOME"

marker=$(hook_triage_marker_path "$anchor") || exit 1
_hook_write_marker "$marker"
