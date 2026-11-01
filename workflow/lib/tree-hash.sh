#!/usr/bin/env bash
# workflow/lib/tree-hash.sh: `bash tree-hash.sh <repo_root> [<pkg>]` prints
# the working tree's id, or <pkg>'s own, through wk_tree_hash (lib/suite.sh), the
# one home of the hash, for a caller that cannot source it: the hooks module runs
# this file. `-i` as the only flag prints the real index's id (wk_suite_index_tree);
# `-i` anywhere else, or with anything after it, is refused. Exits 1, printing
# nothing on stdout, when the id cannot be taken or the call is refused.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./platform.sh
. "$LIB_DIR/platform.sh"
# shellcheck source=./suite.sh
. "$LIB_DIR/suite.sh"

[ -n "${1:-}" ] || { printf 'tree-hash: a repo root is required\n' >&2; exit 1; }
root="$1"
shift
if [ "${1:-}" = "-i" ] && [ $# -eq 1 ]; then
  wk_suite_index_tree "$root"
  exit
fi
for arg in "$@"; do
  [ "$arg" != "-i" ] || { printf 'tree-hash: -i takes no other flag or package\n' >&2; exit 1; }
done
wk_tree_hash "$root" "$@"
