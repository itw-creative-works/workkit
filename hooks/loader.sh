#!/usr/bin/env bash
set -euo pipefail

# Hook loader/router: resolves a hook name to its script and pipes through.
# Usage: loader.sh <hook-name> [extra-args...]
# Loader-level failures fail open (exit 0) so a broken loader never wedges the
# session; the hook's own exit code passes through, so exit 2 still blocks.

HOOK_NAME="${1:-}"

if [[ -z "$HOOK_NAME" ]]; then
  exit 0
fi

# Hooks nest by prefix on disk: docs:board-guard resolves to docs/board-guard.
HOOK_NAME="${HOOK_NAME//://}"

# The generic kill switch: HOOK_DISABLE=1 on a settings command no-ops that hook.
if [[ "${HOOK_DISABLE:-0}" == "1" ]]; then
  exit 0
fi

shift

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/$HOOK_NAME/run.sh"

if [[ ! -x "$HOOK_SCRIPT" ]]; then
  exit 0
fi

# A failed exec exits non-zero but never 2, so it never blocks.
exec "$HOOK_SCRIPT" "$@"
