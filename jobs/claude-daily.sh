#!/usr/bin/env bash
# Daily Claude job — the one cron this kit runs. It writes up the day that just
# ended (claude-nightly.sh), then sends the morning brief to Claude Code
# headless, logs the exchange, fires a desktop notification with the response,
# and PUBLISHES that response as a Discussion on the home repo (issue #86) —
# the durable copy, and the line the next morning reads its cursor from.
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

# The scratch this run composes in and cleans up after: brief-payload.js writes
# the upstream-version line here (WORKKIT_BRIEF_MARK_FILE) and the published
# body is assembled here. Nothing in it outlives the run — the cursor is the
# Discussion, not a file.
SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT
MARK_FILE="$SCRATCH_DIR/cc-version"
export WORKKIT_BRIEF_MARK_FILE="$MARK_FILE"

LOG_FILE="$HOME/Library/Logs/claude-daily.log"
# The log directory is this step's own to ensure: a home without ~/Library/Logs
# would fail the append under `set -e`, and the log is the whole record of the
# exchange this run sent.
mkdir -p "$(dirname "$LOG_FILE")"
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
# stamp on the log block and that it PUBLISHES NOTHING. A manual run at noon
# would otherwise claim the day's title, and the nine o'clock brief would find
# its own post already there and skip; it would also advance the cursor on news
# the scheduled run has yet to report.
MANUAL=0
if [[ "${1:-}" == "--now" ]]; then
  MANUAL=1
  LOG_STAMP="$TIMESTAMP (manual)"
  shift
fi
LOG_STAMP="${LOG_STAMP:-$TIMESTAMP}"

# One timestamped block, the same shape every other line in this file takes.
note() {
  printf '── %s ──\n%s\n\n' "$LOG_STAMP" "$1" >> "$LOG_FILE"
}

# The summaries step, and it goes FIRST: yesterday is written up before the
# brief is composed, so the morning reads a record that already includes the day
# behind it. claude-nightly.sh stays the one home of that logic — its own guards
# (a day already written up is skipped, a quiet day sends nothing) and its own
# log; calling it is all the wiring there is. It runs only when this is the
# brief: `claude-daily.sh <message>` is still the generic headless runner.
#
# A summaries failure is NOT the brief's failure. It is logged here and the
# morning carries on — the job exists to make sure nine o'clock says something.
# A HANG is that same failure with no exit status, so the step is bounded: 15
# minutes, after which timeout's 124 flows down the log-and-continue path like
# any other. `timeout` is homebrew coreutils on macOS and may be absent, so an
# empty array is the no-bound case — expanded the bash 3.2 way, since a bare
# "${TIMEOUT[@]}" is an unbound variable there under `set -u`.
# The `if` is load-bearing too: under `set -e` a bare `command -v … && …` whose
# left side fails IS the statement's status, and the job would exit right here
# on a machine without it.
TIMEOUT=()
if command -v timeout >/dev/null; then
  TIMEOUT=(timeout 900)
fi

if (( $# == 0 )); then
  SUMMARY_STATUS=0
  SUMMARY_OUTPUT="$(${TIMEOUT[@]+"${TIMEOUT[@]}"} bash "$SCRIPT_DIR/claude-nightly.sh" 2>&1)" || SUMMARY_STATUS=$?
  if (( SUMMARY_STATUS != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[summaries exit %d — the brief continues]\n' "$SUMMARY_STATUS"
      printf '%s\n\n' "$SUMMARY_OUTPUT"
    } >> "$LOG_FILE"
  fi
fi

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

# The brief's durable copy, and the only place the upstream-news cursor is
# recorded: a Discussion on the home repo carrying the digest response and the
# `<!-- cc-news: <version> -->` line brief-payload.js rendered (issue #86).
# Every reason not to publish is a logged line and a zero return — the morning
# already happened, and a post that could not be made must never undo it.
#
# The CATEGORY is asked for by name and answered by the fallback: categories
# cannot be created over the API, so `Brief` resolves to the repo's default
# unless someone made one by hand. The read-back in cc-news.js filters on the
# TITLE for the same reason — it cannot know which category a repo landed in.
publish_brief() {
  local engine="$SCRIPT_DIR/../workflow" slug date title posted body_file url
  if [[ ! -f "$engine/lib.sh" || ! -f "$engine/discussions.sh" || ! -f "$engine/home.sh" ]]; then
    note "brief: the engine's home-repo library is missing at $engine — nothing published"
    return 0
  fi
  # shellcheck source=../workflow/lib.sh
  . "$engine/lib.sh"
  # shellcheck source=../workflow/discussions.sh
  . "$engine/discussions.sh"
  # shellcheck source=../workflow/home.sh
  . "$engine/home.sh"

  slug="$(wk_home_slug)" || slug=''
  if [[ -z "$slug" ]]; then
    note 'brief: no home repo configured — nothing published'
    return 0
  fi
  if ! wk_disc_ready; then
    note "brief: $slug is the home repo, but gh and jq are what reach it — nothing published"
    return 0
  fi

  date="$(date '+%Y-%m-%d')"
  # The prefix cc-news.js reads back by. Kept in step with BRIEF_TITLE_PREFIX
  # there — the one literal this shell and that module both know.
  title="brief: $date"

  # Check before post: the scheduled run may fire twice, and a cloud runner
  # (issue #82) may have already published today's. Either way the answer is the
  # same, and it costs one call.
  posted="$(wk_disc_list "$slug" 'Brief' "${date}T00:00:00Z")" || posted=''
  if [[ -n "$posted" ]] \
    && printf '%s' "$posted" | jq -e --arg t "$title" 'any(.[]; .title == $t)' >/dev/null 2>&1; then
    note "brief: $slug already carries $title — nothing posted"
    return 0
  fi

  body_file="$SCRATCH_DIR/brief.md"
  printf '%s\n' "$RESPONSE" >"$body_file"
  # The version line, verbatim from the module that owns its shape. An empty
  # file is a run that had no version to carry, and it publishes no line.
  if [[ -s "$MARK_FILE" ]]; then
    printf '\n' >>"$body_file"
    cat "$MARK_FILE" >>"$body_file"
  fi

  # One return covers two causes — the category read itself failed, or the repo
  # answered with no categories at all — and this caller cannot tell them apart.
  # Naming one of them would be a guess in the log, so it names neither.
  if ! wk_disc_resolve_category "$slug" 'Brief'; then
    note "brief: could not resolve a discussion category on $slug — nothing posted"
    return 0
  fi
  url="$(wk_disc_create "$slug" "$WK_DISC_CATEGORY_ID" "$title" "$body_file")" || url=''
  if [[ -z "$url" ]]; then
    note "brief: $title could not be posted to $slug — nothing posted"
    return 0
  fi
  note "brief: posted $title → $url"
  return 0
}

# Only the scheduled brief publishes: a message argument is the generic headless
# runner, `--now` is a rehearsal, and a failed send has no digest worth keeping.
if (( $# == 0 )) && (( MANUAL == 0 )) && (( STATUS == 0 )); then
  publish_brief
fi

# The published dashboard: the tower project in ~/.workkit/tower, rebuilt and
# pushed to the home repo's gh-pages branch. It runs LAST and only for the
# brief, for the same reason the summaries run first and are allowed to fail:
# the job exists to make sure nine o'clock says something, and a build is the
# slowest thing here. Its every reason not to publish — `site.publish` off (the
# default), no home repo, no build tooling, a diverged clone, nothing changed —
# is a skip it logs and exits 0 on,
# so only a real failure ever appears in this block.
if (( $# == 0 )) && [[ -f "$SCRIPT_DIR/../workflow/publish.sh" ]]; then
  PUBLISH_STATUS=0
  PUBLISH_OUTPUT="$(${TIMEOUT[@]+"${TIMEOUT[@]}"} bash "$SCRIPT_DIR/../workflow/publish.sh" --quiet 2>&1)" || PUBLISH_STATUS=$?
  if (( PUBLISH_STATUS != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[publish exit %d — the brief was already sent]\n' "$PUBLISH_STATUS"
      printf '%s\n\n' "$PUBLISH_OUTPUT"
    } >> "$LOG_FILE"
  elif [[ -n "$PUBLISH_OUTPUT" ]]; then
    printf '── %s ──\n%s\n\n' "$LOG_STAMP" "$PUBLISH_OUTPUT" >> "$LOG_FILE"
  fi
fi

printf '%s\n' "$RESPONSE"
exit "$STATUS"
