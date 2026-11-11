#!/bin/bash
# .github/scripts/release-push.sh <before>: whether the pushed commit checked out
# here needs the suite, printed as one `run=true|false` line. It is a release stamp
# (false) when every path changed since <before> is the root CHANGELOG.md or a version
# file that changed only its version (hook_is_manifest, hook_version_only_change).
# A <before> commit id the shallow checkout lacks is fetched from origin first. It
# soft-resets HEAD to <before> to judge and back on exit, so the checkout ends as it
# began. Called by the kit's checks.yml `scope` job and by ci.yml's Scope step.

if [ "$#" -lt 1 ]; then
  echo "usage: release-push.sh <before>" >&2
  exit 64
fi

# shellcheck source=../../hooks/_lib.sh
. "${BASH_SOURCE[0]%/*}/../../hooks/_lib.sh"

# A fetch that fails leaves <before> unreadable, which the check below answers.
if [[ "$1" =~ ^[0-9a-f]+$ && ! "$1" =~ ^0+$ ]] && ! git cat-file -e "$1^{commit}" 2>/dev/null; then
  git fetch -q --depth=1 origin "$1" >/dev/null 2>&1 || true
fi

# An unreadable <before> (a new branch, a force push, a commit origin lacks) runs.
if [ -z "$1" ] || [[ "$1" =~ ^0+$ ]] || ! git cat-file -e "$1^{commit}" 2>/dev/null; then
  echo "run=true"
  exit 0
fi

pushed="$(git rev-parse -q --verify HEAD)"
trap 'git reset -q --soft "$pushed"' EXIT
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
