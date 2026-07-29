#!/usr/bin/env bash
# workkit — the one command (issue #71).
#
# Installing the plugin wires the hooks, the skills, and the agents. Everything
# else a working machine needs — the 9am schedule, the engine's address, the
# per-repo opt-in, a `workkit` on the PATH — was a set of separate commands
# nobody could find. This is the front door for all of them:
#
#   workkit help                the map
#   workkit setup               from zero: plugin, gh, the schedule, the home
#                               repo, the symlink
#   workkit update [--auto]     re-run the machine-side installs
#   workkit doctor              report drift, print the fix for what it cannot reach
#   workkit publish             build and publish the dashboard from the home repo
#   workkit enable [repo]       the repo's committed yes
#   workkit decline [repo]      this developer's no, recorded personally
#   workkit note <text...>      capture a thought
#
# Agent-agnostic like the rest of the engine: shell only, no Claude Code
# knowledge beyond the name of a CLI it looks for. The checkout is resolved from
# this script's own location — the link chain walked to the real file FIRST, so
# `~/.local/bin/workkit` and `~/.claude/workkit/workkit.sh` both land on the
# checkout rather than on the directory the link happens to sit in.
#
# UPKEEP IS AUTOMATIC. Claude Code has no plugin-install hook, so the trigger is
# the one this kit owns: the workflow:standards SessionStart hook's once-per-day
# run calls `update --auto`. That path only ever UPDATES a schedule a human
# already installed (the installed daily plist is the marker) — a first install
# belongs to `setup`, run by a person.

set -euo pipefail

# The link chain, walked before the dirname. `pwd -P` alone resolves the
# DIRECTORIES on the way in, never the final component, so a run through
# ~/.local/bin/workkit would otherwise call ~/.local/bin the checkout — and
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

# The plugin, as `claude plugin list` names it, and the marketplace this repo is.
PLUGIN_ID="workkit@workkit"

# The installed daily schedule — the marker that says a human ran the install.
DAILY_LABEL="com.workkit.claude-daily"
DAILY_PLIST="${HOME:-}/Library/LaunchAgents/$DAILY_LABEL.plist"

# The command's own address. ~/.local/bin because it is the one directory a user
# owns that every shell setup already knows about; the PATH line is printed and
# never written — someone's rc file is theirs.
BIN_DIR="${HOME:-}/.local/bin"
BIN_LINK="$BIN_DIR/workkit"

# The engine's address, maintained by standards.sh. Named here only so `doctor`
# can report it — this script never writes it.
CLAUDE_HOME="${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}"
ENGINE_LINK="$CLAUDE_HOME/workkit"

# The machine-maintained roster file (issue #80: the hand-edited settings.json
# holds the site options, and this one holds what the engine records). Read by
# `doctor`, written only by the engine.
USER_REPOS="${WORKFLOW_HOME:-${HOME:-}/.workkit}/.repos.json"

# The home repo's lifecycle — creating it, cloning it into ~/.workkit/tower,
# seeding the tower project, Discussions, Pages, the doctor lines. Sourced
# rather than shelled out to, so its steps speak in this command's own voice
# (lib.sh's
# wk_say_* delegate to the say_* below). Each file is a library: sourcing them
# runs nothing.
#
# An incomplete checkout is REPORTED by the steps that need them, never by a
# source that aborts before this command can say anything at all — the same
# restraint refresh_engine_link shows about a missing standards.sh.
HOME_LIBS=1
for _lib in lib.sh discussions.sh home.sh; do
  if [[ -f "$SCRIPT_DIR/$_lib" ]]; then
    # shellcheck source=/dev/null
    . "$SCRIPT_DIR/$_lib"
  else
    HOME_LIBS=0
  fi
done

# ── Output ────────────────────────────────────────────────────────────────────
# Everything goes to STDOUT: this is a human command, and its one machine caller
# (the standards hook) relays what it prints. Colors only for a terminal — the
# hook puts this text into a session's context, where escape codes are noise.
_G='\033[0;32m' _Y='\033[0;33m' _C='\033[0;36m' _D='\033[0;90m' _B='\033[1m' _N='\033[0m'
if [[ ! -t 1 ]]; then _G='' _Y='' _C='' _D='' _B='' _N=''; fi

# --auto is the quiet variant: only ACTIONS and warnings speak, so a session
# start that found nothing to do says nothing at all.
QUIET=0

say_ok()   { printf "${_G}✓${_N} %s\n" "$1"; }
say_warn() { printf "${_Y}⚠${_N} %s\n" "$1"; }
say_skip() { [[ "$QUIET" -eq 1 ]] || printf "${_D}· %s${_N}\n" "$1"; }
say_info() { [[ "$QUIET" -eq 1 ]] || printf "${_C}ℹ${_N} %s\n" "$1"; }
say_head() { [[ "$QUIET" -eq 1 ]] || printf "\n${_B}%s${_N}\n" "$1"; }

# A step that needs a human answer must never block a script. Every prompt in
# `setup` asks this first and prints the command instead when the answer cannot
# be given — a piped or backgrounded run finishes rather than hanging.
interactive() { [[ -t 0 ]]; }

usage() {
  cat <<'EOF'
workkit — the issue workflow, one command.

usage: workkit <command> [args]

  help                 this map
  setup                from zero on this machine: the plugin, gh, the 9am
                       schedule, the tower pointer, this repo's opt-in, and
                       the workkit symlink. Safe to re-run
  update [--auto]      re-run the machine-side installs: the engine address,
                       the symlink, and the schedule (only where one is already
                       installed). --auto is the quiet variant the standards
                       hook runs once a day
  doctor               report what is set up, what has drifted, and the command
                       that fixes anything out of reach
  publish              build the dashboard and publish it from the home repo
                       (the daily job does this after the morning brief)
  enable [repo]        write the repo's committed opt-in, then heal it
  decline [repo]       record this developer's no for the repo, personally
  note <text...>       append one bullet to the nearest inbox, or file it as an
                       issue on the home repo outside every project

The engine it drives lives beside this script; the spec both implement is
docs/project-state.md in the checkout.
EOF
}

# ── The pieces ────────────────────────────────────────────────────────────────

# The engine's address is standards.sh's own to maintain — it points
# ~/.claude/workkit at the folder it is running from, when that folder is a real
# workkit checkout. `--engine-link` is that step on its own, which is how this
# command triggers it without owning a second copy of it. Its diagnostics arrive
# on stderr, so an action line is relayed and silence stays silent.
refresh_engine_link() {
  local out rc=0
  # A missing engine is a broken checkout, never a machine that is up to date:
  # the two must not read the same, or a half-installed kit reports all-clear.
  if [[ ! -f "$STANDARDS" ]]; then
    say_warn "engine: standards.sh is missing at $STANDARDS — this checkout is incomplete, so the engine address cannot be maintained"
    return 0
  fi

  out="$(bash "$STANDARDS" --engine-link "$KIT_DIR" 2>&1 >/dev/null)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    say_warn "engine: the address step could not run (exit $rc) — run \`bash $STANDARDS --engine-link $KIT_DIR\` to see why"
    return 0
  fi

  out="$(printf '%s\n' "$out" | sed $'s/\033\\[[0-9;]*m//g' | grep '^  ✓ engine:' || true)"
  if [[ -n "$out" ]]; then
    # Relay each engine line as its own say_ok, stripping the prefix per line.
    while IFS= read -r line; do
      say_ok "${line#  ✓ }"
    done <<<"$out"
  else
    # Silence is two different outcomes: the address already resolves here, or
    # the engine REFUSED to write it (no ~/.claude, no git, a checkout that is
    # not the machine's engine). Only the first is "current", so the address is
    # read back rather than assumed — a refusal that reads as up to date is the
    # one report this command must not print (verifier finding, 2026-07-29).
    if [[ -L "$ENGINE_LINK" && "$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)" == "$SCRIPT_DIR" ]]; then
      say_skip "engine: $ENGINE_LINK is current"
    else
      say_skip "engine: $ENGINE_LINK was left as it is — this checkout does not take the engine's address"
    fi
  fi
}

# ~/.local/bin/workkit → this script. A link pointing somewhere else is
# repointed (a moved checkout is the ordinary case); a real file is a human's
# and is only reported.
link_command() {
  local current
  # The automatic path CREATES nothing on a machine that has no ~/.local/bin —
  # the same restraint the engine shows with ~/.claude. A directory convention a
  # machine has not adopted is not a session start's to introduce; a human
  # running `setup` or `update` is asking for it.
  if [[ "$QUIET" -eq 1 && ! -d "$BIN_DIR" ]]; then
    return 0
  fi

  if [[ -L "$BIN_LINK" ]]; then
    current="$(readlink "$BIN_LINK" || true)"
    if [[ "$current" == "$SCRIPT_DIR/workkit.sh" ]]; then
      say_skip "command: $BIN_LINK is current"
    else
      ln -sfn "$SCRIPT_DIR/workkit.sh" "$BIN_LINK"
      say_ok "command: repointed $BIN_LINK at $SCRIPT_DIR/workkit.sh"
    fi
  elif [[ -e "$BIN_LINK" ]]; then
    say_warn "command: $BIN_LINK is a real file — move it aside, then re-run \`workkit update\`"
    return 0
  else
    mkdir -p "$BIN_DIR"
    ln -s "$SCRIPT_DIR/workkit.sh" "$BIN_LINK"
    say_ok "command: linked $BIN_LINK → $SCRIPT_DIR/workkit.sh"
  fi

  case ":${PATH:-}:" in
    *":$BIN_DIR:"*) ;;
    *) say_info "command: $BIN_DIR is not on your PATH — add it to your shell rc:
    export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
}

# What the installed schedule differs from this checkout in, one line per agent,
# and nothing at all when it is current. `install.sh --check` renders and
# compares without touching launchd, which is what keeps the daily run down to a
# couple of short shell invocations and no launchd call.
#
# Two failures must never read as "current": an installer this checkout does not
# have, and a check that could not finish. Both print their reason on stdout and
# return 1 — the caller is in a command substitution, so the reason travels back
# with the status and is reported there.
cron_drift() {
  if [[ ! -f "$JOBS_INSTALL" ]]; then
    printf 'the installer is missing at %s — this checkout is incomplete\n' "$JOBS_INSTALL"
    return 1
  fi
  bash "$JOBS_INSTALL" --check 2>/dev/null || {
    printf 'the drift check did not finish — run `bash %s --check` to see why\n' "$JOBS_INSTALL"
    return 1
  }
}

# Run the installer and relay what it ACTUALLY did — one line per agent, in the
# installer's own words, so a run that changed nothing never claims to have
# reinstalled the 9am job. A failure is reported and swallowed: this
# runs inside a session-start hook that discards stderr, so an unguarded
# `set -e` abort here would be invisible and would retry silently every day.
run_installer() {
  local out rc=0
  out="$(bash "$JOBS_INSTALL" 2>&1)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    say_warn "schedule: the install did not finish (exit $rc) — run \`bash $JOBS_INSTALL\` to see why"
    return 0
  fi
  # "already installed and loaded" is the installer confirming a no-op; every
  # other line is something it did.
  printf '%s\n' "$out" | grep -v 'already installed and loaded' | grep -v '^[[:space:]]*$' \
    | while IFS= read -r line; do say_ok "schedule: $line"; done || true
}

# Re-render and reload the schedule, but ONLY on a machine that already has it:
# installing a cron is a decision, and `setup` is where a human makes it. The
# rest is install.sh's — it renders, compares, and reloads only on a difference.
update_cron() {
  local drift
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_skip "schedule: launchd is macOS — nothing to keep current here"
    return 0
  fi
  if [[ ! -f "$DAILY_PLIST" ]]; then
    say_info "schedule: not installed on this machine — \`workkit setup\` installs the 9am job"
    return 0
  fi

  if ! drift="$(cron_drift)"; then
    say_warn "schedule: $drift"
    return 0
  fi
  if [[ -z "$drift" ]]; then
    say_skip "schedule: $DAILY_LABEL is current"
    return 0
  fi

  run_installer
}

# The plugin, on a machine that may not have Claude Code at all. Detection first,
# because `marketplace add` on an installed marketplace is noise nobody needs to
# read; a missing `claude` is a named skip, never a failure — the engine, the
# schedule, and the capture CLI all work without it.
install_plugin() {
  if ! command -v claude >/dev/null 2>&1; then
    say_skip "plugin: the claude CLI is not on this machine — skipping the plugin install"
    return 0
  fi
  if claude plugin list --json 2>/dev/null | grep -q "\"$PLUGIN_ID\""; then
    say_skip "plugin: $PLUGIN_ID is installed"
    return 0
  fi
  claude plugin marketplace add "$KIT_DIR" >/dev/null 2>&1 \
    || { say_warn "plugin: \`claude plugin marketplace add $KIT_DIR\` did not finish — run it by hand"; return 0; }
  claude plugin install "$PLUGIN_ID" >/dev/null 2>&1 \
    || { say_warn "plugin: \`claude plugin install $PLUGIN_ID\` did not finish — run it by hand"; return 0; }
  say_ok "plugin: installed $PLUGIN_ID from $KIT_DIR — it loads in a new session"
}

# gh is how the whole standard reaches its issues; an unauthenticated one turns
# the label heals, the board, and the brief into skips. Report, never fix: `gh
# auth login` is a browser flow and a human's to run.
check_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    say_warn "gh: not installed — the label heals and the board need it (https://cli.github.com)"
    return 0
  fi
  if gh auth status >/dev/null 2>&1; then
    say_skip "gh: installed and authenticated"
  else
    say_warn "gh: installed but not authenticated — run \`gh auth login\`"
  fi
}

# The tower is started, never installed: it is two long-running processes and
# nothing schedules them. Setup's job is to say where they are.
tower_pointer() {
  say_info "tower: mission control is \`npm run tower\` in $KIT_DIR (the API on 8693); its dashboard is tower/app on 4300"
}

# The repo the shell is standing in. Undecided is the only state with anything
# to ask, and the question is asked only where there is someone to answer it.
offer_repo() {
  local state
  state="$(bash "$STANDARDS" --state "$PWD" 2>/dev/null | tail -1 || printf 'nogit')"
  case "$state" in
    enabled)  say_skip "repo: $PWD is in the workflow" ;;
    disabled) say_skip "repo: $PWD has a committed no — leaving it alone" ;;
    nogit)    say_skip "repo: $PWD is not a git repo — nothing to enable" ;;
    declined|undecided)
      if ! interactive; then
        say_info "repo: $PWD is not in the workflow — \`workkit enable\` joins it"
        return 0
      fi
      printf 'Add %s to the issue workflow? [y/N] ' "$PWD"
      local answer=""
      read -r answer || true
      case "$answer" in
        y|Y|yes|YES) bash "$STANDARDS" --enable "$PWD" ;;
        *) say_skip "repo: left as it is — \`workkit enable\` joins it later" ;;
      esac
      ;;
    *) say_skip "repo: $PWD reports state '$state' — nothing to do" ;;
  esac
}

# The global layer, reported and never written: how many repos this machine has
# registered in the roster (the engine maintains it on every heal), and whether a
# home repo is named for the work that belongs to no single repo.
report_globals() {
  local count home

  if [[ ! -f "$USER_REPOS" ]]; then
    say_info "roster: $USER_REPOS does not exist yet — the first heal writes it"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    say_skip "roster: reading $USER_REPOS needs jq"
    return 0
  fi

  count="$(jq -r '[(.repos // {}) | to_entries[] | select(.value != "declined")] | length' "$USER_REPOS" 2>/dev/null || printf '')"
  if [[ -z "$count" ]]; then
    say_warn "roster: $USER_REPOS is not valid JSON — fix or remove it, then re-run a session in any repo"
    return 0
  fi
  # Zero is the one count worth a different voice: an empty roster means the
  # tower, the board and the brief have nothing to read.
  if [[ "$count" == "0" ]]; then
    say_info "roster: no repos registered in $USER_REPOS yet — it fills as a session opens in each enabled repo"
  else
    say_ok "roster: $count repo(s) registered in $USER_REPOS"
  fi

}

# The home repo half of setup: the private repo, the clone at ~/.workkit/tower,
# the tower project seeded into it, its dependencies, Discussions and Pages. A
# machine without the libraries (an incomplete checkout) is told which command
# to run once it has them, rather than silently getting no home.
home_steps() {
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    say_warn "home: the home-repo library is missing beside $SCRIPT_DIR — this checkout is incomplete"
    return 0
  fi
  wk_home_setup
}

# ── The commands ──────────────────────────────────────────────────────────────

cmd_setup() {
  say_head "workkit setup — $KIT_DIR"
  install_plugin
  check_gh
  refresh_engine_link
  link_command
  install_cron
  home_steps
  tower_pointer
  offer_repo
  say_head "Setup is idempotent — re-run it any time. \`workkit doctor\` reports what is left."
}

# The FIRST install of the schedule, which only ever happens here: a human ran
# this command. `update` from then on keeps it current.
install_cron() {
  local drift
  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_skip "schedule: launchd is macOS — the 9am job is not available here"
    return 0
  fi

  if [[ -f "$DAILY_PLIST" ]]; then
    # Already installed: the only question left is whether it still matches this
    # checkout, and a check that cannot answer stops the step rather than
    # reinstalling on a guess. Either way setup carries on — the steps after
    # this one have nothing to do with launchd.
    if ! drift="$(cron_drift)"; then
      say_warn "schedule: $drift"
      return 0
    fi
    if [[ -z "$drift" ]]; then
      say_skip "schedule: $DAILY_LABEL is installed and current"
      return 0
    fi
  elif [[ ! -f "$JOBS_INSTALL" ]]; then
    say_warn "schedule: the installer is missing at $JOBS_INSTALL — this checkout is incomplete"
    return 0
  fi

  run_installer
}

cmd_update() {
  case "${1:-}" in
    --auto) QUIET=1 ;;
    '') ;;
    *) printf 'workkit update: unknown option %s\n' "$1" >&2; return 1 ;;
  esac

  say_head "workkit update — $KIT_DIR"
  refresh_engine_link
  link_command
  update_cron

  # The published site is rebuilt from THIS checkout, so a human's update is
  # also how a shipped tower improvement reaches it. The automatic path leaves
  # it alone: an app build at session start is minutes of work nobody asked for,
  # and the daily job publishes anyway.
  if [[ "$QUIET" -eq 1 ]]; then
    say_skip "site: the daily job publishes it — \`workkit publish\` does it now"
  else
    cmd_publish
  fi
}

# The site publish, which is the engine's own script — named here so everything
# stays reachable from one command.
cmd_publish() {
  if [[ ! -f "$PUBLISH" ]]; then
    say_warn "site: publish.sh is missing at $PUBLISH — this checkout is incomplete"
    return 0
  fi
  bash "$PUBLISH" "$@" || say_warn "site: the publish did not finish — run \`bash $PUBLISH\` to see why"
  return 0
}

cmd_doctor() {
  local attention=0
  say_head "workkit doctor — $KIT_DIR"

  if command -v claude >/dev/null 2>&1; then
    if claude plugin list --json 2>/dev/null | grep -q "\"$PLUGIN_ID\""; then
      say_ok "plugin: $PLUGIN_ID is installed"
    else
      say_warn "plugin: $PLUGIN_ID is not installed — run \`workkit setup\`"
      attention=$((attention + 1))
    fi
  else
    say_skip "plugin: no claude CLI on this machine"
  fi

  check_gh

  if [[ -L "$ENGINE_LINK" && "$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)" == "$SCRIPT_DIR" ]]; then
    say_ok "engine: $ENGINE_LINK → $SCRIPT_DIR"
  else
    say_warn "engine: $ENGINE_LINK does not point at this checkout — run \`workkit update\`"
    attention=$((attention + 1))
  fi

  if [[ -L "$BIN_LINK" && "$(readlink "$BIN_LINK" || true)" == "$SCRIPT_DIR/workkit.sh" ]]; then
    say_ok "command: $BIN_LINK → $SCRIPT_DIR/workkit.sh"
    case ":${PATH:-}:" in
      *":$BIN_DIR:"*) ;;
      *) say_warn "command: $BIN_DIR is not on your PATH — add \`export PATH=\"\$HOME/.local/bin:\$PATH\"\` to your shell rc"
         attention=$((attention + 1)) ;;
    esac
  else
    say_warn "command: $BIN_LINK is missing or points elsewhere — run \`workkit update\`"
    attention=$((attention + 1))
  fi

  if [[ "$(uname -s)" != "Darwin" ]]; then
    say_skip "schedule: launchd is macOS"
  elif [[ ! -f "$DAILY_PLIST" ]]; then
    say_warn "schedule: the 9am job is not installed — run \`workkit setup\`"
    attention=$((attention + 1))
  else
    local drift
    if ! drift="$(cron_drift)"; then
      say_warn "schedule: $drift"
      attention=$((attention + 1))
    elif [[ -z "$drift" ]]; then
      say_ok "schedule: $DAILY_LABEL is installed and current"
    else
      printf '%s\n' "$drift" | while IFS= read -r line; do
        say_warn "schedule: $line — run \`workkit update\`"
      done
      attention=$((attention + 1))
    fi
  fi

  report_globals

  # The home repo: whether one is named, whether the folder is its clone, and
  # where that clone stands against its upstream.
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    say_warn "home: the home-repo library is missing beside $SCRIPT_DIR — this checkout is incomplete"
    attention=$((attention + 1))
  else
    local home_attention=0
    wk_home_doctor || home_attention=$?
    attention=$((attention + home_attention))
  fi

  local state
  state="$(bash "$STANDARDS" --state "$PWD" 2>/dev/null | tail -1 || printf 'nogit')"
  case "$state" in
    enabled) say_ok "repo: $PWD is in the workflow" ;;
    nogit)   say_skip "repo: $PWD is not a git repo" ;;
    *)       say_info "repo: $PWD is '$state' — \`workkit enable\` joins it" ;;
  esac

  if [[ "$attention" -gt 0 ]]; then
    say_head "$attention item(s) need attention — the command to fix each is above."
  else
    say_head "Everything this command can see is current."
  fi
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "${1:-help}" in
  help|-h|--help) usage ;;
  setup)   shift; cmd_setup "$@" ;;
  update)  shift; cmd_update "$@" ;;
  doctor)  shift; cmd_doctor "$@" ;;
  publish) shift; cmd_publish "$@" ;;
  enable)  shift; exec bash "$STANDARDS" --enable "${1:-$PWD}" ;;
  decline) shift; exec bash "$STANDARDS" --decline "${1:-$PWD}" ;;
  note)    shift; exec bash "$CAPTURE" note "$@" ;;
  *)
    printf 'workkit: unknown command %s\n\n' "$1" >&2
    usage >&2
    exit 1
    ;;
esac
