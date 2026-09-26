#!/usr/bin/env bash
# jobs/morning.sh: the morning, in ONE script (issue #107).
#
# Two schedulers run this same body: the 9am LaunchAgent on this machine
# (com.workkit.claude-daily) and the brief.yml workflow `workkit setup` seeds
# onto the home repo. There is no laptop script and cloud script: there are
# five steps, and each one asks whether the environment it woke up in has what
# that step needs. A step that cannot run here says so by name.
#
#   1 the summaries  need this machine's session transcripts and git history:
#                    the Mac.
#   2 the runner     is the cloud brief's seeded copy on the home repo,
#                    reconciled from the checkout this script sits in: the Mac,
#                    since on a runner that copy IS what is executing.
#   3 the brief      needs the sweep token and the roster, which live on the
#                    home repo: the CLOUD. Here the step is the dispatch and
#                    nothing else: a dispatch that cannot be made is a logged,
#                    briefless morning.
#   4 the publish    needs the home clone and its build tooling: the Mac.
#   5 the marker     writes down what the board actually carries, for the session
#                    hook to warn on: the Mac, since a runner's home dies with
#                    the job and there is nobody there to leave it for.
#
# The environments differ in three DELIBERATE ways, all about where the output
# goes. On a runner the Actions log IS the delivery, so a failure there is loud
# and red; here the morning already happened on screen, so a failure is one
# logged line and exit 0. There is no desktop to notify on a runner. And the
# digest body never reaches the Actions log, which belongs to a repo that could
# be made public: it gets the headline and a byte count as proof of life.
#
# Usage: morning.sh [--now | message]
#   no arguments   the scheduled morning
#   --now          the brief on demand (`npm run brief`): composed and sent
#                  HERE, stamped manual, and publishing nothing: a post at noon
#                  would make the scheduled brief find its own title on the
#                  board and skip, and would advance the news cursor onto news
#                  that brief has yet to report
#   message        the generic headless runner: no summaries, no publish
#   A runner takes no arguments; the workflow passes none.
#
# Runs standalone or via launchd (sets its own PATH: launchd provides a bare env).
# Log: ~/Library/Logs/claude-daily.log, appended, one timestamped block per run,
#      and named for the schedule's label rather than for this file. In the cloud
#      the Actions log is the log.

set -euo pipefail

# Resolve before any cd: BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/../workflow"

# The engine's voice (issue #237): every line this job writes, to the Actions
# log in the cloud or to ~/Library/Logs on a machine, opens with the glyph for
# what happened. lib.sh is seeded onto the runner beside this file
# (WK_HOME_RUNNER_FILES), and the plain fallback covers the one case it is not
# there: a missing logger would end the morning under `set -e`.
if [[ -f "$ENGINE/lib.sh" ]]; then
  # shellcheck source=../workflow/lib.sh
  . "$ENGINE/lib.sh"
fi
if ! declare -f wk_ok >/dev/null 2>&1; then
  wk_ok()    { printf '%s\n' "$1"; }
  wk_skip()  { printf '%s\n' "$1"; }
  wk_info()  { printf '%s\n' "$1"; }
  wk_warn()  { printf '%s\n' "$1" >&2; }
  wk_error() { printf '%s\n' "$1" >&2; }
  wk_spin()  { shift; "$@"; }
fi

# ── Where this run woke up ────────────────────────────────────────────────────

# GITHUB_ACTIONS is the variable Actions always sets, and it is the gate on the
# cloud-only mutations: the brief step there writes a synthetic machine into
# ~/.workkit, which on a laptop is the real roster every other part of the kit
# reads. A stray local run under that branch would leave phantom repos on the
# tower and in the next published slug list.
CLOUD=0
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then CLOUD=1; fi

# The summaries read the day's session transcripts and the roster's git log. A
# machine with neither has no day to write up, and a runner is such a machine,
# which is why this question is asked rather than a mode being passed in.
have_history() {
  [[ -d "${WORKKIT_CLAUDE_PROJECTS:-$HOME/.claude/projects}" ]] || return 1
  command -v git >/dev/null 2>&1
}

# The site is built from the home clone by the engine's own publish, which makes
# every other check itself (no clone, no build tooling, nothing changed). So the
# question here is only whether there is a publish to run at all: the seeded
# cloud runner carries the brief's closure and no engine publish.sh.
have_publish() { [[ -f "$ENGINE/publish.sh" ]]; }

# ── The arguments ─────────────────────────────────────────────────────────────

MANUAL=0
if [[ "${1:-}" == "--now" ]]; then
  MANUAL=1
  shift
fi

# ── The environment each side needs ───────────────────────────────────────────

SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT
# brief-payload.js writes the upstream-version line here and the published body
# is assembled here. Nothing in it outlives the run: the cursor is the
# Discussion, not a file.
MARK_FILE="$SCRATCH_DIR/cc-version"
export WORKKIT_BRIEF_MARK_FILE="$MARK_FILE"
PAYLOAD_ERR_FILE="$SCRATCH_DIR/payload-err"
SEND_ERR_FILE="$SCRATCH_DIR/send-err"

if (( CLOUD )); then
  WK_DIR="$HOME/.workkit"
  # The bash side of the engine and cc-news.js both honor this override; the
  # Node composers resolve ~/.workkit through os.homedir() and honor none.
  # Pinning it to the folder they resolve is what keeps the two halves of the
  # run reading one home.
  export WORKFLOW_HOME="$WK_DIR"
  # The log is the Actions log. One line per thing that happened, in the kit's
  # one line shape, under the glyph for WHICH thing it was: an action taken, a
  # step with nothing to do, or something that needs a person.
  note()      { wk_ok "$1"; }
  note_skip() { wk_skip "$1"; }
  note_warn() { wk_warn "$1"; }
else
  export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:$PATH"
  export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

  # Run from an empty scratch dir. Under launchd the default cwd is / and the job
  # is its own TCC identity (no inherited Terminal grants): Claude Code's startup
  # scan from / trips macOS privacy prompts (Media Library, Documents, …).
  # An empty cwd gives it nothing to scan.
  WORK_DIR="$HOME/Library/Caches/claude-daily"
  mkdir -p "$WORK_DIR"
  cd "$WORK_DIR"

  LOG_FILE="$HOME/Library/Logs/claude-daily.log"
  # The log directory is this step's own to ensure: a home without ~/Library/Logs
  # would fail the append under `set -e`, and the log is the whole record of what
  # this run did.
  mkdir -p "$(dirname "$LOG_FILE")"
  TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
  LOG_STAMP="$TIMESTAMP"
  # The manual stamp, so a reader walking the file back can tell a rehearsal at
  # noon from the nine o'clock run.
  if (( MANUAL )); then LOG_STAMP="$TIMESTAMP (manual)"; fi

  # One block per note: the day's stamp (a log file outlives the day, and no
  # line here carries a clock of its own), then the note itself under the glyph
  # for what happened. One stamp block, three levels through it, and BOTH
  # streams redirected: a warning is stderr's everywhere in the kit, and this
  # file is the whole record of the run.
  note_as() {
    { printf '%s\n' "--- $LOG_STAMP ---"; "$1" "$2"; printf '\n'; } >> "$LOG_FILE" 2>&1
  }
  note()      { note_as wk_ok "$1"; }
  note_skip() { note_as wk_skip "$1"; }
  note_warn() { note_as wk_warn "$1"; }

  # Desktop notification, backgrounded + fully detached from stdio: Notifly
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

  # A HANG is a failure with no exit status, so the two steps that shell out to
  # another script are bounded: 15 minutes, after which timeout's 124 flows down
  # the log-and-continue path like any other failure. `timeout` is homebrew
  # coreutils on macOS and may be absent, so an empty array is the no-bound case,
  # expanded the bash 3.2 way, since a bare "${TIMEOUT[@]}" is an unbound
  # variable there under `set -u`.
  # The `if` is load-bearing too: under `set -e` a bare `command -v … && …` whose
  # left side fails IS the statement's status, and the job would exit right here
  # on a machine without it.
  TIMEOUT=()
  if command -v timeout >/dev/null; then
    TIMEOUT=(timeout 900)
  fi
fi

# ── The steps ─────────────────────────────────────────────────────────────────

# The five steps, one file per step under morning/, in the order the flow below
# runs them. Each defines functions and sets nothing, so every value a piece
# reads is still this script's own, set above before the flow calls into it.
# They are this script's own body, so they are sourced plainly: a missing one is
# a broken checkout, never a refusal like the dispatch lib's. Sourcing runs
# nothing.
# shellcheck source=./morning/summaries.sh
. "$SCRIPT_DIR/morning/summaries.sh"
# shellcheck source=./morning/runner.sh
. "$SCRIPT_DIR/morning/runner.sh"
# shellcheck source=./morning/brief.sh
. "$SCRIPT_DIR/morning/brief.sh"
# shellcheck source=./morning/publish.sh
. "$SCRIPT_DIR/morning/publish.sh"
# shellcheck source=./morning/marker.sh
. "$SCRIPT_DIR/morning/marker.sh"

# The scheduled morning and the rehearsal write the day up; the generic headless
# runner is a prompt, not a morning.
if (( $# == 0 )); then
  summaries
fi

# The scheduled morning and the rehearsal reconcile it; the generic headless
# runner is a prompt, and a prompt seeds nothing.
if (( $# == 0 )); then
  reconcile_runner
fi

STATUS=0
BRIEF_SENT_HERE=0
if (( CLOUD )); then
  # Sourced only where it is used: this is the one home of "post today's digest
  # as a Discussion", and on this machine nothing posts one any more.
  # shellcheck source=./brief-publish.sh
  . "$SCRIPT_DIR/brief-publish.sh"
  cloud_brief
elif (( $# == 0 )) && (( MANUAL == 0 )); then
  # Sourced only where it is used, like the publish above: the dispatch is the
  # scheduled morning's business alone, and `workkit brief` is the other caller
  # of the same one function (issue #54).
  # shellcheck source=./brief-dispatch.sh
  # A checkout missing the lib is a refusal like any other, not an abort under
  # set -e: the publish after this must still run.
  if [[ -f "$SCRIPT_DIR/brief-dispatch.sh" ]]; then
    . "$SCRIPT_DIR/brief-dispatch.sh"
  else
    DISPATCH_REASON="$SCRIPT_DIR/brief-dispatch.sh is missing; a partial checkout"
    dispatch_brief() { return 1; }
  fi
  if dispatch_brief; then
    note "$DISPATCH_LINE"
    printf '%s\n' "$DISPATCH_LINE"
  else
    BRIEFLESS="brief: the day could not be handed to the cloud ($DISPATCH_REASON); no brief this morning"
    note_warn "$BRIEFLESS"
    printf '%s\n' "$BRIEFLESS" >&2
  fi
else
  BRIEF_SENT_HERE=1
  local_send "$@"
fi

# The scheduled morning and the rehearsal publish the site; the generic headless
# runner is a prompt, and a prompt builds nothing.
if (( $# == 0 )); then
  publish_site
fi

# The scheduled morning and the rehearsal record it; the generic headless runner
# is a prompt, and a prompt reads no board.
if (( $# == 0 )); then
  record_brief_status
fi

# The send's status is the run's status, on this machine, where a send happened
# at all. Everything else here has already reported itself and exits 0.
if (( BRIEF_SENT_HERE )); then
  exit "$STATUS"
fi
exit 0
