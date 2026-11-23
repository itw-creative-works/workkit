#!/usr/bin/env bash
# workflow standards: the starter of standards.js, the heal, which runs under a
# node at the kit's floor with every argument handed over. --command-link stays
# here: its step is workkit/links.sh's. Every mode: workflow/README.md, the standards.sh row.
# Usage: bash standards.sh [--state|--announce|--enable|--decline|--engine-link|--command-link|--home|--git-hooks] [repo_dir]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=./lib/platform.sh
. "$SCRIPT_DIR/lib/platform.sh"

# The command's link needs no repo: links.sh's step alone, with the names it
# reads spelled as workkit.sh spells them. An explicit call, not the automatic
# path, so a missing ~/.local/bin is made; HOME is the tests' seam.
if [[ "${1:-}" == '--command-link' ]]; then
  # shellcheck source=./lib.sh
  . "$SCRIPT_DIR/lib.sh"
  WK_LOG_STDERR=1
  WK_LOG_INDENT='  '
  KIT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
  BIN_DIR="${HOME:-}/.local/bin"
  BIN_LINK="$BIN_DIR/workkit"
  QUIET=0
  # shellcheck source=./workkit/links.sh
  . "$SCRIPT_DIR/workkit/links.sh"
  link_command
  exit 0
fi

run_at_floor standards 1 "$SCRIPT_DIR/standards.js" "$@"
