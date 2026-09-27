#!/usr/bin/env bash
# workflow:reload-guard: SessionStart + UserPromptSubmit hook. Hook scripts,
# skill bodies and the engine are live already; hooks.json and the agent and
# skill file set load once, so a change there nags once to /reload-plugins.
# SessionStart stamps those surfaces per session id; a prompt compares, and a
# last-notified marker keeps each change to one nag. A missing stamp re-stamps
# silently. Always exits 0. RELOAD_GUARD_ROOT points the tests at a fixture.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

event=$(printf '%s' "$input" | hook_jq -r '.hook_event_name // empty' 2>/dev/null || true)
session_id=$(printf '%s' "$input" | hook_jq -r '.session_id // empty' 2>/dev/null || true)

# No session id means nothing to key the stamp by. A comparison against
# another session's state would be worse than silence.
[ -n "$session_id" ] || exit 0

ROOT="${RELOAD_GUARD_ROOT:-$(cd "${BASH_SOURCE[0]%/*}/../../.." && pwd -P)}"

MARKER=$(hook_session_marker workkit-reload-guard "$session_id")
STATE_DIR="${MARKER%/*}"
STAMP="$MARKER.stamp"
NOTIFIED="$MARKER.notified"

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

write_state() {
  mkdir -p "$STATE_DIR" 2>/dev/null || return 0
  printf '%s\n' "$2" >"$1" 2>/dev/null || true
}

read_state() {
  [ -f "$1" ] || return 0
  cat "$1" 2>/dev/null || true
}

# The fingerprint is a local listing, not an adversarial input, so the point
# is only that equal states digest equally. No digest tool at all leaves the key
# empty on both sides of every comparison below, so the guard stays silent: it
# is a nag, and a nag fails silent rather than loud.
current="$(fingerprint | hook_sha1 2>/dev/null || true)"

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

hook_jq -n --arg ctx "workkit changed since this session loaded. /reload-plugins picks up new agents/skills and hook wiring; engine and existing-script edits are already live" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}' || true
exit 0
