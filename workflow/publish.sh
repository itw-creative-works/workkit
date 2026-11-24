#!/usr/bin/env bash
# workflow/publish.sh: the starter of publish.js, which builds the tower project
# in the home clone and publishes it to gh-pages, under a node at the kit's
# floor with every argument handed over (workflow/README.md § Publishing the dashboard).
# Usage: publish.sh [--quiet]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=./lib/platform.sh
. "$SCRIPT_DIR/lib/platform.sh"

run_at_floor publish 1 "$SCRIPT_DIR/publish.js" "$@"
