#!/bin/bash
# scripts/review-marker.sh [full]: record that the workkit:review skill ran on
# this repo, keyed on the repo root; `full` (the whole panel ran) writes the
# full-panel marker review-covers.sh reads as well. Readers key through the same
# helpers, and the skill calls this because the hash command differs by platform.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../hooks/_lib.sh"

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$root" ]; then
  echo "review-marker: not inside a git repository, so there is no repo to key the marker to." >&2
  exit 1
fi

case "${1:-}" in
  '') full=0 ;;
  full) full=1 ;;
  *) echo "review-marker: unknown argument $1 (usage: review-marker.sh [full])" >&2; exit 1 ;;
esac

marker=$(hook_review_marker_path "$root") || exit 1
_hook_write_marker "$marker"
if [ "$full" -eq 1 ]; then
  marker=$(hook_review_full_marker_path "$root") || exit 1
  _hook_write_marker "$marker"
fi
