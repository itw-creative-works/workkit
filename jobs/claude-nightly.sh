#!/usr/bin/env bash
# Nightly Claude job — reflects on the day that just ended and writes the daily
# summary into HQ, plus the weekly rollup on a Sunday and the monthly on the 1st.
# Runs standalone or via launchd (sets its own PATH — launchd provides a bare env).
# Usage: claude-nightly.sh [--now]   (--now is the manual rerun, `npm run nightly`
#        — same pipeline, marked manual, and it replaces today's summary)
# Log: ~/Library/Logs/claude-nightly.log — appended, one timestamped block per run.
#
# The model returns the finished summary and the SCRIPT writes it: a document on
# disk with a known name is the thing the morning can read, and letting the model
# do its own filing would put a write path inside a headless session. HQ is a
# plain directory here — the job never runs git in it.
#
# Observational only. Nothing under `## Improvements` is filed; triage stays the
# one writer of issues.

set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:$PATH"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# Resolve before any cd — BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run from an empty scratch dir. Under launchd the default cwd is / and the job
# is its own TCC identity (no inherited Terminal grants) — Claude Code's startup
# scan from / trips macOS privacy prompts (Media Library, Documents, …).
# An empty cwd gives it nothing to scan.
WORK_DIR="$HOME/Library/Caches/claude-nightly"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

LOG_FILE="$HOME/Library/Logs/claude-nightly.log"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

# Desktop notification — backgrounded + fully detached from stdio: Notifly
# doesn't return until the notification dismisses; never make the job wait.
# NOTIFLY is a seam, not a knob: the suite points it at a recorder so running
# the tests never puts a notification on your screen.
NOTIFLY="${NOTIFLY:-/Applications/Notifly.app/Contents/MacOS/Notifly}"
notify() {
  unset ELECTRON_RUN_AS_NODE
  "$NOTIFLY" \
    --title 'Claude Nightly' \
    --message "${1:0:180}" \
    --appIcon "$HOME/.claude/icon.png" \
    --timeout 10 \
    --sound 'default' </dev/null >/dev/null 2>&1 &
  disown 2>/dev/null || true
}

# One timestamped block saying what the run decided, for the paths that send
# nothing. The sends log the same block shape with the exchange inside it.
note() {
  printf '── %s ──\n%s\n\n' "$LOG_STAMP" "$1" >> "$LOG_FILE"
}

# --now: run tonight's reflection right now, by hand (`npm run nightly`). Same
# pipeline, same log file, same notification — the differences are the `(manual)`
# stamp and permission to replace today's summary, since a manual rerun is how a
# draft gets redone.
MANUAL=0
if [[ "${1:-}" == "--now" ]]; then
  MANUAL=1
  LOG_STAMP="$TIMESTAMP (manual)"
  shift
fi
LOG_STAMP="${LOG_STAMP:-$TIMESTAMP}"

# WORKKIT_NIGHTLY_DATE is the clock seam: the whole run — the file it writes and
# whether a rollup is due — hangs off this one date, so the suite can be Sunday
# or the 1st without waiting for one.
DATE="${WORKKIT_NIGHTLY_DATE:-$(date '+%Y-%m-%d')}"
HQ="${WORKKIT_HQ:-$HOME/Developer/Repositories/Ian-Wiedenman/hq}"
DAILY_FILE="$HQ/summaries/daily/$DATE.md"

# A date, N days earlier. BSD date — this job is macOS-only by construction.
day_before() {
  date -j -v-"$2"d -f '%Y-%m-%d' "$1" '+%Y-%m-%d'
}

# The first line that is neither blank nor a heading — the notification, since a
# document that opens with `## Went well` would notify nothing worth reading.
# A document with no prose at all is empty here, not a failure: grep finding
# nothing is a non-zero pipeline, and under pipefail that would end the run.
first_prose_line() {
  printf '%s\n' "$1" | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' | head -1 || true
}

# Skipping tonight's summary is NOT skipping the run. The rollups read the
# summaries already on disk, and a week closes on its Sunday or not at all — the
# next Sunday computes a different ISO week, so a quiet Sunday that returned
# early would lose that week permanently. Every reason to skip the daily half
# sets this flag and falls through.
SKIP_DAILY=0
RESPONSE=''

# Today's summary already exists and this is the scheduled run: the day was
# already written up, and rewriting it would replace a document someone may have
# already read. Checked before anything is composed, so the rerun costs nothing.
if [[ -f "$DAILY_FILE" && $MANUAL -eq 0 ]]; then
  note "$DATE already has a summary — nothing sent"
  SKIP_DAILY=1
fi

if (( SKIP_DAILY == 0 )); then
  # Guarded like the claude call below: a payload-builder crash must still log
  # and notify — a silent night hides the failure until someone goes looking for
  # a summary that was never written. This one is a failure, not a skip: it
  # leaves the run with nothing to say about the day, rollups included.
  PAYLOAD_STATUS=0
  MESSAGE="$(node "$SCRIPT_DIR/nightly-payload.js" 2>&1)" || PAYLOAD_STATUS=$?
  if (( PAYLOAD_STATUS != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[nightly-payload exit %d]\n' "$PAYLOAD_STATUS"
      printf '%s\n\n' "$MESSAGE"
    } >> "$LOG_FILE"
    notify "❌ nightly-payload exit $PAYLOAD_STATUS — $MESSAGE"
    exit "$PAYLOAD_STATUS"
  fi

  # No transcripts and no commits in the window: there is no day to reflect on. A
  # summary composed from an empty record would be invention, so nothing is sent,
  # nothing is written, and nothing interrupts the morning.
  if printf '%s' "$MESSAGE" | grep -q '"quiet": true'; then
    note "quiet day — no sessions and no commits in the last 24 hours"
    SKIP_DAILY=1
  fi
fi

if (( SKIP_DAILY == 0 )); then
  # The reflection reads transcripts itself, so unlike the morning brief this send
  # carries the three read tools and the transcripts directory — the SAME root the
  # payload indexed, or the grant and the index would disagree.
  STATUS=0
  RESPONSE="$(claude -p "$MESSAGE" \
    --model opus \
    --safe-mode \
    --no-session-persistence \
    --tools "Read,Grep,Glob" \
    --add-dir "${WORKKIT_CLAUDE_PROJECTS:-$HOME/.claude/projects}" \
    --max-budget-usd 1.00 2>&1)" || STATUS=$?

  {
    printf '── %s ──\n' "$LOG_STAMP"
    printf '> %s\n' "${MESSAGE:0:200}"
    if (( STATUS != 0 )); then
      printf '[exit %d]\n' "$STATUS"
    fi
    printf '%s\n\n' "$RESPONSE"
  } >> "$LOG_FILE"

  if (( STATUS != 0 )); then
    notify "❌ exit $STATUS — $RESPONSE"
    printf '%s\n' "$RESPONSE"
    exit "$STATUS"
  fi

  # The send is already paid for by the time we get here, so a write that fails
  # is reported like any other failure rather than ending the run in silence.
  WRITE_STATUS=0
  WRITE_ERROR="$({ mkdir -p "$(dirname "$DAILY_FILE")" && printf '%s\n' "$RESPONSE" > "$DAILY_FILE"; } 2>&1)" || WRITE_STATUS=$?
  if (( WRITE_STATUS != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[write failed: %s]\n' "$DAILY_FILE"
      printf '%s\n\n' "$WRITE_ERROR"
    } >> "$LOG_FILE"
    notify "❌ the summary could not be written — $WRITE_ERROR"
    exit "$WRITE_STATUS"
  fi

  # A document that is all headings would notify an empty message, which reads on
  # screen as a job that failed. The date it filed is the honest fallback.
  NOTIF_MSG="$(first_prose_line "$RESPONSE")"
  if [[ -z "$NOTIF_MSG" ]]; then
    NOTIF_MSG="summary filed for $DATE"
  fi
  notify "$NOTIF_MSG"
fi

# A rollup over the summaries already on disk — the weekly over the last seven
# days, the monthly over the previous month's weeklies. They are small, so they
# ride inline and the send needs no tools at all.
# Usage: rollup <kind> <period> <out-file> <input-file>...
rollup() {
  local kind="$1" period="$2" out="$3"
  shift 3

  local inputs=() file
  for file in "$@"; do
    [[ -f "$file" ]] && inputs+=("$file")
  done
  if (( ${#inputs[@]} == 0 )); then
    note "$kind rollup for $period skipped — none of its summaries exist yet"
    return 0
  fi

  local payload="You are writing the owner's $kind ROLLUP for $period, from the daily-level summaries below.

Read across them, not down each one. Output ONLY the finished markdown document:

## Trends
What moved over the period — direction, not a list of events.

## Recurring friction
What went poorly more than once. Name the pattern and how often it appeared.

## Wins
What landed, and what made it land.

## Carried forward
Improvements raised in the inputs that are still open. One line each, phrased as
a candidate issue.

Nothing is filed from this document. No preamble, no closing remarks, no code
fence around the document itself.

--- SUMMARIES ---"

  for file in "${inputs[@]}"; do
    payload="$payload

--- $(basename "$file") ---
$(cat "$file")"
  done

  local status=0 response
  response="$(claude -p "$payload" \
    --model opus \
    --safe-mode \
    --no-session-persistence \
    --tools "" \
    --max-budget-usd 1.00 2>&1)" || status=$?

  {
    printf '── %s ──\n' "$LOG_STAMP"
    printf '> %s rollup %s (%d summaries)\n' "$kind" "$period" "${#inputs[@]}"
    if (( status != 0 )); then
      printf '[exit %d]\n' "$status"
    fi
    printf '%s\n\n' "$response"
  } >> "$LOG_FILE"

  if (( status != 0 )); then
    notify "❌ $kind rollup exit $status — $response"
    return 0
  fi

  mkdir -p "$(dirname "$out")"
  printf '%s\n' "$response" > "$out"
}

# Sunday closes the week: %u is 7.
if [[ "$(date -j -f '%Y-%m-%d' "$DATE" '+%u')" == '7' ]]; then
  WEEK="$(date -j -f '%Y-%m-%d' "$DATE" '+%G-W%V')"
  WEEK_INPUTS=()
  for i in 0 1 2 3 4 5 6; do
    WEEK_INPUTS+=("$HQ/summaries/daily/$(day_before "$DATE" "$i").md")
  done
  rollup weekly "$WEEK" "$HQ/summaries/weekly/$WEEK.md" "${WEEK_INPUTS[@]}"
fi

# The 1st closes the month before it — every ISO week the previous month touched,
# walked day by day back from its last day so no week is missed or invented.
if [[ "$(date -j -f '%Y-%m-%d' "$DATE" '+%d')" == '01' ]]; then
  CURSOR="$(day_before "$DATE" 1)"
  MONTH="${CURSOR%-*}"
  WEEKS=''
  while [[ "${CURSOR%-*}" == "$MONTH" ]]; do
    WEEK="$(date -j -f '%Y-%m-%d' "$CURSOR" '+%G-W%V')"
    case " $WEEKS " in
      *" $WEEK "*) ;;
      *) WEEKS="$WEEKS $WEEK" ;;
    esac
    CURSOR="$(day_before "$CURSOR" 1)"
  done
  MONTH_INPUTS=()
  for WEEK in $WEEKS; do
    MONTH_INPUTS+=("$HQ/summaries/weekly/$WEEK.md")
  done
  rollup monthly "$MONTH" "$HQ/summaries/monthly/$MONTH.md" "${MONTH_INPUTS[@]}"
fi

if [[ -n "$RESPONSE" ]]; then
  printf '%s\n' "$RESPONSE"
fi
exit 0
