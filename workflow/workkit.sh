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
TOWER_START="$KIT_DIR/tower/start.sh"
# The morning, and the one function that hands it to the cloud — the same two
# files the 9am schedule runs, so `workkit brief` is that morning on demand
# rather than a second way of doing it.
MORNING="$KIT_DIR/jobs/morning.sh"
BRIEF_DISPATCH="$KIT_DIR/jobs/brief-dispatch.sh"

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
# (the standards hook) relays what it prints. The palette is lib.sh's — one home
# for the codes and for the question of whether to use them at all, and the
# answer is no anywhere but a terminal, because the hook puts this text into a
# session's context where escape codes are noise. A partial checkout with no
# lib.sh beside this script still speaks; it speaks plainly.
_G='' _Y='' _C='' _D='' _B='' _N=''
if declare -f wk_set_palette >/dev/null 2>&1; then wk_set_palette; fi

# --auto is the quiet variant: only ACTIONS and warnings speak, so a session
# start that found nothing to do says nothing at all.
QUIET=0

say_ok()   { printf "${_G}✓${_N} %s\n" "$1"; }
say_warn() { printf "${_Y}⚠${_N} %s\n" "$1"; }
say_skip() { [[ "$QUIET" -eq 1 ]] || printf "${_D}· %s${_N}\n" "$1"; }
say_info() { [[ "$QUIET" -eq 1 ]] || printf "${_C}ℹ${_N} %s\n" "$1"; }
say_head() { [[ "$QUIET" -eq 1 ]] || printf "\n${_B}%s${_N}\n" "$1"; }
# A run of steps under one title (issue #90). A full setup is ~25 lines, and
# flat they read as one undifferentiated list; the blank line and the title are
# what turn them into the handful of things setup actually does. The quiet
# variant prints none of it — a session-start injection is warnings only.
say_section() { [[ "$QUIET" -eq 1 ]] || printf "\n${_B}${_C}%s${_N}\n" "$1"; }

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
                       schedule, the home repo and whether it publishes its
                       dashboard, the cloud brief's secrets, the tower pointer,
                       this repo's opt-in, and the workkit symlink. Safe to
                       re-run
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
                       instead — composed and sent from this machine, the
                       brief never posted to the home repo
  tower                run the tower here — the JSON API and the dashboard
                       together, until one interrupt ends both
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
  say_info "tower: mission control is \`workkit tower\` — the API on 8693 and the dashboard on 4300 together, replacing any previous instance"
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

# The site switch, asked once (issue #84). Setup builds the whole publish path —
# the home repo, the clone, the tower project, its dependencies — and then left
# `site.publish` seeded false, so going live meant knowing to hand-edit a file
# nobody had been told about. Setup is the one command a human runs at a
# terminal, so it is the one place the question can be put.
#
# The switch has THREE states: `true` and `false` are answers and are never
# asked again, null (or no key at all) is a machine that has never been asked.
# Every reader still treats anything but `true` as off, so an unanswered machine
# publishes nothing while it waits.
#
# What the step LEAVES the switch reading, for the caller that acts on it:
# 'true' when publishing is on — freshly answered yes or already true — 'false'
# on a fresh no, and empty for every other ending, including every skip.
# `cmd_setup` publishes on 'true' and adds nothing at all otherwise (issue #85).
SITE_PUBLISH=''

offer_site_publish() {
  local current
  # Reset at entry: only THIS run's ending may publish, never a stale value.
  SITE_PUBLISH=''

  # The whole step reads and writes the machine's settings file through the
  # engine's library — the same reader, the same JSON edit, the same mutex every
  # other writer of that file takes. Without it there is no safe write to make,
  # and home_steps has already named the incomplete checkout.
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    say_skip "site: the publish question needs the home-repo library beside $SCRIPT_DIR"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    say_skip "site: reading the publish switch in $WK_HOME_SETTINGS needs jq"
    return 0
  fi
  if [[ ! -f "$WK_HOME_SETTINGS" ]]; then
    say_skip "site: $WK_HOME_SETTINGS does not exist yet — the first heal seeds it, and the next setup asks"
    return 0
  fi

  # Read RAW rather than through wk_json_get: jq's `//` treats false as absent,
  # and false is the one answer this step must be able to tell from silence.
  # "null" is what an absent key and a null both render as — the same state.
  current="$(jq -r '.site.publish | tostring' "$WK_HOME_SETTINGS" 2>/dev/null || printf '')"
  if [[ -z "$current" ]]; then
    say_warn "site: $WK_HOME_SETTINGS does not parse as JSON — the publish question was not asked; fix the file, then re-run \`workkit setup\`"
    return 0
  fi

  # No home repo, nothing to publish from: the question would be about a site
  # that has nowhere to go.
  if [[ -z "$(wk_home_slug)" ]]; then
    say_skip "site: no home repo yet — the publish question comes once there is one to publish from"
    return 0
  fi

  case "$current" in
    true)  SITE_PUBLISH=true; say_skip "site: publishing is on — edit \`site.publish\` in $WK_HOME_SETTINGS to change it"; return 0 ;;
    false) say_skip "site: publishing is off — edit \`site.publish\` in $WK_HOME_SETTINGS to change it"; return 0 ;;
  esac

  if ! interactive; then
    say_info "site: nobody has been asked whether to publish the dashboard — a terminal run of \`workkit setup\` puts the question; until then nothing is published"
    return 0
  fi

  local answer="" value=false
  printf 'Publish the dashboard site to GitHub Pages? [y/N] '
  read -r answer || true
  case "$answer" in
    y|Y|yes|YES) value=true ;;
    *) value=false ;;
  esac
  set_site_publish "$value"
  SITE_PUBLISH="$value"

  # The domain rides the FRESH yes and nothing else: it is the one moment the
  # answer is free — the site has never been built, so no address is in use yet
  # — and asking on every later run would nag a machine that already said yes.
  # An already-answered machine changes its domain by hand edit, as it does
  # today. Nothing to ask either when a domain is already recorded.
  if [[ "$value" == 'true' ]] && [[ "$(jq -r '.site.url | tostring' "$WK_HOME_SETTINGS" 2>/dev/null || printf 'null')" == 'null' ]]; then
    ask_site_url
  fi
}

# The custom domain, asked right after the fresh yes. Empty input is an answer
# too — it means the plain github.io address, so nothing is written, `site.url`
# stays null and publish.sh writes no CNAME. Whatever is typed is taken at its
# word: publish.sh already strips a scheme prefix on its way to the CNAME, and
# the shape of a domain is not this command's to judge.
ask_site_url() {
  local answer=""

  printf 'Custom domain for the site? [enter for none] '
  read -r answer || true
  [[ -n "$answer" ]] || return 0
  set_site_url "$answer"
}

# Record the answer. A whole-file read-modify-write on the file a heal in
# another session may be writing at the same moment, so it takes the engine's
# one state mutex exactly as wk_home_set_slug does.
set_site_publish() {
  local value="$1" rc=0

  write_site_option publish "$value" || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    say_warn "site: the answer could not be written to $WK_HOME_SETTINGS — set \`site.publish\` there by hand"
    return 0
  fi
  if [[ "$value" == 'true' ]]; then
    say_ok "site: publishing is on — \`workkit publish\` builds it now, and the daily job publishes after the morning brief (what Pages serves is public, even from a private repo)"
  else
    say_ok "site: publishing stays off — set \`site.publish\` to true in $WK_HOME_SETTINGS whenever you want the dashboard live"
  fi
  return 0
}

# The same write for the domain, in the same voice.
set_site_url() {
  local url="$1" rc=0

  write_site_option url "$(printf '%s' "$url" | jq -R .)" || rc=$?

  if [[ "$rc" -ne 0 ]]; then
    say_warn "site: the domain could not be written to $WK_HOME_SETTINGS — set \`site.url\` there by hand"
    return 0
  fi
  say_ok "site: the site answers at $url — the publish writes the CNAME, and the DNS record is yours to point at GitHub Pages"
  return 0
}

# The one guarded write of a site option: the whole-file read-modify-write both
# answers make, under the engine's one state mutex. `value` is JSON — a bare
# `true`, or a jq-encoded string.
write_site_option() {
  local key="$1" value="$2" locked=0 rc=0

  if wk_take_state_lock; then locked=1; fi
  wk_json_edit "$WK_HOME_SETTINGS" --arg k "$key" --argjson v "$value" '.site = ((.site // {}) + { ($k): $v })' || rc=$?
  if [[ "$locked" -eq 1 ]]; then wk_drop_state_lock; fi

  return "$rc"
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

# ── The cloud secrets (issues #88, #91) ───────────────────────────────────────
# The cloud brief runs on two repo secrets, and they live on the HOME repo —
# `<login>/workkit`, the repo setup made for this machine and seeded the
# workflow into. Not on this checkout's own repo: the plugin is distributed to
# everyone who installs the kit, and a consumer cannot set secrets on a repo
# they do not own (issue #91). The home slug is also what the daily job's
# dispatch gates on, so the two agree by construction.
#
# The one rule the whole block is built around: a token value goes from the
# command that produced it to `gh secret set` through a pipe, held in a single
# local on the way. It is never written to a file, echoed, or logged.
SECRET_CLAUDE='CLAUDE_CODE_OAUTH_TOKEN'
# Only names STARTING with `GITHUB_` are refused by GitHub; one that contains it
# is accepted, which is what lets this say plainly what it is.
SECRET_HOME='WORKKIT_GITHUB_TOKEN'

# The OAuth token lives about a year, so ~11 months is the point where a refresh
# is worth offering — early enough that a morning brief never meets the expiry.
SECRET_MAX_AGE_DAYS=330

# The listing below is the only network the daily path makes — the standards
# hook calls `update --auto` at session start — so it gets an upper
# bound: a captive portal answers the TCP handshake and never the request, and
# an unbounded `gh` there would hold a session open for as long as it liked.
# macOS ships no coreutils `timeout`, so one is used when the machine has it and
# a bash watchdog stands in when it does not. A bound that fires looks exactly
# like a listing that could not be read, which every caller already treats as a
# named skip. Only the READS are bounded: a write cut in half is worse than a
# write that waits, and every write is on a path a human is sitting in front of.
SECRETS_TIMEOUT="${WORKKIT_GH_TIMEOUT:-10}"
bounded_read() {
  local watchdog pid rc=0
  if command -v timeout >/dev/null 2>&1; then timeout "$SECRETS_TIMEOUT" "$@"; return $?; fi
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "$SECRETS_TIMEOUT" "$@"; return $?; fi
  "$@" &
  pid=$!
  # The subshell's own stdout goes to /dev/null on purpose: inside a command
  # substitution a background `sleep` holding the capture pipe open would
  # outlive the very call this is here to bound.
  ( sleep "$SECRETS_TIMEOUT"; kill -TERM "$pid" ) >/dev/null 2>&1 &
  watchdog=$!
  wait "$pid" || rc=$?
  kill -TERM "$watchdog" >/dev/null 2>&1 || true
  wait "$watchdog" 2>/dev/null || true
  return "$rc"
}

# `gh secret list --json name,updatedAt` for the repo, or nothing at all — an
# unauthenticated gh, a repo without Actions, no network. The caller tells the
# two apart by asking jq whether what came back is an array.
secrets_json() {
  bounded_read gh secret list --repo "$1" --json name,updatedAt 2>/dev/null || true
}

# Whether a listing came back at all.
is_listing() {
  printf '%s' "$1" | jq -e 'type == "array"' >/dev/null 2>&1
}

# How many whole days ago a secret was last set: a number, `unknown` for a
# timestamp jq could not read, and NOTHING when the repo has no such secret —
# absent is the state every caller acts on first.
secret_age_days() {
  printf '%s' "$1" | jq -r --arg n "$2" '
    map(select(.name == $n)) | .[0] // empty
    | (try (.updatedAt | sub("\\.[0-9]+"; "") | fromdateiso8601) catch null) as $t
    | if $t == null then "unknown" else (((now - $t) / 86400) | floor | tostring) end
  ' 2>/dev/null || true
}

# The token out of `claude setup-token`'s output. The mint prints its progress
# around the value, so the shape is what identifies it: an `sk-ant-` token if
# there is one, otherwise the last line that is nothing but a long opaque
# string. Colors are stripped first — a terminal mint arrives wrapped in them.
extract_token() {
  local text token
  text="$(printf '%s' "$1" | tr -d '\r' | sed $'s/\033\\[[0-9;]*m//g')"
  token="$(printf '%s\n' "$text" | grep -oE 'sk-ant-[A-Za-z0-9_-]+' | tail -1 || true)"
  if [[ -z "$token" ]]; then
    token="$(printf '%s\n' "$text" | grep -oE '^[[:space:]]*[A-Za-z0-9_-]{24,}[[:space:]]*$' | tail -1 || true)"
  fi
  printf '%s' "${token//[[:space:]]/}"
}

# Mint and push in one move. `claude setup-token`'s stdout is captured because
# the token is in it; its stderr stays on the terminal, which is where the
# browser approval talks to the human.
mint_claude_token() {
  local slug="$1" raw token rc=0

  say_info "secrets: running \`claude setup-token\` — approve it in the browser, and the token goes straight to $slug, where the cloud brief runs"
  # Only stdout is captured, because the token is in it. That the approval
  # itself renders on stderr — and so stays visible while stdout is held — is
  # OBSERVED behavior, not a contract the CLI documents: a version that moved
  # the prompt to stdout would look like a stall here. It is a recoverable one.
  # Ctrl-C ends the run, and every path out of this function prints the two
  # commands that do the same thing by hand.
  raw="$(claude setup-token)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    say_warn "secrets: \`claude setup-token\` did not finish (exit $rc) — run it by hand, then \`gh secret set $SECRET_CLAUDE --repo $slug\`"
    return 0
  fi

  token="$(extract_token "$raw")"
  if [[ -z "$token" ]]; then
    say_warn "secrets: \`claude setup-token\` printed no token this run — run it by hand, then \`gh secret set $SECRET_CLAUDE --repo $slug\`"
    return 0
  fi

  if ! printf '%s' "$token" | gh secret set "$SECRET_CLAUDE" --repo "$slug" >/dev/null 2>&1; then
    say_warn "secrets: $SECRET_CLAUDE could not be written to $slug — run \`gh secret set $SECRET_CLAUDE --repo $slug\` by hand"
    return 0
  fi
  say_ok "secrets: $SECRET_CLAUDE is set on $slug — the value went from the mint to the secret and nowhere else"
}

# The offer, put only to a terminal: the mint is a browser approval, so a piped
# or backgrounded run gets the two commands instead. Default no, like every
# other question this command asks.
offer_claude_token() {
  local slug="$1" reason="$2" answer=''

  if ! command -v claude >/dev/null 2>&1; then
    say_skip "secrets: $SECRET_CLAUDE $reason on $slug — minting it needs the claude CLI"
    return 0
  fi
  if ! interactive; then
    say_info "secrets: $SECRET_CLAUDE $reason on $slug — run these two at a terminal:
    claude setup-token
    gh secret set $SECRET_CLAUDE --repo $slug"
    return 0
  fi

  printf '%s %s on %s. Mint one now with `claude setup-token`? [y/N] ' "$SECRET_CLAUDE" "$reason" "$slug"
  read -r answer || true
  case "$answer" in
    y|Y|yes|YES) mint_claude_token "$slug" ;;
    *) say_skip "secrets: $SECRET_CLAUDE left as it is — \`workkit setup\` offers again" ;;
  esac
}

# The cross-repo token, zero-click (owner ruling 2026-07-30): the CLI's own
# login already reaches every swept board, and there is no API that mints a
# narrower one. It is the only credential that leaves the home repo — the
# Discussion is posted with the workflow's built-in GITHUB_TOKEN. The tradeoff
# — that login's full reach — and the least-privilege alternative are in
# jobs/README.md.
push_home_token() {
  local slug="$1" token='' rc=0

  token="$(gh auth token 2>/dev/null)" || rc=$?
  if [[ "$rc" -ne 0 || -z "$token" ]]; then
    say_warn "secrets: $SECRET_HOME is not set on $slug and \`gh auth token\` returned nothing — run \`gh auth login\`, then re-run \`workkit setup\`"
    return 0
  fi
  if ! printf '%s' "$token" | gh secret set "$SECRET_HOME" --repo "$slug" >/dev/null 2>&1; then
    say_warn "secrets: $SECRET_HOME could not be written to $slug — run \`gh auth token | gh secret set $SECRET_HOME --repo $slug\` by hand"
    return 0
  fi
  say_ok "secrets: $SECRET_HOME is set on $slug from this machine's gh login — the run on $slug reads every board with it, so it carries that login's reach (jobs/README.md names the narrower alternative)"
}

# Everything the block needs before it can say anything true: gh, jq, a home
# repo, and a listing that came back. Each failure is a named skip — none of them
# is drift, and a run that cannot read the repo must never report a missing secret.
# Sets SECRETS_SLUG and SECRETS_JSON for the caller.
SECRETS_SLUG=''
SECRETS_JSON=''
secrets_precheck() {
  SECRETS_SLUG=''
  SECRETS_JSON=''

  if ! command -v gh >/dev/null 2>&1; then
    say_skip "secrets: the cloud brief's secrets need gh"
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    say_skip "secrets: reading the cloud brief's secrets needs jq"
    return 1
  fi
  # Two different missing things, told apart: a checkout without the home-repo
  # library cannot resolve a slug at all, which is not the same as a machine
  # that asked and has no home repo yet.
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    say_skip "secrets: the home-repo library is missing beside $SCRIPT_DIR — this checkout cannot name the home repo the cloud brief's secrets live on"
    return 1
  fi
  SECRETS_SLUG="$(wk_home_slug 2>/dev/null || true)"
  if [[ -z "$SECRETS_SLUG" ]]; then
    say_skip "secrets: this machine names no home repo — the cloud brief runs there and posts the morning brief there, so its secrets live there too; setup's home step makes one"
    return 1
  fi

  SECRETS_JSON="$(secrets_json "$SECRETS_SLUG")"
  if ! is_listing "$SECRETS_JSON"; then
    say_skip "secrets: $SECRETS_SLUG's secrets could not be read — \`gh secret list --repo $SECRETS_SLUG\` says why"
    return 1
  fi
  return 0
}

# The setup step: act on what is missing or stale, and stay silent about what is
# set and fresh. Running it twice equals running it once.
secrets_step() {
  local age

  secrets_precheck || return 0

  age="$(secret_age_days "$SECRETS_JSON" "$SECRET_CLAUDE")"
  if [[ -z "$age" ]]; then
    offer_claude_token "$SECRETS_SLUG" "is not set"
  elif [[ "$age" != 'unknown' ]] && (( age > SECRET_MAX_AGE_DAYS )); then
    offer_claude_token "$SECRETS_SLUG" "was set $age days ago and the token lives about a year"
  else
    say_skip "secrets: $SECRET_CLAUDE is set on $SECRETS_SLUG"
  fi

  age="$(secret_age_days "$SECRETS_JSON" "$SECRET_HOME")"
  if [[ -z "$age" ]]; then
    push_home_token "$SECRETS_SLUG"
  else
    say_skip "secrets: $SECRET_HOME is set on $SECRETS_SLUG"
  fi
}

# The report, in two voices. `doctor` says one line per value and returns how
# many need attention; `update` — including the daily --auto run, which never
# prompts and never mints — says nothing but the warnings.
secrets_report() {
  local mode="$1" age attention=0 name

  secrets_precheck || return 0

  for name in "$SECRET_CLAUDE" "$SECRET_HOME"; do
    age="$(secret_age_days "$SECRETS_JSON" "$name")"
    if [[ -z "$age" ]]; then
      say_warn "secrets: $name is not set on $SECRETS_SLUG — run \`workkit setup\`"
      attention=$((attention + 1))
    elif [[ "$age" != 'unknown' ]] && (( age > SECRET_MAX_AGE_DAYS )); then
      say_warn "secrets: $name on $SECRETS_SLUG was set $age days ago — run \`workkit setup\` to refresh it"
      attention=$((attention + 1))
    elif [[ "$mode" == 'doctor' ]]; then
      if [[ "$age" == 'unknown' ]]; then
        say_ok "secrets: $name is set on $SECRETS_SLUG"
      else
        say_ok "secrets: $name is set on $SECRETS_SLUG ($age days ago)"
      fi
    fi
  done

  return "$attention"
}

# ── The commands ──────────────────────────────────────────────────────────────

cmd_setup() {
  say_head "workkit setup — $KIT_DIR"

  say_section "This machine"
  install_plugin
  check_gh
  refresh_engine_link
  link_command
  install_cron
  # The tower pointer is about this machine's dashboard, not the repo the shell
  # stands in — it lives here, not under "This repo".
  tower_pointer

  say_section "Home repo"
  home_steps

  say_section "Cloud brief secrets"
  # After the home steps, because the repo it writes to is the home repo they
  # settle.
  secrets_step

  say_section "Dashboard site"
  offer_site_publish
  # The switch ends on, so setup makes it real before it exits — the same call
  # the human path of `update` already makes, and idempotent the way the rest of
  # setup is: a re-run republishes (issue #85). Off, unanswered, or a step that
  # skipped adds no call and says nothing further; publish.sh's own gate stays
  # the single owner of the refusal.
  if [[ "$SITE_PUBLISH" == 'true' ]]; then cmd_publish; fi

  say_section "This repo"
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
  # Reported, never wired: the daily --auto run is the one path that must not
  # prompt or mint, so a missing value is a line and nothing else.
  secrets_report update || true

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

# Today's brief, asked for now (issue #54). The scheduled morning dispatches the
# cloud run and this is that same dispatch, through the same one function — the
# difference is who is listening. Nine o'clock logs a refusal and carries on;
# a human standing at a terminal is told, and the command fails.
#
# `--local` is the rehearsal the job already has: the full local morning, with
# the brief composed and sent from this machine and never posted to the home
# repo. The morning's other steps still run where they can — the summaries can
# post their Discussion and the site publish still fires when it is switched on.
cmd_brief() {
  if [[ "${1:-}" == '--local' ]]; then
    if [[ ! -f "$MORNING" ]]; then
      printf 'workkit: no morning job beside this engine (%s) — this command needs the workkit checkout\n' "$MORNING" >&2
      exit 1
    fi
    exec bash "$MORNING" --now
  fi
  if [[ $# -gt 0 ]]; then
    printf 'workkit: brief takes --local or nothing, not %s\n' "$1" >&2
    exit 1
  fi
  if [[ ! -f "$BRIEF_DISPATCH" ]]; then
    printf 'workkit: no brief dispatch beside this engine (%s) — this command needs the workkit checkout\n' "$BRIEF_DISPATCH" >&2
    exit 1
  fi
  # shellcheck source=../jobs/brief-dispatch.sh
  . "$BRIEF_DISPATCH"
  if ! dispatch_brief; then
    say_warn "brief: the day could not be handed to the cloud — $DISPATCH_REASON"
    exit 1
  fi
  say_ok "$DISPATCH_LINE"
  say_info "watch it: https://github.com/$DISPATCH_SLUG/actions/workflows/$BRIEF_WORKFLOW"
}

cmd_doctor() {
  local attention=0
  say_head "workkit doctor — $KIT_DIR"

  say_section "This machine"
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
  say_section "Home repo"
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    say_warn "home: the home-repo library is missing beside $SCRIPT_DIR — this checkout is incomplete"
    attention=$((attention + 1))
  else
    local home_attention=0
    wk_home_doctor || home_attention=$?
    attention=$((attention + home_attention))
    # The seeded cloud runner drifts on a `git pull` of this checkout, and only
    # `setup` writes it back — so doctor is the one place that can notice.
    local runner_attention=0
    wk_home_runner_doctor || runner_attention=$?
    attention=$((attention + runner_attention))
  fi

  say_section "Cloud brief secrets"
  local secrets_attention=0
  secrets_report doctor || secrets_attention=$?
  attention=$((attention + secrets_attention))

  say_section "This repo"
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
  brief)   shift; cmd_brief "$@" ;;
  tower)
    shift
    # The tower lives in the checkout, not the engine — a partial checkout
    # that copied only workflow/ has nothing to run.
    if [[ ! -f "$TOWER_START" ]]; then
      printf 'workkit: no tower beside this engine (%s) — this command needs the workkit checkout\n' "$TOWER_START" >&2
      exit 1
    fi
    exec bash "$TOWER_START"
    ;;
  enable)  shift; exec bash "$STANDARDS" --enable "${1:-$PWD}" ;;
  decline) shift; exec bash "$STANDARDS" --decline "${1:-$PWD}" ;;
  note)    shift; exec bash "$CAPTURE" note "$@" ;;
  *)
    printf 'workkit: unknown command %s\n\n' "$1" >&2
    usage >&2
    exit 1
    ;;
esac
