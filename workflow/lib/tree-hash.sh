#!/usr/bin/env bash
# workflow/lib/tree-hash.sh: `bash tree-hash.sh <repo_root> [-u]` prints the
# working tree's id through wk_tree_hash (lib/suite.sh), the one home of the
# hash, for a caller that cannot source it: the hooks module runs this file.
# Exits 1, printing nothing, when the id cannot be taken.

set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=./platform.sh
. "$LIB_DIR/platform.sh"
# shellcheck source=./suite.sh
. "$LIB_DIR/suite.sh"

[ -n "${1:-}" ] || { printf 'tree-hash: a repo root is required\n' >&2; exit 1; }
wk_tree_hash "$@"
