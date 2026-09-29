#!/usr/bin/env bash
# workflow standards: bring a repo to the issue-workflow standard, idempotently.
# The heals live in standards/; what each does: workflow/README.md, the
# standards.sh row, § The standard version and § The hook layer self-check.
# Usage: bash standards.sh [--state|--announce|--enable|--decline|--engine-link|--home] [repo_dir]
#   (no mode) heals an enabled repo; --state prints enabled | disabled |
#   declined | undecided | home | nogit; --home heals only the tower clone.
#   Every mode: README § Participation: the tri-state. repo_dir defaults to $PWD.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LABELS_JSON="$SCRIPT_DIR/labels.json"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
FORMS_DIR="$TEMPLATES_DIR/issue-forms"
CHANGELOG_LINTER="$SCRIPT_DIR/changelog/changelog.js"

# The CRLF-safe jq, named here as well as reached through lib.sh since this
# script reads JSON from its first step. Sourcing it twice is harmless.
# shellcheck source=./lib/platform.sh
. "$SCRIPT_DIR/lib/platform.sh"

# For the state mutex, wk_json_edit, and WK_HOME_DIR, the clone the heal never
# offers, heals or registers.
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"

# Its own file because safety/commit-gate sources it too, to prove a staged
# checks.yml is exactly the rewrite this heal writes.
# shellcheck source=./changelog/changelog-job.sh
. "$SCRIPT_DIR/changelog/changelog-job.sh"

# The heals, one file per concern, functions only: every value they read is
# this script's own.
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

# The hook layer beside this engine; the self-check skips silently without it.
# WORKFLOW_HOOKS_DIR is the tests' seam.
HOOKS_DIR="${WORKFLOW_HOOKS_DIR:-$SCRIPT_DIR/../hooks}"
# Each hook fails open without these, so this list makes a missing one visible.
# A `|` joins one tool's spellings across platforms; any one satisfies it.
HOOK_TOOLS="jq git node shasum|sha1sum perl"

# An agent's claim and how long it may sit idle before the heal releases it.
# Agents run gh as the owner, so the claim needs a label of its own.
CLAIM_LABEL="agent:working"
CLAIM_STALE_SECONDS=86400
# The two pipeline states a release moves between: an unclaimed issue whose spec
# is still accepted is specced, not building.
BUILDING_LABEL="status:building"
SPECCED_LABEL="status:specced"

# The state directory's name for the engine layer. hooks/_lib.sh and
# tests/lib/harness.js hold their own copy, and a test holds all three equal.
WORKKIT_DIR=".workkit"

# Bump it when a new heal or drift check lands (README § The standard version).
STANDARD_VERSION=8

# ── Logging ───────────────────────────────────────────────────────────────────
# Diagnostics go to stderr: stdout is the machine answer of --state and
# --announce. The heal prints no title, so it sets its own indent.
WK_LOG_STDERR=1
WK_LOG_INDENT='  '

mode="heal"
case "${1:-}" in
  --state|--announce|--enable|--decline|--engine-link|--home) mode="${1#--}"; shift ;;
  --*) wk_warn "standards: unknown option $1"; exit 1 ;;
esac

# The engine's public address, written by a real heal or `--engine-link` only
# (README § How it is reached). WORKFLOW_CLAUDE_HOME is the tests' seam, so no
# test touches a real ~/.claude.
CLAUDE_HOME="${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}"
ENGINE_LINK="$CLAUDE_HOME/workkit"

# The engine's address needs no repo, so it answers before one is resolved.
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

# The roster key, settled once from git's own answer: `cygpath` keeps the
# letter case it is handed, so a `$PWD` would mint a second key. Every write
# and lookup below reads this variable.
roster_key="$(wk_git_path "$root")"

# ── 0. Participation ──────────────────────────────────────────────────────────
# The states: README § Participation: the tri-state. The heal reads and writes
# `.repos.json`; the hand-edited user settings.json is only seeded when absent.
USER_SETTINGS="$WK_USER_DIR/settings.json"
USER_REPOS="$WK_USER_DIR/.repos.json"
REPO_SETTINGS="$WORKKIT_DIR/settings.json"

# The `home` state, the tower clone, known by path. Compared by physical path
# (cd + pwd -P, since realpath is not on every machine), so a symlinked home
# directory is still one folder. lib.sh owns the address.
HOME_CLONE_DIR="${WK_HOME_DIR:-$WK_USER_DIR/tower}"

seed_user_settings

# ── 1a. The two entries every .gitignore needs ──
# Only the missing ones are appended; a repo that covers them in any spelling
# is left as it is.
GITIGNORE_BASICS=".DS_Store .env"

# `gh label list`, kept from the sync for the steps below. Empty means the sync
# never reached GitHub.
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
  # The tower clone's own heal, forms and labels only, run by the engine since
  # no session opens in the clone. It refuses every other directory.
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

# Nothing is written into a repo that has not said yes. Only a deliberate no is
# silent, so an unanticipated state speaks up rather than skipping a repo.
case "$state" in
  enabled)    ;;
  home)       wk_skip "standards: $root is the tower clone; engine territory, nothing to heal"; exit 0 ;;
  undecided)  wk_info "$(offer_line)"; exit 0 ;;
  disabled|declined) exit 0 ;;
  unreadable) wk_warn "standards: $REPO_SETTINGS is not valid JSON; fix or remove it; healing nothing until then"; exit 0 ;;
  *)          wk_warn "standards: unrecognized participation state '$state'; healing nothing; this is a bug worth reporting"; exit 0 ;;
esac

wk_info "standards: $root"
# Written by a real heal only: the probes and an unconsented repo exit above.
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

# Below the current standard: report the drift, then stamp the version only if
# every mechanical heal succeeded. A drift report is not a failure.
repo_now="$(repo_version)"
if [[ "$repo_now" -lt "$STANDARD_VERSION" ]]; then
  # `|| true` suspends errexit for the call: report_drift returns 1 for "found
  # something", and its node pipeline aborts under pipefail without node.
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
  # The hook caches the day only on success, so an unfinished repo retries next
  # session; the hook keeps a non-zero exit from wedging it.
  exit 1
fi
exit 0
