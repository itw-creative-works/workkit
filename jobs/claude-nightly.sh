#!/usr/bin/env bash
# The summaries step, the first of the 9am job: writes up the day that just
# ended and publishes it as a Discussion on the home repo (a Sunday adds the
# week, the 1st the month, read back from the API). Every reason not to publish
# is one logged line and exit 0 (jobs/README.md § The summaries step).
#
# Usage: claude-nightly.sh [--now]   (the manual trigger, `npm run nightly`)
# Log: ~/Library/Logs/claude-nightly.log, appended, one timestamped block per run.

set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:$PATH"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# Resolved before any cd: BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ENGINE_DIR="$(cd "$SCRIPT_DIR/../workflow" && pwd -P)"

# An empty scratch cwd, entered before anything reaches the network: under
# launchd the cwd is /, and Claude Code's startup scan from there trips macOS
# privacy prompts. The payloads and summaries live here and go with the run.
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
cd "$WORK_DIR"

LOG_FILE="$HOME/Library/Logs/claude-nightly.log"
# The log directory is this step's own to ensure: a home without ~/Library/Logs
# would fail the append under `set -e`, and the line is the whole record of what
# this run decided.
mkdir -p "$(dirname "$LOG_FILE")"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

# --now is the manual trigger, and it bypasses the two guards that exist for the
# scheduled run: the day already published and the quiet day. A person running
# it is explicitly asking for a post: that is what testing the delivery means.
MANUAL=0
if [[ "${1:-}" == "--now" ]]; then
  MANUAL=1
  LOG_STAMP="$TIMESTAMP (manual)"
  shift
fi
LOG_STAMP="${LOG_STAMP:-$TIMESTAMP}"

# The engine's voice, with a plain fallback for the branch below that runs
# before lib.sh is sourced (or a checkout without it); sourcing replaces these.
if ! declare -f wk_ok >/dev/null 2>&1; then
  wk_ok()    { printf '%s\n' "$1"; }
  wk_skip()  { printf '%s\n' "$1"; }
  wk_info()  { printf '%s\n' "$1"; }
  wk_warn()  { printf '%s\n' "$1" >&2; }
  wk_error() { printf '%s\n' "$1" >&2; }
  wk_spin()  { shift; "$@"; }
fi

# One block per note: the stamp (a log file outlives the day), then the note
# under its glyph, both streams redirected: a warning is stderr's everywhere in
# the kit, and this file is the whole record of the run.
note_as() {
  { printf '%s\n' "--- $LOG_STAMP ---"; "$1" "$2"; printf '\n'; } >> "$LOG_FILE" 2>&1
}
note()      { note_as wk_ok "$1"; }
note_skip() { note_as wk_skip "$1"; }
note_warn() { note_as wk_warn "$1"; }

# The engine's home-repo libraries. A checkout missing them has no way to reach
# the destination, which reads exactly like having no destination. The
# destination is the repo, never the clone: a summary is a Discussion, posted
# over the API, so a machine whose ~/.workkit/tower is missing still publishes.
if [[ -f "$ENGINE_DIR/lib.sh" && -f "$ENGINE_DIR/lib/discussions.sh" && -f "$ENGINE_DIR/home.sh" ]]; then
  # shellcheck source=../workflow/lib.sh
  . "$ENGINE_DIR/lib.sh"
  # shellcheck source=../workflow/lib/discussions.sh
  . "$ENGINE_DIR/lib/discussions.sh"
  # shellcheck source=../workflow/home.sh
  . "$ENGINE_DIR/home.sh"
else
  note_warn "summaries: the engine's home-repo library is missing at $ENGINE_DIR; skipped"
  exit 0
fi

HOME_REPO="$(wk_home_slug)"
if [[ -z "$HOME_REPO" ]]; then
  note_skip 'summaries: no home repo configured; skipped'
  exit 0
fi
if ! wk_disc_ready; then
  note_skip "summaries: $HOME_REPO is the home repo, but gh and jq are what reach it; skipped"
  exit 0
fi

# The cadences due today: daily always, the week on a Sunday, the month on the 1st.
DATE="$(date '+%Y-%m-%d')"
CADENCES=(daily)
# Written as `if`s rather than `[[ … ]] && …`: under `set -e` the second form is
# exempt only by a rule about AND-lists, and a reader should not have to know it.
if [[ "$(date '+%u')" == '7' ]]; then CADENCES+=(weekly); fi
if [[ "$(date '+%d')" == '01' ]]; then CADENCES+=(monthly); fi

# The category a cadence publishes in, and the window a rollup reads back.
category_of() {
  case "$1" in
    daily)   printf 'Daily' ;;
    weekly)  printf 'Weekly' ;;
    monthly) printf 'Monthly' ;;
  esac
}
since_of() {
  case "$1" in
    weekly)  date -v-7d '+%Y-%m-%dT00:00:00Z' 2>/dev/null || date -u -d '7 days ago' '+%Y-%m-%dT00:00:00Z' ;;
    monthly) date -v-1m '+%Y-%m-%dT00:00:00Z' 2>/dev/null || date -u -d '1 month ago' '+%Y-%m-%dT00:00:00Z' ;;
  esac
}

# Whether this date's summary for a cadence is already published. The titles are
# fixed (`<cadence>: <date>`), so an exact title match in the window is the
# question, and the answer costs one API call the composition would have cost
# far more than.
already_published() {
  local cadence="$1" posted
  posted="$(wk_disc_list "$HOME_REPO" "$(category_of "$cadence")" "${DATE}T00:00:00Z")" || return 1
  [[ -n "$posted" ]] || return 1
  printf '%s' "$posted" \
    | wk_jq -e --arg t "$cadence: $DATE" 'any(.[]; .title == $t)' >/dev/null 2>&1
}

# One cadence: compose the payload, have Claude write the summary, post it.
# Every failure is a logged line and a zero exit: this step's whole contract.
publish_cadence() {
  local cadence="$1" category payload_file summary_file stderr_file prior='' status=0 url
  category="$(category_of "$cadence")"
  payload_file="$WORK_DIR/$cadence-payload.txt"
  summary_file="$WORK_DIR/$cadence-summary.md"
  stderr_file="$WORK_DIR/$cadence-stderr.log"

  # The day is already written up. A second scheduled run (the job re-fired,
  # the machine woken twice) must not publish a second post about it, and the
  # check comes before the composition so the duplicate costs nothing.
  if (( MANUAL == 0 )) && already_published "$cadence"; then
    note_skip "summaries: $HOME_REPO already carries the $cadence summary for $DATE; nothing posted"
    return 0
  fi

  if [[ "$cadence" == 'daily' ]]; then
    node "$SCRIPT_DIR/claude-nightly/nightly-payload.js" >"$payload_file" 2>/dev/null || status=$?
  else
    # A rollup's inputs are the summaries already published, read back from the
    # API. Nothing to roll up is not a failure: it is a quiet week.
    prior="$(wk_disc_list "$HOME_REPO" 'Daily' "$(since_of "$cadence")")" || prior=''
    if [[ -z "$prior" || "$prior" == '[]' ]]; then
      note_skip "summaries: no daily summaries published since $(since_of "$cadence"); the $cadence rollup has nothing to roll up"
      return 0
    fi
    printf '%s' "$prior" \
      | node "$SCRIPT_DIR/claude-nightly/nightly-payload.js" --cadence "$cadence" >"$payload_file" 2>/dev/null || status=$?
  fi
  if (( status != 0 )); then
    note_warn "summaries: the $cadence payload could not be composed (exit $status); skipped"
    return 0
  fi

  # A quiet period is the payload's own verdict: a summary composed from nothing
  # would put invention in the archive the rollups read. The manual trigger
  # overrides, since a person asking for a post has already decided.
  if (( MANUAL == 0 )) && grep -q '"quiet": true' "$payload_file"; then
    note_skip "summaries: a quiet day; nothing happened in the window, so no $cadence summary was composed or posted"
    return 0
  fi

  # The reflection reads transcripts itself: three read tools and the same root
  # the payload indexed, or the grant and the index would disagree. stderr goes
  # to a file, never the body, or a warning would publish as the first paragraph.
  wk_spin "asking Claude for the $cadence summary" claude -p "$(cat "$payload_file")" \
    --model sonnet \
    --safe-mode \
    --no-session-persistence \
    --tools "Read,Grep,Glob" \
    --add-dir "${WORKKIT_CLAUDE_PROJECTS:-$HOME/.claude/projects}" \
    --max-budget-usd 1.00 >"$summary_file" 2>"$stderr_file" || status=$?
  if [[ -s "$stderr_file" ]]; then
    note_warn "summaries: the $cadence send wrote to stderr:$(printf '\n%s' "$(tail -20 "$stderr_file")")"
  fi
  if (( status != 0 )) || [[ ! -s "$summary_file" ]]; then
    note_warn "summaries: the $cadence summary was not written (exit $status); skipped"
    return 0
  fi

  # Resolved out of a substitution, so the fallback the resolution may have
  # taken comes back with it.
  if ! wk_disc_resolve_category "$HOME_REPO" "$category"; then
    note_warn "summaries: $HOME_REPO has no discussion category to publish the $cadence summary in; skipped, and nothing was written to disk"
    return 0
  fi
  url="$(wk_disc_create "$HOME_REPO" "$WK_DISC_CATEGORY_ID" "$cadence: $DATE" "$summary_file")" || url=''
  if [[ -z "$url" ]]; then
    note_warn "summaries: the $cadence summary could not be posted to $HOME_REPO; skipped, and nothing was written to disk"
    return 0
  fi
  if [[ -n "$WK_DISC_CATEGORY_NAME" && "$WK_DISC_CATEGORY_NAME" != "$category" ]]; then
    note "summaries: posted the $cadence summary in $WK_DISC_CATEGORY_NAME (the $category category does not exist; GitHub has no API that creates one) → $url"
  else
    note "summaries: posted the $cadence summary → $url"
  fi
  return 0
}

for cadence in "${CADENCES[@]}"; do
  publish_cadence "$cadence"
done

exit 0
