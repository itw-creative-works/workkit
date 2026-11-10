#!/bin/bash
# .github/scripts/ci-node-version.sh [repo]: the Node version ci.yml sets up, one
# line: the repo's root .nvmrc, else its root .node-version, else lts/*. A file's
# value is its first line that is neither blank nor a comment, read as nvm reads
# it; no folder below the root is read. repo defaults to the current folder.

set -euo pipefail

repo="${1:-.}"

# nvm's spellings setup-node does not take: `v22/*` and `v22` are `22`; `lts/*`,
# `node` and a plain version pass through. A trailing comment and a CR go.
for file in .nvmrc .node-version; do
  [ -f "$repo/$file" ] || continue
  version="$(awk '
    { sub(/\r$/, ""); sub(/[ \t]*#.*$/, ""); gsub(/^[ \t]+|[ \t]+$/, "") }
    $0 == "" { next }
    { print; exit }
  ' "$repo/$file")"
  [ -n "$version" ] || continue
  if [[ "$version" =~ ^v([0-9][0-9.]*)(/\*)?$ ]]; then
    version="${BASH_REMATCH[1]}"
  fi
  printf '%s\n' "$version"
  exit 0
done

printf 'lts/*\n'
