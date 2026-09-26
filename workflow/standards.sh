#!/usr/bin/env bash
# workflow standards: bring a repo to the issue-workflow standard, idempotently.
#
# The heals, all safe to re-run:
#   1. labels:     create every group:value label from labels.json (SSOT) and
#                  correct description/color drift. Unknown labels are left alone.
#   2. gitignore:  make sure `.workkit/` stays untracked EXCEPT settings.json,
#                  the committed file carrying the repo's answer (enabled true/false).
#   2a. gitignore basics: make sure `.DS_Store` and `.env` are ignored, the
#                  two entries every repo needs and the ones a repo is most
#                  often missing. Only the missing ones are appended.
#   3. forms:      install .github/ISSUE_TEMPLATE/ markdown templates so a
#                  first-day teammate files correctly; each one auto-applies
#                  status:inbox + its type and pre-fills the issue anatomy
#                  (## Description then ## Spec), so every issue conforms from
#                  the moment it is filed.
#   4. checks:     install .github/workflows/checks.yml, the required-checks
#                  CI workflow that runs the test suite on every pull request.
#                  Installed once and never overwritten: after the first heal
#                  the copy is the repo's own to extend.
#   4a. changelog separator: convert an em dash CHANGELOG.md to spaced hyphens once
#   4b. changelog lint: remove a linter copy an earlier heal vendored to
#                  .github/changelog-lint.cjs, and put the `changelog` job in
#                  the repo's checks.yml once, calling the kit's reusable
#                  workflow (a job still running the copy is rewritten to it).
#                  The format gate then holds for a maintainer with no plugin
#                  installed, which is the only enforcement point CI has.
#   5. protection: best-effort: ask GitHub to require the test check on the
#                  default branch. Quietly skipped wherever the plan or the
#                  token cannot grant it; an existing protection is never
#                  touched.
#   6. claims:     release agent claims that went quiet: an open issue carrying
#                  agent:working with no activity for 24 hours loses the label
#                  and its assignee, goes back from status:building to
#                  status:specced, and gets a comment saying the sweep did it.
#                  The other direction follows it: an open status:specced issue
#                  with an assignee is a claim on an authorized spec (work in
#                  flight) so it moves to status:building with its own comment.
#   6a. roster:     record this repo's path under `repos` in the user settings,
#                  the machine-local index the tower reads instead of walking a
#                  filesystem root, and drop any listed path that is gone or has
#                  since said `enabled: false`. Silent; `workkit doctor` counts it.
#   7. hooks:      assert the hook layer beside this engine is alive: every hook
#                  wired in hooks.json resolves to a script that exists, is
#                  executable, and parses, and the tools they call are present.
#
# One user-level seed runs before any of that, on every invocation: the user's
# own settings file. The engine's public address (~/.claude/workkit → this
# folder) is written by a real heal, or by --engine-link on its own.
#
# Usage: bash standards.sh [--state|--announce|--enable|--decline|--engine-link|--home] [repo_dir]
#        (repo_dir defaults to the current directory)
#
#   (no mode)     heal the repo, but only if it is enabled (see participation)
#   --state       print enabled | disabled | declined | undecided | home | nogit
#                 (home is the tower clone: engine territory, never healed)
#   --announce    print the one-line offer shown to an undecided repo
#   --enable      write the committed opt-in (enabled: true), then heal
#   --decline     record "never ask about this repo again" in the USER settings
#   --engine-link maintain the engine's address and nothing else (no repo needed)
#   --home        heal the TOWER CLONE, and only it: the two heals a repo the
#                 board files into needs (issue forms + labels) and none of the
#                 session-state scaffolding. Refuses any other directory. The
#                 engine calls it: no session ever opens in the clone
#
# The label step and the protection ask need jq/gh + auth + a remote. Without
# them each says so quietly and moves on: an offline machine has nothing
# broken, just nothing to sync. The gitignore, session-file, forms, and checks
# heals are pure bash and always run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LABELS_JSON="$SCRIPT_DIR/labels.json"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
FORMS_DIR="$TEMPLATES_DIR/issue-forms"
CHANGELOG_LINTER="$SCRIPT_DIR/changelog.js"

# The CRLF-safe jq every read below goes through, and the one home of that
# rule. Named here as well as reached through lib.sh, because this script reads
# JSON from its first step and the seam it reads through belongs in the list of
# what it depends on; the file defines functions and sets nothing, so sourcing
# it twice is sourcing it once. Sourcing runs nothing.
# shellcheck source=./platform.sh
. "$SCRIPT_DIR/platform.sh"

# The engine's shared helpers, for three things the heal borrows: the settings
# mutex every writer of the user file takes, the safe JSON edit every settings
# write goes through (wk_json_edit), and the tower clone's address
# (WK_HOME_DIR), which the participation step compares against so the clone is
# never offered, healed or registered. The heal owes the global layer nothing
# else: the roster is machine-local, and the heal writes nothing into the clone
# at all: it carries no opt-in and is engine territory. Sourced flat, the way
# every other part of the engine sources it: a checkout missing it is missing
# the seam above too, so there is no deployment where the branch had an answer.
# Sourcing runs nothing.
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

# The changelog job in a repo's checks.yml, read and rewritten, the checks
# template's address, and the retired linter copies: its own file because the
# safety/commit-gate hook sources it too, to prove a staged checks.yml is
# exactly the rewrite this heal writes. Sourcing runs nothing.
# shellcheck source=./changelog-job.sh
. "$SCRIPT_DIR/changelog-job.sh"

# The heals themselves, one file per concern under standards/. Each defines
# functions and sets nothing, so every constant and every run-time value a
# piece reads is still this script's own, defined here before the flow below
# calls into it. Sourcing runs nothing.
# shellcheck source=./standards/engine-link.sh
. "$SCRIPT_DIR/standards/engine-link.sh"
# shellcheck source=./standards/state.sh
. "$SCRIPT_DIR/standards/state.sh"
# shellcheck source=./standards/gitignore.sh
. "$SCRIPT_DIR/standards/gitignore.sh"
# shellcheck source=./standards/templates.sh
. "$SCRIPT_DIR/standards/templates.sh"
# shellcheck source=./standards/changelog.sh
. "$SCRIPT_DIR/standards/changelog.sh"
# shellcheck source=./standards/labels.sh
. "$SCRIPT_DIR/standards/labels.sh"
# shellcheck source=./standards/claims.sh
. "$SCRIPT_DIR/standards/claims.sh"
# shellcheck source=./standards/hooks.sh
. "$SCRIPT_DIR/standards/hooks.sh"

# The hook layer that ships beside this engine. The engine runs fine without it
# (it is installed alone wherever someone scripts the standard directly), so the
# self-check below skips silently when there is no hooks.json here.
# WORKFLOW_HOOKS_DIR overrides the location (the tests point at a fixture).
HOOKS_DIR="${WORKFLOW_HOOKS_DIR:-$SCRIPT_DIR/../hooks}"
# The tools the hooks call for their core work. Each hook fails OPEN without
# them by design, so a missing one disables a safety layer in silence. This
# list is what makes that visible once a day. A `|` joins the spellings one
# tool has across platforms (hook_sha1 takes shasum or sha1sum, #245): any one
# of them satisfies the entry.
HOOK_TOOLS="jq git node shasum|sha1sum perl"

# The label an agent applies when it claims an issue, and how long a claim may
# sit without activity before the heal releases it (assignee accounts cannot tell an agent from a human, because agents run gh as
# the owner, so the claim needs a marker of its own).
CLAIM_LABEL="agent:working"
CLAIM_STALE_SECONDS=86400
# The two pipeline states a release moves between: an unclaimed issue whose spec
# is still accepted is specced, not building.
BUILDING_LABEL="status:building"
SPECCED_LABEL="status:specced"

# The workflow state directory's name, for the ENGINE layer: one string so a
# rename is one edit here. The hooks (hooks/_lib.sh) and the
# test harness (tests/lib/harness.js) hold their own copy for the same reason;
# a test asserts all three still say the same thing.
WORKKIT_DIR=".workkit"

# The standard this script brings a repo to. A repo's committed settings.json
# records the version it was last healed to, so "does this repo need attention?"
# is one integer compare instead of a scan. Bump it when a new heal or a new
# drift check lands; a repo already at the current version does exactly what it
# did before.
STANDARD_VERSION=8

# ── Logging ───────────────────────────────────────────────────────────────────
# The voice is lib.sh's (issue #237). Diagnostics go to STDERR, always, which is
# what WK_LOG_STDERR buys: stdout is reserved for machine-readable answers
# (--state, --announce), and a caller capturing `$(standards.sh --state)` was
# getting any warning printed before the dispatch folded into the state string,
# which then matched no case and silently did nothing (review finding,
# 2026-07-24). The heal prints no title of its own, since it is relayed into a
# session far more often than it is read at a terminal, so it sets the indent
# its lines have always carried itself.
#
# Every level is lib.sh's own: it is sourced flat above, so there is no run of
# this script where a level is missing and nothing here restates one.
WK_LOG_STDERR=1
WK_LOG_INDENT='  '

mode="heal"
case "${1:-}" in
  --state|--announce|--enable|--decline|--engine-link|--home) mode="${1#--}"; shift ;;
  --*) wk_warn "standards: unknown option $1"; exit 1 ;;
esac

# The engine's public address, for anything that scripts the standard directly:
# ~/.claude/workkit points at this folder. The heal owns it, so a plugin update
# or a fresh machine gets the address from the first session that runs: no
# install step, no module in someone's dotfiles. Two things may write it: a real
# heal, and `--engine-link`, the address step on its own (what `workkit
# setup|update` asks for, so the machine-side install owns no second copy of it).
# A probe answers a question and writes nothing.
#
# The engine stays agent-agnostic: it CREATES nothing under ~/.claude and skips
# quietly on a machine that has no such directory. The address is a convenience
# for the machines that do.
# WORKFLOW_CLAUDE_HOME overrides the parent (the tests point it at a temp dir:
# this step must never touch a real ~/.claude).
CLAUDE_HOME="${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}"
ENGINE_LINK="$CLAUDE_HOME/workkit"

# The address step alone: it is the ENGINE's address, so it needs no repo and
# answers before the repo is even resolved.
if [[ "$mode" == "engine-link" ]]; then
  ensure_engine_link
  exit 0
fi

repo_dir="${1:-$PWD}"

if ! root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null)"; then
  if [[ "$mode" == "state" ]]; then
    printf 'nogit\n'
  else
    wk_skip "standards: $repo_dir is not a git repo; nothing to standardize"
  fi
  exit 0
fi

cd "$root"

# The key this repo wears on the machine roster, settled ONCE here. Windows
# spells one directory two ways and the roster must not: `wk_git_path` is the
# one home of that rule (workflow/platform.sh), and every write and every
# lookup below reads this variable rather than asking again. Feed it git's own
# answer, as `root` is: `cygpath` keeps the letter case it is handed while git
# canonicalizes it, so a `$PWD` or a hand-typed path would mint a second key.
# The call is the identity on git's answer; it is here so the rule is stated at
# the one site the key is made, not left to a caller happening to hand over git's.
roster_key="$(wk_git_path "$root")"

# ── 0. Participation ──────────────────────────────────────────────────────────
# Four states, two files. The REPO's committed .workkit/settings.json is the
# only place a yes or a deliberate no can live: it is a project fact a teammate
# reads. Never-asked and declined are PERSONAL: a
# teammate seeing `enabled: false` would read it as the project declining when
# it was one developer undecided, so those live in the user's own settings file
# instead.
#
#   enabled:    committed settings.json, `enabled: true` or the key absent
#               (legacy `{ "version": 1 }` opted in by existing at all)
#   disabled:   committed settings.json with `enabled: false`
#   declined:   no committed file; this user recorded a decline for this repo
#   undecided:  no committed file, no record: offer once, write nothing
#   home:       this IS the tower clone (below): engine territory, never
#               offered, never healed, never registered
#
# The user's own answers are split by who writes them (issue #80): the roster
# and the declines are the MACHINE's and live in `.repos.json`, while
# `settings.json` beside it is hand-edited and holds only the site options. The
# heal reads and writes the first and never touches the second.
USER_SETTINGS="${WORKFLOW_HOME:-${HOME:-}/$WORKKIT_DIR}/settings.json"
USER_REPOS="${WORKFLOW_HOME:-${HOME:-}/$WORKKIT_DIR}/.repos.json"
REPO_SETTINGS="$WORKKIT_DIR/settings.json"

# The fifth state, and the one no repo can write: `home`, the tower clone. It is
# a git repo like any other to look at, but it is ENGINE TERRITORY: it carries
# no committed opt-in, the engine knows it BY PATH, and the heal writes nothing
# into it, offers it nothing, and never puts it on the roster.
# Compared by PHYSICAL path on both sides (cd + pwd -P, never realpath, which is
# not on every machine): a symlinked home directory would otherwise make the
# same folder look like two. lib.sh owns the address; the fallback keeps this
# working in a checkout without it, where sourcing was skipped above.
HOME_CLONE_DIR="${WK_HOME_DIR:-${WORKFLOW_HOME:-${HOME:-}/$WORKKIT_DIR}/tower}"

seed_user_settings

# ── 1a. The two entries every .gitignore needs ──
# `.DS_Store` (a Finder file committed by accident on every mac) and `.env`
# (where secrets live, and the reason the vendor guard lets them be edited at
# all). Only the missing ones are appended, so a repo that already covers them
# (in any spelling) is left exactly as it is.
GITIGNORE_BASICS=".DS_Store .env"

# GitHub's answer to `gh label list`, kept from the sync so the steps below need
# no second round trip. Empty means the sync never reached GitHub, and they have
# nothing to decide on.
existing_labels=""

hooks_checked=0

# Set by any heal that could not finish on its own: the run stays exit 0 (a
# session start must never wedge) but says plainly that a human is needed.
needs_attention=0
# Set by report_drift when a check could not run for lack of a tool: the
# version is not stamped past a check that never happened.
drift_skipped=0

state="$(resolve_state)"

case "$mode" in
  state)    printf '%s\n' "$state"; exit 0 ;;
  announce) offer_line; printf '\n'; exit 0 ;;
  # The tower clone's own heal (issue #123). The clone is engine territory and
  # no session ever starts in it, so the two heals that make a repo FILEABLE
  # INTO (the labels every queue reads and the forms that apply them) are run
  # from the engine instead: `wk_home_heal` at setup and every morning. Same
  # code as every other repo gets, which is the whole point; the difference is
  # only which steps and who triggers them. The participation gate is not
  # bypassed but INVERTED: this mode heals the clone and refuses anything
  # else, so it can never write into a repo that has not said yes.
  home)     if [[ "$state" != "home" ]]; then
              wk_warn "standards: $root is not the tower clone; --home heals the home repo and nothing else"
              exit 1
            fi
            wk_info "standards: $root (the home clone)"
            ensure_issue_forms
            sync_labels
            [[ "$needs_attention" -eq 0 ]] || exit 1
            exit 0 ;;
  decline)  if [[ "$state" == "home" ]]; then
              wk_warn "standards: $root is the tower clone; engine territory, and it never participates (nothing recorded)"
              exit 1
            fi
            record_decline; exit 0 ;;
  enable)   if [[ "$state" == "home" ]]; then
              wk_warn "standards: $root is the tower clone; engine territory, and it never participates"
              exit 1
            fi
            write_repo_optin; state="enabled" ;;
esac

# Nothing is ever written into a repo that has not said yes: not a stub
# settings.json, not a .gitignore line, not a template. Every state is named:
# only a deliberate no is silent, so a state nobody anticipated speaks up rather
# than skipping a repo forever (review finding, 2026-07-24).
case "$state" in
  enabled)    ;;
  home)       wk_skip "standards: $root is the tower clone; engine territory, nothing to heal"; exit 0 ;;
  undecided)  wk_info "$(offer_line)"; exit 0 ;;
  disabled|declined) exit 0 ;;
  unreadable) wk_warn "standards: $REPO_SETTINGS is not valid JSON; fix or remove it; healing nothing until then"; exit 0 ;;
  *)          wk_warn "standards: unrecognized participation state '$state'; healing nothing; this is a bug worth reporting"; exit 0 ;;
esac

wk_info "standards: $root"
# The address is written by a real heal only: a --state or --announce probe
# answers a question and writes nothing, and a repo that has not said yes is
# offered and left alone. Both exit above this line.
ensure_engine_link
register_in_roster
ensure_workflow_ignored
ensure_gitignore_basics
ensure_local_file capture.md
ensure_local_file session.md agents/session.md
ensure_issue_forms
ensure_ci_workflow
ensure_changelog_separator
ensure_changelog_job
remove_changelog_linter_copies
ensure_branch_protection
sync_labels
sweep_stale_claims
flip_claimed_specced
check_issue_labels
check_hook_layer

# A repo already at the current standard has nothing to look for, the whole
# point of recording the version. Below it, say what is left over, then stamp
# the version forward ONLY if the mechanical heals all succeeded, so a repo that
# half-healed is asked again next time. A drift REPORT is not a failure: those
# findings need a human, and blocking on them would nag every session forever.
repo_now="$(repo_version)"
if [[ "$repo_now" -lt "$STANDARD_VERSION" ]]; then
  # `|| true` is load-bearing, not decoration: it suspends errexit for the whole
  # call, and report_drift both returns 1 (meaning "found something", not a
  # failure) and runs a node pipeline that would abort the script under
  # `set -o pipefail` on a machine without node.
  report_drift || true
  if [[ "$needs_attention" -eq 0 ]]; then
    if [[ "$drift_skipped" -eq 1 ]]; then
      wk_skip "standards: version not stamped; the CHANGELOG drift check needs node, which is not available"
    elif ! command -v jq >/dev/null 2>&1; then
      wk_skip "standards: version not stamped; writing it needs jq, so the drift report repeats until it is installed"
    elif wk_json_edit "$REPO_SETTINGS" --argjson v "$STANDARD_VERSION" '.version = $v'; then
      wk_ok "standard version $repo_now → $STANDARD_VERSION"
    fi
  fi
fi

if [[ "$needs_attention" -eq 1 ]]; then
  wk_warn "standards: $root is not fully standardized; see the warning above"
  # Exit non-zero so a caller can tell a partial heal from a clean one: the hook
  # caches the day only on success, so an unfinished repo retries next session
  # instead of going quiet until tomorrow. A non-zero exit never wedges a
  # session: the hook handles it (review finding, 2026-07-24).
  exit 1
fi
exit 0
