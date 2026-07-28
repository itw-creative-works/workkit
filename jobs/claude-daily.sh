#!/usr/bin/env bash
# Daily Claude job — sends a message to Claude Code headless, logs the exchange,
# and fires a desktop notification with the response.
# Runs standalone or via launchd (sets its own PATH — launchd provides a bare env).
# Usage: claude-daily.sh [--now | message]   (defaults to the brief-payload payload;
#        --now is the on-demand brief, `npm run brief` — same pipeline, marked manual)
# Log: ~/Library/Logs/claude-daily.log — appended, one timestamped block per run.

set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:$PATH"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# Resolve before any cd — BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run from an empty scratch dir. Under launchd the default cwd is / and the job
# is its own TCC identity (no inherited Terminal grants) — Claude Code's startup
# scan from / trips macOS privacy prompts (Media Library, Documents, …).
# An empty cwd gives it nothing to scan.
WORK_DIR="$HOME/Library/Caches/claude-daily"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

LOG_FILE="$HOME/Library/Logs/claude-daily.log"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

# Desktop notification — backgrounded + fully detached from stdio: Notifly
# doesn't return until the notification dismisses; never make the job wait.
# NOTIFLY is a seam, not a knob: the suite points it at a recorder so running
# the tests never puts a notification on your screen.
NOTIFLY="${NOTIFLY:-/Applications/Notifly.app/Contents/MacOS/Notifly}"
notify() {
  unset ELECTRON_RUN_AS_NODE
  "$NOTIFLY" \
    --title 'Claude Daily' \
    --message "${1:0:180}" \
    --appIcon "$HOME/.claude/icon.png" \
    --timeout 10 \
    --sound 'default' </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

# --now: run the 9am brief right now, by hand (`npm run brief`). Same pipeline,
# same log file, same notification — the only differences are the `(manual)`
# stamp on the log block and WORKKIT_BRIEF_MANUAL, which tells brief-payload to
# leave the upstream-news mark where it is so testing the brief at noon cannot
# swallow tomorrow morning's news.
if [[ "${1:-}" == "--now" ]]; then
  export WORKKIT_BRIEF_MANUAL=1
  LOG_STAMP="$TIMESTAMP (manual)"
  shift
fi
LOG_STAMP="${LOG_STAMP:-$TIMESTAMP}"

# Default payload: the morning brief built from the tower's own libs
# (jobs/brief-payload.js). Any argument overrides it — claude-daily.sh stays a
# generic headless runner.
if (( $# > 0 )); then
  MESSAGE="$*"
else
  # Guarded like the claude call below: a payload-builder crash must still
  # log and notify — a silent morning is the one failure mode this job
  # exists to prevent.
  PAYLOAD_STATUS=0
  MESSAGE="$(node "$SCRIPT_DIR/brief-payload.js" 2>&1)" || PAYLOAD_STATUS=$?
  if (( PAYLOAD_STATUS != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[brief-payload exit %d]\n' "$PAYLOAD_STATUS"
      printf '%s\n\n' "$MESSAGE"
    } >> "$LOG_FILE"
    notify "❌ brief-payload exit $PAYLOAD_STATUS — $MESSAGE"
    exit "$PAYLOAD_STATUS"
  fi
fi

STATUS=0
RESPONSE="$(claude -p "$MESSAGE" \
  --model haiku \
  --effort low \
  --safe-mode \
  --no-session-persistence \
  --tools "" \
  --max-budget-usd 0.25 2>&1)" || STATUS=$?

{
  printf '── %s ──\n' "$LOG_STAMP"
  printf '> %s\n' "${MESSAGE:0:200}"
  if (( STATUS != 0 )); then
    printf '[exit %d]\n' "$STATUS"
  fi
  printf '%s\n\n' "$RESPONSE"
} >> "$LOG_FILE"

# The morning brief leads with its HEADLINE line — that's the notification.
NOTIF_MSG="$(printf '%s' "$RESPONSE" | head -1)"
(( STATUS != 0 )) && NOTIF_MSG="❌ exit $STATUS — $RESPONSE"
notify "$NOTIF_MSG"

printf '%s\n' "$RESPONSE"
exit "$STATUS"
