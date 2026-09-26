#!/usr/bin/env bash
# workkit: the one command (issue #71).
#
# Installing the plugin wires the hooks, the skills, and the agents. Everything
# else a working machine needs (the 9am schedule, the engine's address, the
# per-repo opt-in, a `workkit` on the PATH) was a set of separate commands
# nobody could find. This is the front door for all of them:
#
#   workkit help                the map
#   workkit setup               from zero: plugin, gh, the schedule, the home
#                               repo, the symlink
#   workkit setup --token       that wizard's Claude-token step alone, forced
#   workkit update [--auto]     re-run the machine-side installs
#   workkit doctor              report drift, print the fix for what it cannot reach
#   workkit publish             build and publish the dashboard from the home repo
#   workkit enable [repo]       the repo's committed yes
#   workkit decline [repo]      this developer's no, recorded personally
#   workkit note <text...>      capture a thought
#
# Agent-agnostic like the rest of the engine: shell only, no Claude Code
# knowledge beyond the name of a CLI it looks for. The checkout is resolved from
# this script's own location: the link chain walked to the real file FIRST, so
# `~/.local/bin/workkit` and `~/.claude/workkit/workkit.sh` both land on the
# checkout rather than on the directory the link happens to sit in.
#
# UPKEEP IS AUTOMATIC. Claude Code has no plugin-install hook, so the trigger is
# the one this kit owns: the workflow:standards SessionStart hook's once-per-day
# run calls `update --auto`. That path only ever UPDATES a schedule a human
# already installed (the installed daily plist is the marker). A first install
# belongs to `setup`, run by a person.

set -euo pipefail

# The link chain, walked before the dirname. `pwd -P` alone resolves the
# DIRECTORIES on the way in, never the final component, so a run through
# ~/.local/bin/workkit would otherwise call ~/.local/bin the checkout, and
# every path below it (the engine, the installer, the symlink this script
# maintains) would name a file that does not exist.
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
# The morning, and the one function that hands it to the cloud: the same two
# files the 9am schedule runs, so `workkit brief` is that morning on demand
# rather than a second way of doing it.
MORNING="$KIT_DIR/jobs/morning.sh"
BRIEF_DISPATCH="$KIT_DIR/jobs/brief-dispatch.sh"

# The plugin, as `claude plugin list` names it, and the marketplace this repo is.
PLUGIN_ID="workkit@workkit"

# The installed daily schedule: the marker that says a human ran the install.
DAILY_LABEL="com.workkit.claude-daily"
DAILY_PLIST="${HOME:-}/Library/LaunchAgents/$DAILY_LABEL.plist"

# The command's own address. ~/.local/bin because it is the one directory a user
# owns that every shell setup already knows about; the PATH line is printed and
# never written: someone's rc file is theirs.
BIN_DIR="${HOME:-}/.local/bin"
BIN_LINK="$BIN_DIR/workkit"

# The engine's address, maintained by standards.sh. Named here only so `doctor`
# can report it: this script never writes it.
CLAUDE_HOME="${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}"
ENGINE_LINK="$CLAUDE_HOME/workkit"

# The machine-maintained roster file (issue #80: the hand-edited settings.json
# holds the site options, and this one holds what the engine records). Read by
# `doctor`, written only by the engine.
USER_REPOS="${WORKFLOW_HOME:-${HOME:-}/.workkit}/.repos.json"

# The platform seam and the home repo's lifecycle: the CRLF-safe jq every JSON
# read here goes through, then creating the repo, cloning it into
# ~/.workkit/tower, seeding the tower project, Discussions, Pages, the doctor
# lines. Sourced rather than shelled out to, so its steps speak in this
# command's own voice (lib.sh's logger, tagged with whichever command the
# dispatch named). Each file is a library: sourcing them runs nothing.
#
# An incomplete checkout is REPORTED by the steps that need them, never by a
# source that aborts before this command can say anything at all: the same
# restraint refresh_engine_link shows about a missing standards.sh. The seam
# rides in the same list for that reason: the command (this entry and the
# workkit/ folder it sources below) runs without the rest of the engine, and a
# source that assumed otherwise would end the run at its first line.
HOME_LIBS=1
for _lib in platform.sh lib.sh discussions.sh home.sh; do
  if [[ -f "$SCRIPT_DIR/$_lib" ]]; then
    # shellcheck source=/dev/null
    . "$SCRIPT_DIR/$_lib"
  else
    HOME_LIBS=0
  fi
done

# ── Output ────────────────────────────────────────────────────────────────────
# Everything a person reads goes to STDOUT: this is a human command, and its one
# machine caller (the standards hook) relays what it prints. The voice is
# lib.sh's, one home for the glyphs, the colors and the question of whether to
# use them at all (issue #237); each command opens with its own title, and the
# steps print indented under it. A partial checkout with no lib.sh beside this
# script still speaks; it speaks plainly, through the fallbacks below.
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

# --auto is the quiet variant: only ACTIONS and warnings speak, so a session
# start that found nothing to do says nothing at all.
QUIET=0

# A step that needs a human answer must never block a script. Every prompt in
# `setup` asks this first and prints the command instead when the answer cannot
# be given: a piped or backgrounded run finishes rather than hanging.
interactive() { [[ -t 0 ]]; }

usage() {
  cat <<'EOF'
workkit: the issue workflow, one command.

usage: workkit <command> [args]

  help                 this map
  setup                from zero on this machine: the plugin, gh, the 9am
                       schedule, the home repo and whether it publishes its
                       dashboard, the cloud brief's secrets, the tower pointer,
                       this repo's opt-in, and the workkit symlink. Safe to
                       re-run
  setup --token        that wizard's Claude-token step alone, forced: mint a
                       new CLAUDE_CODE_OAUTH_TOKEN and push it to the home
                       repo, however young the one there is
  update [--auto]      re-run the machine-side installs: the engine address,
                       the symlink, and the schedule (only where one is already
                       installed). --auto is the quiet variant the standards
                       hook runs once a day
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

# The site step's answer: the step is `offer_site_publish` in workkit/site.sh,
# which says how the question is put.
# What the step LEAVES the switch reading, for the caller that acts on it:
# 'true' when publishing is on (freshly answered yes or already true), 'false'
# on a fresh no, and empty for every other ending, including every skip.
# `cmd_setup` publishes on 'true' and adds nothing at all otherwise (issue #85).
SITE_PUBLISH=''

# What the last `cmd_publish` DID, for the step that runs after it (issue #230).
# The publish never fails a run: it names its own refusal and returns 0, so an
# exit code says nothing about whether the site actually moved. A caller that
# has to know reads this instead: 0 is a publish that finished, 1 is one that
# did not, and it is reset at every entry so only THIS run's ending is read.
PUBLISH_FAILED=0

# The cloud brief's two secrets, by name (workkit/secrets.sh holds the rule a
# value lives by).
SECRET_CLAUDE='CLAUDE_CODE_OAUTH_TOKEN'
# Only names STARTING with `GITHUB_` are refused by GitHub; one that contains it
# is accepted, which is what lets this say plainly what it is.
SECRET_HOME='WORKKIT_GITHUB_TOKEN'

# The OAuth token lives about a year, so ~11 months is the point where a refresh
# is worth offering: early enough that a morning brief never meets the expiry.
SECRET_MAX_AGE_DAYS=330

# The bound, in seconds, on every read of the cloud secrets block
# (`bounded_read`, workkit/secrets.sh says why).
SECRETS_TIMEOUT="${WORKKIT_GH_TIMEOUT:-10}"

# How long the token handover waits for GitHub Pages to serve the publish before
# it prints the URL instead. A publish is usually served inside a minute, and
# three is where waiting stops being useful. The override is what lets the suite
# drive that poll loop in seconds rather than in minutes.
PAGES_WAIT="${WORKKIT_PAGES_WAIT:-180}"

# The home repo and its secrets listing, set by `secrets_precheck`
# (workkit/secrets.sh) for its caller.
SECRETS_SLUG=''
SECRETS_JSON=''

# ── The pieces ────────────────────────────────────────────────────────────────

# The command's own body, one file per concern under workkit/. Each defines
# functions and sets nothing, so every constant and every run-time value a
# piece reads is still this script's own, defined above. Sourced plainly and
# never through the tolerant loop: the pieces ARE the command, so a checkout
# without them is broken, and a source that fails says so. Sourcing runs
# nothing.
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

# Each command opens with its own title (issue #237), which is what makes
# `setup`, `publish` and the 9am job legible in one scrollback.
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
  # The four that hand the whole run to another script: each one speaks in its
  # own voice the moment it starts.
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
