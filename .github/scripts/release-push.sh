#!/bin/bash
# .github/scripts/release-push.sh <before>: whether the pushed commit checked out
# here needs the suite, printed as one `run=true|false` line. It is a release stamp
# (false) when every path changed since <before> is the root CHANGELOG.md or a version
# file that changed only its version (hook_is_manifest, hook_version_only_change).
# It soft-resets HEAD to <before>, so it runs only in a throwaway checkout.
# Called by checks.yml's `scope` job, its output appended to $GITHUB_OUTPUT.

if [ "$#" -lt 1 ]; then
  echo "usage: release-push.sh <before>" >&2
  exit 64
fi

# shellcheck source=../../hooks/_lib.sh
. "${BASH_SOURCE[0]%/*}/../../hooks/_lib.sh"

# An unreadable <before> (a new branch, a force push, a shallow miss) runs.
if [ -z "$1" ] || [[ "$1" =~ ^0+$ ]] || ! git cat-file -e "$1^{commit}" 2>/dev/null; then
  echo "run=true"
  exit 0
fi

git reset -q --soft "$1"

changed=0
while IFS= read -r -d '' path; do
  changed=1
  [ "$path" = "CHANGELOG.md" ] && continue
  hook_is_manifest "$path" && hook_version_only_change . "$path" && continue
  echo "run=true"
  exit 0
done < <(git diff --name-only --no-renames -z HEAD)

[ "$changed" -eq 1 ] && echo "run=false" || echo "run=true"
exit 0
