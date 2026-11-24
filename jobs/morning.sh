#!/usr/bin/env bash
# jobs/morning.sh: the starter of morning.js, the morning in one program, under
# a node at the kit's floor with every argument handed over. The 9am
# LaunchAgent and the brief.yml workflow on the home repo start it by path,
# before any Node is chosen (jobs/README.md).
# Usage: morning.sh [--now | message]

set -euo pipefail

# Physically, since the schedule calls this as ~/.claude/workkit/../jobs/, and a
# logical `..` would step out of the link instead of through it.
SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/../workflow"

if [[ ! -f "$ENGINE/lib/platform.sh" || ! -f "$SCRIPT_DIR/morning.js" ]]; then
  printf 'morning: the engine is missing at %s; the kit is incomplete\n' "$ENGINE" >&2
  exit 1
fi

# shellcheck source=../workflow/lib/platform.sh
. "$ENGINE/lib/platform.sh"

# launchd's PATH holds none of the folders a machine keeps node and the tools in.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
fi

run_at_floor morning 1 "$SCRIPT_DIR/morning.js" "$@"
