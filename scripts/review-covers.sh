#!/bin/bash
# scripts/review-covers.sh: does a full-panel review cover the working diff? The
# full-panel marker (`scripts/review-marker.sh full`, keyed on the repo root)
# must be newer than every modified, staged and untracked path, and than the
# folder a deleted path left. An empty diff is stale, since commits are unseen.
# Covered exits 0, stale exits 1, usage or a failed git read exits 2.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../hooks/_lib.sh"

root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$root" ]; then
  echo "review-covers: not inside a git repository, so there is no marker to read." >&2
  exit 2
fi

if ! marker=$(hook_review_full_marker_path "$root" 2>/dev/null); then
  echo "review-covers: could not key the review marker (no shasum or sha1sum on PATH)." >&2
  exit 2
fi

if [ ! -f "$marker" ]; then
  echo "review-covers: stale: no full-panel marker"
  exit 1
fi
marked=$(hook_file_mtime "$marker")

tmp=$(mktemp -d "${TMPDIR:-/tmp}/review-covers.XXXXXX") || {
  echo "review-covers: could not make a temp folder." >&2
  exit 2
}
trap 'rm -rf "$tmp"' EXIT
hook_working_paths "$root" >"$tmp/paths" || {
  echo "review-covers: could not list the working diff." >&2
  exit 2
}
if [ ! -s "$tmp/paths" ]; then
  echo "review-covers: stale: no working diff"
  exit 1
fi

while IFS= read -r -d '' rel; do
  # A deletion has no mtime of its own: the nearest folder still standing
  # changed when it went. An edit in the marker's own second may postdate it.
  at="$root/$rel"
  while [ ! -e "$at" ] && [ "$at" != "$root" ]; do at="${at%/*}"; done
  if [ "$(hook_file_mtime "$at")" -ge "$marked" ]; then
    echo "review-covers: stale: $rel"
    exit 1
  fi
done <"$tmp/paths"

echo "review-covers: covered"
