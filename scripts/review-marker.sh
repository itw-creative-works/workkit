#!/bin/bash
# scripts/review-marker.sh: record that the workkit:review skill ran on this
# repo. The safety/commit-gate hook reads the same marker before it lets a code
# commit through, and reads it through the same helper, so the two can never
# drift into two spellings of one path.
#
# The skill calls this instead of spelling a command, because the spelling is
# platform-bound (macOS has shasum, Linux has sha1sum) and a skill's text is
# read on every platform the kit runs on.
#
# Run it from anywhere inside the repo under review; it keys on the repo root.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../hooks/_lib.sh"

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$root" ]; then
  echo "review-marker: not inside a git repository, so there is no repo to key the marker to." >&2
  exit 1
fi

marker=$(hook_review_marker_path "$root") || exit 1
_hook_write_marker "$marker"
