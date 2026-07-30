#!/usr/bin/env bash
# Daily Claude job — the one cron this kit runs. It writes up the day that just
# ended (claude-nightly.sh), then TRIGGERS the brief in the cloud (issue #82) —
# and only when that dispatch cannot be made does it send the morning brief to
# Claude Code headless here, log the exchange, fire a desktop notification with
# the response, and PUBLISH that response as a Discussion on the home repo
# (issue #86) — the durable copy, and the line the next morning reads its
# cursor from.
# Runs standalone or via launchd (sets its own PATH — launchd provides a bare env).
# Usage: claude-daily.sh [--now | message]   (defaults to the brief-payload payload;
#        --now is the on-demand brief, `npm run brief` — same pipeline, marked manual)
# Log: ~/Library/Logs/claude-daily.log — appended, one timestamped block per run.

set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:$PATH"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# Resolve before any cd — BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Posting the digest as a Discussion is shared with the cloud runner, so it
# lives in one file both source (issue #82).
# shellcheck source=./brief-publish.sh
. "$SCRIPT_DIR/brief-publish.sh"

# The workflow in this repo that runs the brief on a GitHub Actions runner. The
# dispatch below names it; the file is .github/workflows/brief.yml.
BRIEF_WORKFLOW='brief.yml'

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

# The brief's first choice is the CLOUD (issue #82): a `workflow_dispatch` on
# the HOME repo's brief.yml, which composes the same payload on a runner and
# publishes the same Discussion. A laptop that is awake at nine gets the first
# shot at it; the workflow's own cron is the backup for the morning it is not.
#
# The home repo, not this checkout's (issue #91): the workflow and its secrets
# live on `<login>/workkit`, because the plugin repo is distributed and a
# consumer cannot set secrets on a repo they do not own. `workkit setup` seeds
# the workflow there and writes the secrets there, so one slug answers both.
#
# Every reason the dispatch cannot be made — no network, a `gh` that is not
# authenticated, no home repo, a home repo without the workflow — is a silent
# false, and the full local brief runs instead. The delivery for the day is the
# Discussion either way, so the dispatch line is the log's whole record of a
# cloud morning; a desktop notification here would announce nothing the cloud
# has yet said.
dispatch_brief() {
  local engine="$SCRIPT_DIR/../workflow" slug
  [[ -f "$engine/lib.sh" && -f "$engine/home.sh" ]] || return 1
  command -v gh >/dev/null 2>&1 || return 1
  # In a subshell: this is one read of a helper, and sourcing the engine into
  # the job's own shell for it would leak its every function and address.
  slug="$(. "$engine/lib.sh"; . "$engine/home.sh"; wk_home_slug)" || return 1
  [[ -n "$slug" ]] || return 1
  # The workflow existing is not the workflow WORKING: `gh workflow run` succeeds
  # the moment the file is on the default branch, and a runner missing either
  # credential composes nothing worth having — no OAuth token and it composes
  # nothing at all, no `WORKKIT_GITHUB_TOKEN` and it sweeps no board. Every
  # morning in that window would be silently briefless — the laptop having handed
  # the day away to a job that cannot do it. So BOTH secrets are checked on the
  # same repo first, in one listing, and anything but a listing that names them
  # (gh refuses, a secret is absent) is the ordinary silent false that runs the
  # whole brief here.
  local secrets
  secrets="$(gh secret list --repo "$slug" 2>/dev/null)" || return 1
  grep -qE '^CLAUDE_CODE_OAUTH_TOKEN([[:space:]]|$)' <<<"$secrets" || return 1
  grep -qE '^WORKKIT_GITHUB_TOKEN([[:space:]]|$)' <<<"$secrets" || return 1
  gh workflow run "$BRIEF_WORKFLOW" --repo "$slug" >/dev/null 2>&1 || return 1
  DISPATCH_LINE="brief: dispatched $BRIEF_WORKFLOW on $slug — the cloud runner composes and publishes today's brief"
  note "$DISPATCH_LINE"
  return 0
}

# The published dashboard: the tower project in ~/.workkit/tower, rebuilt and
# pushed to the home repo's gh-pages branch. It runs LAST and only for the
# brief, for the same reason the summaries run first and are allowed to fail:
# the job exists to make sure nine o'clock says something, and a build is the
# slowest thing here. Its every reason not to publish — `site.publish` off (the
# default), no home repo, no build tooling, a diverged clone, nothing changed —
# is a skip it logs and exits 0 on,
# so only a real failure ever appears in this block.
#
# It runs on BOTH brief paths: the site is this machine's to build whether the
# digest was composed here or in the cloud.
publish_site() {
  [[ -f "$SCRIPT_DIR/../workflow/publish.sh" ]] || return 0
  local status=0 output
  output="$(${TIMEOUT[@]+"${TIMEOUT[@]}"} bash "$SCRIPT_DIR/../workflow/publish.sh" --quiet 2>&1)" || status=$?
  if (( status != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[publish exit %d — the brief was already sent]\n' "$status"
      printf '%s\n\n' "$output"
    } >> "$LOG_FILE"
  elif [[ -n "$output" ]]; then
    printf '── %s ──\n%s\n\n' "$LOG_STAMP" "$output" >> "$LOG_FILE"
  fi
  return 0
}

# The scheduled brief, and only that: a message argument is the generic headless
# runner and `--now` is a rehearsal that publishes nothing, so neither may hand
# the day to a runner that would publish.
if (( $# == 0 )) && (( MANUAL == 0 )) && dispatch_brief; then
  printf '%s\n' "$DISPATCH_LINE"
  publish_site
  exit 0
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
  # The composer's stderr is kept OUT of the payload: it carries the crash on a
  # failure, and on a good run the one line naming repos the sweep could not read
  # — a token whose reach is short. Either belongs in the log, neither in the
  # message Claude is handed.
  PAYLOAD_ERR_FILE="$SCRATCH_DIR/payload-err"
  MESSAGE="$(node "$SCRIPT_DIR/brief-payload.js" 2>"$PAYLOAD_ERR_FILE")" || PAYLOAD_STATUS=$?
  PAYLOAD_ERR="$(cat "$PAYLOAD_ERR_FILE" 2>/dev/null || true)"
  if (( PAYLOAD_STATUS != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[brief-payload exit %d]\n' "$PAYLOAD_STATUS"
      printf '%s\n\n' "$PAYLOAD_ERR"
    } >> "$LOG_FILE"
    notify "❌ brief-payload exit $PAYLOAD_STATUS — $PAYLOAD_ERR"
    exit "$PAYLOAD_STATUS"
  fi
  if [[ -n "$PAYLOAD_ERR" ]]; then note "$PAYLOAD_ERR"; fi
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
# jobs/brief-publish.sh does the posting — the cloud runner posts the same way
# and there is one file that knows how — and this decides what to do with the
# answer: every outcome is a logged line and a zero return, because the morning
# already happened and a post that could not be made must never undo it.
publish_brief() {
  local line
  # The status is deliberately dropped: on this machine a post that did not land
  # reads the same as one there was no reason to make, and both are the line.
  line="$(wk_brief_publish "$SCRIPT_DIR/../workflow" "$RESPONSE" "$MARK_FILE" "$SCRATCH_DIR/brief.md")" || true
  if [[ -n "$line" ]]; then note "$line"; fi
  return 0
}

# Only the scheduled brief publishes: a message argument is the generic headless
# runner, `--now` is a rehearsal, and a failed send has no digest worth keeping.
if (( $# == 0 )) && (( MANUAL == 0 )) && (( STATUS == 0 )); then
  publish_brief
fi

if (( $# == 0 )); then
  publish_site
fi

printf '%s\n' "$RESPONSE"
exit "$STATUS"
