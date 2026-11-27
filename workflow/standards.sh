#!/usr/bin/env bash
# workflow standards: the starter of standards.js, the heal, which runs under a
# node at the kit's floor with every argument handed over. Every mode:
# workflow/README.md, the standards.sh row.
# Usage: bash standards.sh [--state|--announce|--enable|--decline|--engine-link|--command-link|--home|--git-hooks] [repo_dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=./lib/platform.sh
. "$SCRIPT_DIR/lib/platform.sh"

run_at_floor standards 1 "$SCRIPT_DIR/standards.js" "$@"
