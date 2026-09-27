#!/bin/bash
# scripts/review-marker.sh: record that the workkit:review skill ran on this
# repo, keyed on the repo root. The safety/commit-gate hook reads the marker
# through the same helper, so the path has one spelling; the skill calls this
# because the hash command differs by platform (shasum, sha1sum).

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../hooks/_lib.sh"

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$root" ]; then
  echo "review-marker: not inside a git repository, so there is no repo to key the marker to." >&2
  exit 1
fi

marker=$(hook_review_marker_path "$root") || exit 1
_hook_write_marker "$marker"
