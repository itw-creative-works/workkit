#!/bin/bash
# scripts/triage-marker.sh: record that a workkit:triage drain is under way. The
# safety/capture-guard hook reads the marker through the same helper before it
# opens `.workkit/capture.md`; the skill calls this because the hash command
# differs by platform (shasum, sha1sum). The anchor is the repo root, or $HOME
# outside every repo, the same one the guard derives from the capture path.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../hooks/_lib.sh"

anchor=$(git rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$anchor" ] || anchor="$HOME"

marker=$(hook_triage_marker_path "$anchor") || exit 1
_hook_write_marker "$marker"
