#!/usr/bin/env bash
set -euo pipefail

# Hook loader/router: loader.sh <hook-name> [args...] runs the hook's script
# when any repo it acts on opted in, or a Bash command it cannot place
# (lib/optin.sh).
# Loader-level failures fail open (exit 0) so a broken loader never wedges the
# session; the hook's own exit code passes through, so exit 2 still blocks.

HOOK_NAME="${1:-}"

if [[ -z "$HOOK_NAME" ]]; then
  exit 0
fi

# The hooks that run in every repo, opted in or not: each speaks to the machine
# (the setup reminder, the restart notice, its secrets leaving), never to a repo.
OPTIN_EXEMPT="workflow:standards workflow:reload-guard safety:issue-guard"
EXEMPT=0
[[ " $OPTIN_EXEMPT " == *" $HOOK_NAME "* ]] && EXEMPT=1

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
if [[ "$EXEMPT" == "1" ]]; then
  exec "$HOOK_SCRIPT" "$@"
fi

# Every other hook steps aside, silently, unless a repo it acts on opted in.
# The trailing dot keeps the input's trailing newlines, which $(...) strips.
input="$(cat; printf .)" || exit 0
input="${input%.}"
. "$SCRIPT_DIR/lib/optin.sh" 2>/dev/null || exit 0
# A command the check cannot place (2) runs the hook, so a guard fails closed.
rc=0
roots="$(hook_optin_repo "$input")" || rc=$?
if [[ "$rc" != 2 ]]; then
  [[ "$rc" == 0 ]] || exit 0
  opted=0
  while IFS= read -r root; do
    if hook_repo_opted_in "$root"; then opted=1; break; fi
  done <<<"$roots"
  [[ "$opted" == 1 ]] || exit 0
fi

exec "$HOOK_SCRIPT" "$@" < <(printf '%s' "$input")
