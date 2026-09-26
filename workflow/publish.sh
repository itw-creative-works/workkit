#!/usr/bin/env bash
# workflow/publish.sh: build the tower project and publish it to gh-pages.
#
# The tower is two processes on this machine. The PUBLISHED tower is the same
# app built to static files and served by GitHub Pages from the home repo: the
# board readable from a phone, and NOTHING about it is baked in: the site reads
# GitHub live from the browser with the viewer's own token (issue #81). The one
# artifact this script writes beside the pages is `data/home.json`, the home
# repo's slug and the branch the roster is on, nothing else (issues #110, #112). The ROSTER (which repos the board
# sweeps) is written to the home repo's default branch instead, where the repo's
# own privacy covers it, and every reader fetches it with a token it already
# holds. Pages is public even from a private repo, so a list naming private
# repositories was the one thing beside the pages that could not stay there.
#
# WHAT IS BUILT is the clone itself, never this checkout: `~/.workkit/tower` is
# the tower project, seeded from `tower/app` at setup and carrying its own
# dependencies (issue #77). A shipped tower improvement reaches it the way any
# project takes an upstream change, not by being rebuilt from somewhere else.
# The site options it is built WITH are the user's, so they live in the machine
# settings file at `~/.workkit/settings.json` and never inside the clone, which
# is engine territory and is never hand-edited (issue #79).
#
# WHY THE BUILD IS LOCAL, and never a GitHub Action (issue #27 Spec, deviation
# 1): the app consumes `@omega.js/*` by `file:` spec from a sibling omega
# checkout, which no CI runner has. Probed 2026-07-28: on a machine without that
# checkout `npm install` still EXITS 0 and leaves dangling symlinks under
# node_modules/@omega.js, and only the build then fails with `omega: command not
# found`. So the tooling check below is the presence of the `omega` binary, not
# the exit status of an install: an install's success proves nothing.
#
# WHERE THE BUILD RUNS, probed against the real tower/app 2026-07-29: `build` is
# a command of @omega.js/web and resolves only INSIDE the target: at the brand
# root the `omega` bin dispatches to @omega.js/manager, which has no build at
# all. So the build is `npm --prefix <clone>/targets/web run build`, and it
# writes `targets/web/dist/`.
#
# WHERE IT LANDS: the `gh-pages` branch, at its ROOT. Nothing built is ever
# committed on main, and no folder on main is named for a Pages rule. The branch
# is generated output and is published with a worktree: main's working tree is
# never touched, and the only forcing that ever happens is a lease onto that one
# branch.
#
# WHAT THE SWITCH GOVERNS. `site.publish` decides the SITE, and since issue #113
# it decides whether that site EXISTS rather than only whether it is updated: a
# run that finds the switch off and a `gh-pages` branch still on the home repo
# takes the site down: the branch is generated content and the next yes rebuilds
# it from scratch. Two things are outside the switch. The roster is one (issue
# #111): `data/repos.json` on the home repo's default branch is read by the CLOUD
# BRIEF as well as by the published dashboard, so it is refreshed and pushed
# ABOVE the gate and before any build tooling is asked for: it needs node, git
# and the clone, and nothing that publishing needs. Whatever else the day changed
# in the project rides with it, in the same commit.
#
# Every reason not to publish is a NAMED SKIP with exit 0: no home repo, no
# build tooling, a clone that could not catch up with its upstream, an
# autostash that conflicted on the way back, a settings file that does not parse,
# nothing changed. Only a build or a copy that
# actually failed exits non-zero, which is what the daily job logs.
#
# Usage: publish.sh [--quiet]
# Called by: `workkit publish`, `workkit update` (a human's run), and
#            jobs/morning.sh after the brief has been sent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=./home.sh
. "$SCRIPT_DIR/home.sh"

# The steps themselves, one file per side of the run under publish/, in the
# order the flow below calls them. Each defines functions and nothing else, and
# no function declares a local: every value a step sets is this script's own
# global, so a later step reads exactly what the step before it left, and an
# `exit` inside a step still ends the run. Sourcing runs nothing.
# shellcheck source=./publish/source.sh
. "$SCRIPT_DIR/publish/source.sh"
# shellcheck source=./publish/build.sh
. "$SCRIPT_DIR/publish/build.sh"
# shellcheck source=./publish/pages.sh
. "$SCRIPT_DIR/publish/pages.sh"

OMEGA_BIN="$WK_HOME_DIR/node_modules/.bin/omega"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

# The voice is lib.sh's, sourced above: one home for the glyphs, the colors and
# the question of whether a run gets any (issues #90, #237). This script prints
# no title of its own and its lines sit flush left, the same shape a human run
# and the 9am job's run both get.

# Whether the home remote already carries the published branch: `present`,
# `absent` or `unreachable`, and the three are told apart on purpose.
# `--exit-code` answers 2 for a remote that replied with no such branch and 128
# for one that could not be reached at all, and reading the second as the first
# is what made an offline run drop its local ref and then fail at the push
# (issue #111). It is also what keeps an offline run from tearing a site down it
# cannot see.
pages_remote_state() {
  local rc=0
  wk_spin "asking origin about $WK_HOME_PAGES_BRANCH" git -C "$WK_HOME_DIR" ls-remote --exit-code --heads origin "$WK_HOME_PAGES_BRANCH" >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) printf 'present' ;;
    2) printf 'absent' ;;
    *) printf 'unreachable' ;;
  esac
}

# Take the published site down (issue #113). Called only when the switch is off
# AND the remote still carries the branch, so a machine that never published
# says nothing at all. The branch goes first, because that is what Pages serves:
# once it is gone the site is already dark, and the Pages configuration is the
# tidy-up. A local copy of the branch is dropped with it: it is generated
# content, and leaving it behind is what makes the next orphan checkout refuse.
site_teardown() {
  local slug out rc=0
  slug="$(wk_home_slug)"
  if ! wk_spin "deleting $WK_HOME_PAGES_BRANCH on origin" git -C "$WK_HOME_DIR" push -q origin --delete "$WK_HOME_PAGES_BRANCH" 2>/dev/null; then
    wk_warn "publish: could not delete $WK_HOME_PAGES_BRANCH on $slug; the site it serves is still up; \`git -C $WK_HOME_DIR push origin --delete $WK_HOME_PAGES_BRANCH\` reports why"
    return 0
  fi
  wk_ok "publish: the site is taken down; $slug's $WK_HOME_PAGES_BRANCH branch is deleted"
  git -C "$WK_HOME_DIR" branch -qD "$WK_HOME_PAGES_BRANCH" >/dev/null 2>&1 || true

  if ! command -v gh >/dev/null 2>&1; then
    wk_skip "publish: gh is not on this machine; Pages is still configured on $slug with nothing to serve; turn it off at https://github.com/$slug/settings/pages"
    return 0
  fi
  out="$(wk_spin "taking the Pages site on $slug down" gh api -X DELETE "repos/$slug/pages" 2>&1)" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    wk_ok "publish: Pages is disabled on $slug"
  elif [[ "$out" == *404* ]]; then
    wk_skip "publish: Pages was not configured on $slug; there was nothing to disable"
  else
    wk_warn "publish: could not disable Pages on $slug; the branch is gone, so it serves nothing, but the configuration is still there; turn it off at https://github.com/$slug/settings/pages"
  fi
}

# The published branch's EXIT trap, set by publish_branch once the worktree
# path exists: the worktree and the build log go, however the run ends.
cleanup_worktree() {
  git -C "$WK_HOME_DIR" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE"
  rm -f "$BUILD_LOG"
}

# ── The three things a publish needs ──────────────────────────────────────────

# The site options decide what is published, so a settings file that does not
# parse is not a default: it is an answer nobody can read. Reading on would
# turn every switch silently off and drop the CNAME, which is the loudest
# way to publish the wrong thing quietly. It is asked FIRST because the same
# file names the home repo, so every check below would otherwise report an
# unreadable file as a machine with no home at all.
if [[ -f "$WK_HOME_SETTINGS" ]] && command -v jq >/dev/null 2>&1 \
  && ! wk_jq . "$WK_HOME_SETTINGS" >/dev/null 2>&1; then
  wk_warn "publish: $WK_HOME_SETTINGS does not parse as JSON; the site options (\`site.publish\`, \`site.url\`) cannot be read, so nothing was published; fix the file and run it again"
  exit 0
fi

# Without jq the switch cannot be READ, and an unreadable switch is not an off
# one: the gate below reads empty on a machine with no jq, so it would tell an
# owner who already said yes to go and turn on what is already on.
if ! command -v jq >/dev/null 2>&1; then
  wk_skip "publish: jq is missing; cannot read the publish switch (\`site.publish\`), so nothing is built or pushed; install jq and run it again"
  exit 0
fi

# `site.publish` is the whole decision about the site, and it is DEFAULT OFF:
# an absent key reads as off, and only `true` publishes (issue #80). It is all or
# nothing: a machine that has not said yes builds nothing and pushes nothing,
# whoever asked for the run, because what Pages serves is public and saying so
# once is the owner's to do. The engine takes that yes at its word and checks
# nothing else: not the account's plan, not the repo's visibility. It is READ here and ACTED ON below the roster: the answer decides
# the site, and the roster is not part of the site.
PUBLISH_SITE="$(wk_json_get "$WK_HOME_SETTINGS" '.site.publish')"

if ! wk_home_ready; then
  case "$(wk_home_state)" in
    unset)  wk_skip "publish: no home repo; \`workkit setup\` creates one, and the site publishes from it" ;;
    absent) wk_skip "publish: nothing is cloned at $WK_HOME_DIR yet; \`workkit setup\` clones and seeds the tower project" ;;
    other)  wk_warn "publish: $WK_HOME_DIR is not the home repo's clone; nothing is published out of somebody else's folder" ;;
  esac
  exit 0
fi

# ── The steps ─────────────────────────────────────────────────────────────────
# One function per step, sourced from publish/ above, in the order they run.
# Any step can end the run: every reason not to publish is an `exit` inside the
# step that found it, so a call below that returns means its step went through.
publish_catch_up
publish_home_heal
publish_sync
publish_roster
publish_source_side
publish_switch
publish_dependencies
publish_mint
publish_build
publish_branch
publish_mirror
publish_home_pointer
publish_custom_url
publish_push

exit "$SOURCE_RC"
