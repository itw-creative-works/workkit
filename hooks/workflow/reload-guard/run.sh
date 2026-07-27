#!/usr/bin/env bash
# workflow:reload-guard — SessionStart + UserPromptSubmit hook (issue #5).
# Tells a session when the kit checkout changed underneath it.
#
# A local-marketplace install resolves ${CLAUDE_PLUGIN_ROOT} to the checkout
# itself, so edits to hook SCRIPTS, skill bodies, and the engine are already
# live — nothing to announce. What is read ONCE, at load time, is the hook
# WIRING (hooks/hooks.json) and the set of agent and skill definitions; a
# change there reaches the session only through /reload-plugins, which is
# interactive and cannot be triggered from a hook. So this reminds, it never
# reloads.
#
# SessionStart stamps the current state of those load-time surfaces under
# ${TMPDIR:-/tmp}, keyed by session id. UserPromptSubmit recomputes it and,
# when it differs from the stamp, injects one line. The stamp is never moved
# forward — the session really is out of date until it reloads — so a
# last-notified marker holds the state already announced and the same change
# nags exactly once. A FURTHER change makes a new state, which nags again.
#
# Always exits 0: a reminder must never cost a prompt. A missing stamp (a
# session that started before this hook was wired, a cleared TMPDIR) is
# re-stamped silently rather than reported as a change nobody made.
#
# RELOAD_GUARD_ROOT overrides the checkout being watched — the tests point it
# at a fixture tree, because the surfaces they change are this repo's own.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null || true)
session_id=$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null || true)

# No session id means nothing to key the stamp by — a comparison against
# another session's state would be worse than silence.
[ -n "$session_id" ] || exit 0

ROOT="${RELOAD_GUARD_ROOT:-$(cd "${BASH_SOURCE[0]%/*}/../../.." && pwd -P)}"

STATE_DIR="${TMPDIR:-/tmp}/workkit-reload-guard"
SAFE="${session_id//[^a-zA-Z0-9]/_}"
STAMP="$STATE_DIR/$SAFE.stamp"
NOTIFIED="$STATE_DIR/$SAFE.notified"

# The load-time file surfaces, one path per line, sorted. The LIST is part of
# the fingerprint as well as the mtimes: a brand-new agent or skill file has no
# previous mtime to differ from, and it is exactly the case the reminder exists
# for.
surfaces() {
  local f
  local -a found=()
  shopt -s nullglob
  for f in "$ROOT"/agents/*.md "$ROOT"/skills/*/SKILL.md; do
    found+=("${f#"$ROOT"/}")
  done
  shopt -u nullglob
  [ "${#found[@]}" -gt 0 ] || return 0
  printf '%s\n' "${found[@]}" | LC_ALL=C sort
}

# hooks.json by CONTENT, not mtime: a rewrite that lands the same wiring (a
# checkout, a reformat) is not a change a session needs to hear about.
fingerprint() {
  local f
  if [ -f "$ROOT/hooks/hooks.json" ]; then
    cat "$ROOT/hooks/hooks.json"
  fi
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    printf '%s %s\n' "$f" "$(hook_file_mtime "$ROOT/$f")"
  done < <(surfaces)
}

# Whatever digest this machine has. The fingerprint is a local listing, not an
# adversarial input, so the point is only that equal states digest equally.
digest() {
  if command -v shasum >/dev/null 2>&1; then
    shasum
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  else
    cksum
  fi | awk '{print $1}'
}

write_state() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  printf '%s\n' "$2" >"$1" 2>/dev/null || true
}

read_state() {
  [ -f "$1" ] || return 0
  cat "$1" 2>/dev/null || true
}

current="$(fingerprint | digest)"

case "$event" in
  SessionStart)
    write_state "$STAMP" "$current"
    # A fresh session has been told nothing yet.
    rm -f "$NOTIFIED" 2>/dev/null || true
    exit 0
    ;;
  UserPromptSubmit) ;;
  *) exit 0 ;;
esac

if [ ! -f "$STAMP" ]; then
  write_state "$STAMP" "$current"
  exit 0
fi

if [ "$(read_state "$STAMP")" = "$current" ]; then
  exit 0
fi
if [ "$(read_state "$NOTIFIED")" = "$current" ]; then
  exit 0
fi

write_state "$NOTIFIED" "$current"

jq -n --arg ctx "workkit changed since this session loaded — /reload-plugins picks up new agents/skills and hook wiring; engine and existing-script edits are already live" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}' || true
exit 0
