#!/usr/bin/env bash
set -euo pipefail

# Hook loader/router: loader.sh <hook-name> [args...] runs the hook's script
# when any repo it acts on opted in, or a Bash command it cannot place
# (lib/optin.sh).
# Loader-level failures fail open (exit 0) so a broken loader never wedges the
# session; the hook's own exit code passes through, so exit 2 still blocks.

HOOK_NAME="${1:-}"

# The generic kill switch: HOOK_DISABLE=1 on a settings command no-ops that hook,
# and leaves no line in the hooks log.
if [[ "${HOOK_DISABLE:-0}" == "1" ]]; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Every hook gets its input from here, so the log can read the event first.
# The trailing dot keeps the input's trailing newlines, which $(...) strips.
input="$(cat; printf .)" || input=""
input="${input%.}"

# The hooks log: one line per fire, read by `workkit log` (docs/hooks.md § The
# hooks log). The engine's wk_hooks_log names it; no engine, no log.
WK_HOOKS_LOG=""
if . "$SCRIPT_DIR/../workflow/lib/platform.sh" 2>/dev/null; then
  wk_hooks_log
fi

# hook_log_field <key>: HOOK_LOG_FIELD becomes the input's first string value for
# <key>, its \\, \" and \/ escapes decoded; empty when the key is absent.
hook_log_field() {
  local re="\"$1\"[[:space:]]*:[[:space:]]*\"(([^\"\\\\]|\\\\.)*)\""
  HOOK_LOG_FIELD=""
  [[ $input =~ $re ]] || return 0
  HOOK_LOG_FIELD="${BASH_REMATCH[1]//\\\\/$'\x01'}"
  HOOK_LOG_FIELD="${HOOK_LOG_FIELD//\\\"/\"}"
  HOOK_LOG_FIELD="${HOOK_LOG_FIELD//\\\//\/}"
  HOOK_LOG_FIELD="${HOOK_LOG_FIELD//$'\x01'/\\}"
}

# hook_log <verdict>: appends `<iso>\t<hook>\t<event>\t<session_id>\t<cwd>\t<verdict>`,
# first cutting a log past 10,000 lines to its last 5,000. Never fails the loader.
hook_log() {
  local now event session cwd lines
  [[ -n "$WK_HOOKS_LOG" ]] || return 0
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)" || now=""
  hook_log_field hook_event_name; event="$HOOK_LOG_FIELD"
  hook_log_field session_id; session="$HOOK_LOG_FIELD"
  hook_log_field cwd; cwd="$HOOK_LOG_FIELD"
  [[ -d "${WK_HOOKS_LOG%/*}" ]] || mkdir -p "${WK_HOOKS_LOG%/*}"
  if [[ -f "$WK_HOOKS_LOG" ]]; then
    lines="$(wc -l <"$WK_HOOKS_LOG")" || lines=0
    if (( lines > 10000 )); then
      { tail -n 5000 "$WK_HOOKS_LOG" >"$WK_HOOKS_LOG.$$" && mv -f "$WK_HOOKS_LOG.$$" "$WK_HOOKS_LOG"; } \
        || rm -f "$WK_HOOKS_LOG.$$"
    fi
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$now" "$HOOK_NAME" "$event" "$session" "$cwd" "$1" >>"$WK_HOOKS_LOG"
} 2>/dev/null

if [[ -z "$HOOK_NAME" ]]; then
  hook_log missing || true
  exit 0
fi

# The hooks that run in every repo, opted in or not: each speaks to the machine
# (its secrets leaving), never to a repo.
OPTIN_EXEMPT="safety:issue-guard"
EXEMPT=0
[[ " $OPTIN_EXEMPT " == *" $HOOK_NAME "* ]] && EXEMPT=1

# Hooks nest by prefix on disk: docs:session resolves to docs/session.
HOOK_SCRIPT="$SCRIPT_DIR/${HOOK_NAME//://}/run.sh"

shift

if [[ ! -x "$HOOK_SCRIPT" ]]; then
  hook_log missing || true
  exit 0
fi

# A failed exec exits non-zero but never 2, so it never blocks.
if [[ "$EXEMPT" == "1" ]]; then
  hook_log run || true
  exec "$HOOK_SCRIPT" "$@" < <(printf '%s' "$input")
fi

# Every other hook steps aside, silently, unless a repo it acts on opted in.
stand_down() {
  hook_log stood-down || true
  exit 0
}
. "$SCRIPT_DIR/lib/optin.sh" 2>/dev/null || stand_down
# A command the check cannot place (2) runs the hook, so a guard fails closed.
rc=0
roots="$(hook_optin_repo "$input")" || rc=$?
if [[ "$rc" != 2 ]]; then
  [[ "$rc" == 0 ]] || stand_down
  opted=0
  while IFS= read -r root; do
    if hook_repo_opted_in "$root"; then opted=1; break; fi
  done <<<"$roots"
  [[ "$opted" == 1 ]] || stand_down
fi

hook_log run || true
exec "$HOOK_SCRIPT" "$@" < <(printf '%s' "$input")
