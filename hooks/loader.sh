#!/usr/bin/env bash
set -euo pipefail

# Hook loader/router — resolves a hook name to its script and pipes through.
# Usage: loader.sh <hook-name> [extra-args...]
# LOADER-level failures (no name, missing script) fail OPEN (exit 0) so a broken
# loader never wedges the session. The hook's OWN exit code propagates untouched —
# required so blocking hooks (exit 2) actually block.

HOOK_NAME="${1:-}"

# No hook name → fail open
if [[ -z "$HOOK_NAME" ]]; then
  exit 0
fi

# Hooks nest by prefix on disk (docs/board-guard); settings.json may use either
# spelling — colons auto-convert to slashes (docs:board-guard → docs/board-guard).
HOOK_NAME="${HOOK_NAME//://}"

# Generic kill switch: prefix the settings.json command with HOOK_DISABLE=1 to
# no-op that one hook (e.g. `HOOK_DISABLE=1 loader.sh safety:block-unsafe-chains`).
if [[ "${HOOK_DISABLE:-0}" == "1" ]]; then
  exit 0
fi

shift

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/$HOOK_NAME/run.sh"

# Script doesn't exist → fail open
if [[ ! -x "$HOOK_SCRIPT" ]]; then
  exit 0
fi

# Pipe stdin through, forward args, preserve stdout/stderr/exit code.
# (A failed exec — unreadable/broken interpreter — makes bash exit non-zero;
# that is non-2, so it never blocks. The [ -x ] check above already catches
# the common cases and fails open.)
exec "$HOOK_SCRIPT" "$@"
