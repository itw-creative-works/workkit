#!/usr/bin/env bash
# workkit: the one command, the front door to the engine. `usage` below is the
# map; workflow/README.md § The one command is the mechanism.

set -euo pipefail

# The link chain, walked before the dirname: `pwd -P` never resolves the final
# component, so a run through ~/.local/bin/workkit would call ~/.local/bin the
# checkout.
SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  TARGET="$(readlink "$SOURCE")"
  case "$TARGET" in
    /*) SOURCE="$TARGET" ;;
    *)  SOURCE="$(cd "$(dirname "$SOURCE")" && pwd -P)/$TARGET" ;;
  esac
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd -P)"
KIT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

STANDARDS="$SCRIPT_DIR/standards.sh"
CAPTURE="$SCRIPT_DIR/wk.sh"
PUBLISH="$SCRIPT_DIR/publish.sh"
JOBS_INSTALL="$KIT_DIR/jobs/install.sh"
TOWER_START="$KIT_DIR/tower/start.sh"
# The same two files the 9am schedule runs, so `workkit brief` is that morning
# on demand.
MORNING="$KIT_DIR/jobs/morning.sh"
BRIEF_DISPATCH="$KIT_DIR/jobs/brief-dispatch.sh"

# The plugin, as `claude plugin list` names it, and the marketplace this repo is.
PLUGIN_ID="workkit@workkit"

# The installed daily schedule: the marker that says a human ran the install.
DAILY_LABEL="com.workkit.claude-daily"
DAILY_PLIST="${HOME:-}/Library/LaunchAgents/$DAILY_LABEL.plist"

# The PATH line for this is printed and never written: someone's rc file is
# theirs.
BIN_DIR="${HOME:-}/.local/bin"
BIN_LINK="$BIN_DIR/workkit"

# Maintained by standards.sh; named here only so `doctor` can report it.
CLAUDE_HOME="${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}"
ENGINE_LINK="$CLAUDE_HOME/workkit"

# The machine's own folder and its roster, read by `doctor`.
USER_DIR="${WORKFLOW_HOME:-${HOME:-}/.workkit}"
USER_REPOS="$USER_DIR/.repos.json"

# Sourced tolerantly: an incomplete checkout is reported by the steps that need
# these, never by a source that aborts before the command can speak.
HOME_LIBS=1
for _lib in lib/platform.sh lib.sh lib/discussions.sh home.sh; do
  if [[ -f "$SCRIPT_DIR/$_lib" ]]; then
    # shellcheck source=/dev/null
    . "$SCRIPT_DIR/$_lib"
  else
    HOME_LIBS=0
  fi
done

# ── Output ────────────────────────────────────────────────────────────────────
# A partial checkout with no lib.sh still speaks, plainly, through these.
if ! declare -f wk_ok >/dev/null 2>&1; then
  wk_ok()    { printf '%s\n' "$1"; }
  wk_skip()  { [[ "$QUIET" -eq 1 ]] || printf '%s\n' "$1"; }
  wk_info()  { [[ "$QUIET" -eq 1 ]] || printf '%s\n' "$1"; }
  wk_warn()  { printf '%s\n' "$1" >&2; }
  wk_error() { printf '%s\n' "$1" >&2; }
  wk_title() { [[ "$QUIET" -eq 1 ]] || printf '%s\n' "$1"; }
  wk_section() { [[ "$QUIET" -eq 1 ]] || printf '\n%s\n' "$1"; }
  wk_done()  { [[ "$QUIET" -eq 1 ]] || printf '%s\n' "$1"; }
  wk_spin()  { shift; "$@"; }
  wk_plain() { cat; }
fi

# --auto sets it: only actions and warnings speak.
QUIET=0

# Every prompt asks this first and prints the command instead, so a piped or
# backgrounded run finishes rather than hanging.
interactive() { [[ -t 0 ]]; }

usage() {
  cat <<'EOF'
workkit: the issue workflow, one command.

usage: workkit <command> [args]

  help                 this map
  setup                from zero on this machine: the plugin, gh, the 9am
                       schedule, the home repo and whether it publishes its
                       dashboard, the cloud brief's secrets, the tower pointer,
                       this repo's opt-in, the workkit symlink, and npm's
                       script-shell. Safe to re-run
  setup --token        that wizard's Claude-token step alone, forced: mint a
                       new CLAUDE_CODE_OAUTH_TOKEN and push it to the home
                       repo, however young the one there is
  update [--auto]      re-run the machine-side installs: the engine address,
                       the symlink, npm's script-shell, and the schedule (only
                       where one is already installed). --auto is the quiet
                       variant the standards hook runs once a day
  doctor               report what is set up, what has drifted, and the command
                       that fixes anything out of reach
  publish              build the dashboard and publish it from the home repo
                       (the daily job does this after the morning brief)
  brief [--local]      ask for today's brief now: the same cloud run the 9am
                       schedule dispatches. --local runs the local morning
                       instead, composed and sent from this machine, the
                       brief never posted to the home repo
  tower [--verbose]    run the tower here: the JSON API and the dashboard
                       together, until one interrupt ends both
  enable [repo]        write the repo's committed opt-in, then heal it
  decline [repo]       record this developer's no for the repo, personally
  heal [repo]          re-run the standards heal on the repo now, the same
                       pass a session makes once a day, without the wait
  note <text...>       append one bullet to the nearest capture file, or file it
                       as an issue on the home repo outside every project

The engine it drives lives beside this script; the spec both implement is
docs/project-state.md in the checkout.
EOF
}

# What `offer_site_publish` (workkit/site.sh) leaves the switch reading: 'true'
# when publishing is on, 'false' on a fresh no, empty for every other ending.
# `cmd_setup` publishes on 'true' only.
SITE_PUBLISH=''

# 1 when the last `cmd_publish` did not finish: its exit code is always 0, so a
# caller that must know reads this. Reset at every entry.
PUBLISH_FAILED=0

# The cloud brief's two secrets, by name (the rules: workkit/secrets.sh).
SECRET_CLAUDE='CLAUDE_CODE_OAUTH_TOKEN'
# Only names starting with `GITHUB_` are refused by GitHub; one that contains it
# is accepted, which is what lets this say plainly what it is.
SECRET_HOME='WORKKIT_GITHUB_TOKEN'

# The OAuth token lives about a year, so ~11 months is the point where a refresh
# is worth offering: early enough that a morning brief never meets the expiry.
SECRET_MAX_AGE_DAYS=330

# The bound, in seconds, on every read of the cloud secrets (`bounded_read`).
SECRETS_TIMEOUT="${WORKKIT_GH_TIMEOUT:-10}"

# How long the token handover waits for Pages to serve the publish before it
# prints the URL instead. The override is the suite's seam.
PAGES_WAIT="${WORKKIT_PAGES_WAIT:-180}"

# The home repo and its secrets listing, set by `secrets_precheck`
# (workkit/secrets.sh) for its caller.
SECRETS_SLUG=''
SECRETS_JSON=''

# ── The pieces ────────────────────────────────────────────────────────────────

# Sourced plainly, never through the tolerant loop: the pieces are the command,
# so a checkout without them is broken and the source says so.
# shellcheck source=./workkit/links.sh
. "$SCRIPT_DIR/workkit/links.sh"
# shellcheck source=./workkit/schedule.sh
. "$SCRIPT_DIR/workkit/schedule.sh"
# shellcheck source=./workkit/install.sh
. "$SCRIPT_DIR/workkit/install.sh"
# shellcheck source=./workkit/site.sh
. "$SCRIPT_DIR/workkit/site.sh"
# shellcheck source=./workkit/token.sh
. "$SCRIPT_DIR/workkit/token.sh"
# shellcheck source=./workkit/secrets.sh
. "$SCRIPT_DIR/workkit/secrets.sh"
# shellcheck source=./workkit/setup.sh
. "$SCRIPT_DIR/workkit/setup.sh"
# shellcheck source=./workkit/commands.sh
. "$SCRIPT_DIR/workkit/commands.sh"

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "${1:-help}" in
  help|-h|--help) usage ;;
  setup)   shift; cmd_setup "$@" ;;
  update)  shift; cmd_update "$@" ;;
  doctor)  shift; cmd_doctor "$@" ;;
  publish) shift; cmd_publish "$@" ;;
  brief)   shift; cmd_brief "$@" ;;
  tower)
    shift
    # The tower lives in the checkout, not the engine: a partial checkout
    # that copied only workflow/ has nothing to run.
    if [[ ! -f "$TOWER_START" ]]; then
      wk_error "tower: no tower beside this engine ($TOWER_START), and this command needs the workkit checkout"
      exit 1
    fi
    exec bash "$TOWER_START" "$@"
    ;;
  # These four hand the whole run to another script, which speaks for itself.
  enable)  shift; exec bash "$STANDARDS" --enable "${1:-$PWD}" ;;
  decline) shift; exec bash "$STANDARDS" --decline "${1:-$PWD}" ;;
  heal)    shift; exec bash "$STANDARDS" "${1:-$PWD}" ;;
  note)    shift; exec bash "$CAPTURE" note "$@" ;;
  *)
    wk_error "unknown command $1"
    printf '\n' >&2
    usage >&2
    exit 1
    ;;
esac
