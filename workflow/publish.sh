#!/usr/bin/env bash
# workflow/publish.sh — build the tower project and publish it to gh-pages.
#
# The tower is two processes on this machine. The PUBLISHED tower is the same
# app built to static files and served by GitHub Pages from the home repo — a
# copy of the board readable from a phone, optionally with the sweep it shipped
# with baked in (workflow/site-data.js, behind `site.board`).
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
# the exit status of an install — an install's success proves nothing.
#
# WHERE THE BUILD RUNS, probed against the real tower/app 2026-07-29: `build` is
# a command of @omega.js/web and resolves only INSIDE the app — at the brand
# root the `omega` bin dispatches to @omega.js/manager, which has no build at
# all. So the build is `npm --prefix <clone>/apps/web run build`, and it writes
# `apps/web/dist/`.
#
# WHERE IT LANDS: the `gh-pages` branch, at its ROOT. Nothing built is ever
# committed on main, and no folder on main is named for a Pages rule. The branch
# is generated output and is published with a worktree — main's working tree is
# never touched, and the only forcing that ever happens is a lease onto that one
# branch.
#
# Every reason not to publish is a NAMED SKIP with exit 0 — no home repo, no
# build tooling, a clone that could not catch up with its upstream, an
# autostash that conflicted on the way back, a settings file that does not parse,
# nothing changed. Only a build or a copy that
# actually failed exits non-zero, which is what the daily job logs.
#
# Usage: publish.sh [--quiet]
# Called by: `workkit publish`, `workkit update` (a human's run), and
#            jobs/claude-daily.sh after the brief has been sent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=./home.sh
. "$SCRIPT_DIR/home.sh"

OMEGA_BIN="$WK_HOME_DIR/node_modules/.bin/omega"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

_G='\033[0;32m' _Y='\033[0;33m' _C='\033[0;36m' _D='\033[0;90m' _N='\033[0m'
if [[ ! -t 1 ]]; then _G='' _Y='' _C='' _D='' _N=''; fi
say_ok()   { printf "${_G}✓${_N} %s\n" "$1"; }
say_warn() { printf "${_Y}⚠${_N} %s\n" "$1"; }
say_info() { [[ "$QUIET" -eq 1 ]] || printf "${_C}ℹ${_N} %s\n" "$1"; }
say_skip() { [[ "$QUIET" -eq 1 ]] || printf "${_D}· %s${_N}\n" "$1"; }

# ── The three things a publish needs ──────────────────────────────────────────

# The site options decide what is published, so a settings file that does not
# parse is not a default — it is an answer nobody can read. Reading on would
# turn every switch silently off and drop the CNAME, which is the loudest
# way to publish the wrong thing quietly. It is asked FIRST because the same
# file names the home repo, so every check below would otherwise report an
# unreadable file as a machine with no home at all.
if [[ -f "$WK_HOME_SETTINGS" ]] && command -v jq >/dev/null 2>&1 \
  && ! jq . "$WK_HOME_SETTINGS" >/dev/null 2>&1; then
  say_warn "publish: $WK_HOME_SETTINGS does not parse as JSON — the site options (\`site.publish\`, \`site.board\`, \`site.url\`) cannot be read, so nothing was published; fix the file and run it again"
  exit 0
fi

# Without jq the switch cannot be READ, and an unreadable switch is not an off
# one: the gate below reads empty on a machine with no jq, so it would tell an
# owner who already said yes to go and turn on what is already on.
if ! command -v jq >/dev/null 2>&1; then
  say_skip "publish: jq is missing — cannot read the publish switch (\`site.publish\`), so nothing is built or pushed; install jq and run it again"
  exit 0
fi

# `site.publish` is the whole decision, and it is DEFAULT OFF — an absent key
# reads as off, and only `true` publishes (issue #80). It is all or nothing: a
# machine that has not said yes builds nothing and pushes nothing, whoever asked
# for the run, because what Pages serves is public and saying so once is the
# owner's to do. The engine takes that yes at its word and checks nothing else —
# not the account's plan, not the repo's visibility (owner ruling, 2026-07-29).
if [[ "$(wk_json_get "$WK_HOME_SETTINGS" '.site.publish')" != 'true' ]]; then
  say_skip "publish: \`site.publish\` is off in $WK_HOME_SETTINGS — nothing is built or pushed; set it to true to publish the site (what Pages serves is public, even from a private repo)"
  exit 0
fi

if ! wk_home_ready; then
  case "$(wk_home_state)" in
    unset)  say_skip "publish: no home repo — \`workkit setup\` creates one, and the site publishes from it" ;;
    absent) say_skip "publish: nothing is cloned at $WK_HOME_DIR yet — \`workkit setup\` clones and seeds the tower project" ;;
    other)  say_warn "publish: $WK_HOME_DIR is not the home repo's clone — nothing is published out of somebody else's folder" ;;
  esac
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  say_skip "publish: npm is not on this machine — the dashboard cannot be built here"
  exit 0
fi
if [[ ! -x "$OMEGA_BIN" ]]; then
  say_skip "publish: the tower project's build tooling is not installed at $WK_HOME_DIR (no node_modules/.bin/omega — its @omega.js deps resolve by file: spec from a sibling omega checkout) — nothing is built here; \`npm --prefix $WK_HOME_DIR install\` on a machine with that checkout installs it"
  exit 0
fi

# ── Catch up with the remote ──────────────────────────────────────────────────
# Another machine's publish, or an edit made to the project on GitHub, is the
# ordinary reason main has moved. A rebase that cannot finish means the two
# histories disagree, which is a human's to settle: the run says so, aborts the
# rebase it started, and publishes NOTHING rather than pushing over the other
# side.
#
# `--autostash` because the ordinary local state here is a project file nobody
# has committed yet — an upstream change someone took by hand. Without it a
# rebase refuses on the dirty tree and every such tree would read as a
# divergence.
#
# A pull that cannot finish is not always a divergence — offline, an auth
# refusal and a branch with no upstream all land here — so the warn names the
# symptom and hands over the command that reports the cause.
PRE_HEAD="$(git -C "$WK_HOME_DIR" rev-parse HEAD 2>/dev/null || true)"
STASH_BEFORE="$(git -C "$WK_HOME_DIR" stash list 2>/dev/null || true)"
if ! git -C "$WK_HOME_DIR" pull --rebase --autostash --quiet 2>/dev/null; then
  git -C "$WK_HOME_DIR" rebase --abort >/dev/null 2>&1 || true
  say_warn "publish: $WK_HOME_DIR could not catch up with its upstream — \`git -C $WK_HOME_DIR pull --rebase\` on a clean tree reports why and reconciles it; nothing was published and nothing was forced"
  exit 0
fi

# The autostash's own failure is SILENT (probed 2026-07-29): a rebase that
# lands while the stash it took CONFLICTS on the way back exits 0 and leaves
# the tree full of conflict markers. A run carrying on from there would build
# them and push the markers to main. The stash
# entry surviving the pull is the tell, and the restore is the one git itself
# names — back to the commit this run started on, then pop, which applies onto
# the base the stash was taken from and so cannot conflict again.
if [[ "$(git -C "$WK_HOME_DIR" stash list 2>/dev/null || true)" != "$STASH_BEFORE" ]]; then
  if [[ -n "$PRE_HEAD" ]] \
    && git -C "$WK_HOME_DIR" reset --hard "$PRE_HEAD" >/dev/null 2>&1 \
    && git -C "$WK_HOME_DIR" stash pop >/dev/null 2>&1; then
    say_warn "publish: the uncommitted changes in $WK_HOME_DIR conflict with what its upstream now carries — the tree was put back exactly as this run found it; settle it with \`git -C $WK_HOME_DIR pull --rebase\` and run it again. Nothing was published and nothing was committed"
  else
    say_warn "publish: the uncommitted changes in $WK_HOME_DIR conflict with what its upstream now carries, and putting the tree back did not finish — the changes are safe in \`git -C $WK_HOME_DIR stash list\`; settle it by hand. Nothing was published and nothing was committed"
  fi
  exit 0
fi

# ── Build ─────────────────────────────────────────────────────────────────────

say_info "publish: building the dashboard from $WK_HOME_APP"
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
if ! npm --prefix "$WK_HOME_APP" run build >"$BUILD_LOG" 2>&1; then
  say_warn "publish: the dashboard build failed — the last lines follow"
  tail -20 "$BUILD_LOG" >&2
  exit 1
fi
if [[ ! -d "$WK_HOME_DIST" ]]; then
  say_warn "publish: the build finished but left no output at $WK_HOME_DIST"
  exit 1
fi

# ── The published branch ──────────────────────────────────────────────────────
# A WORKTREE, so main's working tree is never checked out over: the build that
# just ran stays exactly where it is while the branch is assembled elsewhere.
# The branch is created here on the first publish — a branch is generated
# output and pushing it is this script's job, unlike the repo, Pages and
# Discussions, which only `workkit setup` ever creates (issue #71).
WORKTREE="$(mktemp -d)"
rm -rf "$WORKTREE"
BRANCH_EXISTED=0
if git -C "$WK_HOME_DIR" ls-remote --exit-code --heads origin "$WK_HOME_PAGES_BRANCH" >/dev/null 2>&1; then
  BRANCH_EXISTED=1
fi

cleanup_worktree() {
  git -C "$WK_HOME_DIR" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE"
  rm -f "$BUILD_LOG"
}
trap cleanup_worktree EXIT

if [[ "$BRANCH_EXISTED" -eq 1 ]]; then
  git -C "$WK_HOME_DIR" fetch -q origin "$WK_HOME_PAGES_BRANCH" 2>/dev/null || true
  git -C "$WK_HOME_DIR" worktree add -q -B "$WK_HOME_PAGES_BRANCH" "$WORKTREE" \
    "origin/$WK_HOME_PAGES_BRANCH" 2>/dev/null \
    || { say_warn "publish: could not check $WK_HOME_PAGES_BRANCH out beside $WK_HOME_DIR"; exit 1; }
else
  # No branch anywhere: a detached worktree, then an orphan on top of it. The
  # orphan is what keeps main's history out of a branch that carries only
  # generated files.
  git -C "$WK_HOME_DIR" worktree add -q --detach "$WORKTREE" 2>/dev/null \
    || { say_warn "publish: could not make a worktree beside $WK_HOME_DIR"; exit 1; }
  git -C "$WORKTREE" checkout -q --orphan "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
    || { say_warn "publish: could not start the $WK_HOME_PAGES_BRANCH branch"; exit 1; }
  git -C "$WORKTREE" rm -rq --cached . >/dev/null 2>&1 || true
fi

# What the branch carried before this run, kept only long enough for the two
# decisions that need it: whether a snapshot was taken away, and whether the
# new one differs in anything but its timestamp.
HAD_SNAPSHOT=0
PREV_SNAPSHOT=''
if [[ -f "$WORKTREE/data/board.json" ]]; then
  HAD_SNAPSHOT=1
  PREV_SNAPSHOT="$(mktemp)"
  cp "$WORKTREE/data/board.json" "$PREV_SNAPSHOT"
fi

# ── The mirror ────────────────────────────────────────────────────────────────
# The branch mirrors the build exactly, so a page the app stopped shipping stops
# being served. Everything the engine adds (the snapshot, the CNAME, .nojekyll)
# is written after the mirror, never before. `.git` is the worktree's link file
# and is the one thing the mirror must not touch.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null || true
cp -R "$WK_HOME_DIST/." "$WORKTREE/" \
  || { say_warn "publish: could not copy the build into the $WK_HOME_PAGES_BRANCH worktree"; exit 1; }

# Pages runs Jekyll over a branch unless told not to, and a build with `_`-
# prefixed asset folders loses them to it.
: >"$WORKTREE/.nojekyll"

# ── The snapshot ──────────────────────────────────────────────────────────────
# The published copy has no tower to read, so it can ship with one sweep of the
# board — and that sweep is every issue title across every repo on the roster.
#
# GitHub Pages is PUBLIC even when the repo serving it is private (there is no
# private-Pages tier below Enterprise), so baking the board in publishes it to
# anyone with the URL. That makes it the owner's call and nobody else's:
# `site.board` in the machine settings file is DEFAULT OFF — an absent key reads
# as off — and only `true` turns it on. Off, the snapshot is not written and one
# already published is taken away: flipping the switch back has to un-publish
# what it published.
BAKE_BOARD="$(wk_json_get "$WK_HOME_SETTINGS" '.site.board')"
if [[ "$BAKE_BOARD" != 'true' ]]; then
  if [[ "$HAD_SNAPSHOT" -eq 1 ]]; then
    say_info "publish: \`site.board\` is off — the published board snapshot was removed"
  else
    say_skip "publish: \`site.board\` is off — the site publishes without a board snapshot (Pages is public even on a private repo)"
  fi
elif command -v node >/dev/null 2>&1; then
  # The previous snapshot is put back FIRST so the writer can compare against
  # it: it rewrites only when something other than the timestamp changed, and a
  # board nobody touched must not become a commit a day just because time passed.
  if [[ -n "$PREV_SNAPSHOT" ]]; then
    mkdir -p "$WORKTREE/data"
    cp "$PREV_SNAPSHOT" "$WORKTREE/data/board.json"
  fi
  if node "$SCRIPT_DIR/site-data.js" "$WORKTREE/data/board.json" >/dev/null 2>&1; then
    say_info "publish: baked the board snapshot into data/board.json"
  else
    say_warn "publish: the board snapshot could not be composed — the site publishes without a fresh one"
  fi
else
  say_skip "publish: node is not on this machine — no board snapshot is baked in"
fi
if [[ -n "$PREV_SNAPSHOT" ]]; then rm -f "$PREV_SNAPSHOT"; fi

# ── The custom URL ────────────────────────────────────────────────────────────
# `site.url` in the machine settings file is the whole configuration: set, it
# becomes the CNAME Pages serves under; cleared or absent, the CNAME goes away
# and Pages falls back to its github.io address.
SITE_URL="$(wk_json_get "$WK_HOME_SETTINGS" '.site.url')"
if [[ -n "$SITE_URL" ]]; then
  printf '%s\n' "${SITE_URL#*://}" >"$WORKTREE/CNAME"
  say_info "publish: CNAME → ${SITE_URL#*://}"
fi

# ── Push the branch ───────────────────────────────────────────────────────────
# Force WITH LEASE, and only onto this one branch: it carries nothing but
# generated files, so a rewrite is what a rebuild IS — but a lease still refuses
# to overwrite a push this machine has not seen. The first publish creates the
# branch, where there is no remote ref to hold a lease against.
git -C "$WORKTREE" add -A >/dev/null 2>&1 || true
PUBLISHED=0
if ! git -C "$WORKTREE" diff --cached --quiet 2>/dev/null; then
  git -C "$WORKTREE" -c user.name="${GIT_AUTHOR_NAME:-workkit}" \
    -c user.email="${GIT_AUTHOR_EMAIL:-workkit@localhost}" \
    commit -q -m "chore(site): publish $(date '+%Y-%m-%d')" >/dev/null 2>&1 \
    || { say_warn "publish: the $WK_HOME_PAGES_BRANCH commit did not finish"; exit 1; }

  if [[ "$BRANCH_EXISTED" -eq 1 ]]; then
    git -C "$WORKTREE" push -q --force-with-lease origin "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
      || { say_warn "publish: could not push $WK_HOME_PAGES_BRANCH — someone else published since this run started; \`git -C $WK_HOME_DIR fetch\` and run it again"; exit 1; }
  else
    git -C "$WORKTREE" push -q -u origin "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
      || { say_warn "publish: could not push $WK_HOME_PAGES_BRANCH to origin — \`git -C $WK_HOME_DIR push origin $WK_HOME_PAGES_BRANCH\` reports why"; exit 1; }
  fi
  PUBLISHED=1
fi

# ── The source side ───────────────────────────────────────────────────────────
# Whatever the day changed in the project itself — an upstream file someone
# took by hand. Nothing staged means nothing to say.
if git -C "$WK_HOME_DIR" diff --quiet 2>/dev/null && git -C "$WK_HOME_DIR" diff --cached --quiet 2>/dev/null \
  && [[ -z "$(git -C "$WK_HOME_DIR" ls-files --others --exclude-standard 2>/dev/null)" ]]; then
  :
elif ! wk_home_commit_push "chore(site): publish $(date '+%Y-%m-%d')"; then
  # commit_push already said which half failed; the site itself is published.
  exit 1
fi

if [[ "$PUBLISHED" -eq 1 ]]; then
  say_ok "publish: the dashboard is published from $(wk_home_slug) on $WK_HOME_PAGES_BRANCH"
else
  say_skip "publish: the published site is already current"
fi
