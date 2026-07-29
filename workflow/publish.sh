#!/usr/bin/env bash
# workflow/publish.sh — build the dashboard and publish it from the home repo.
#
# The tower is two processes on this machine. The PUBLISHED tower is the same
# app built to static files, committed to the home repo and served by GitHub
# Pages — a copy of the board readable from a phone, optionally with the sweep
# it shipped with baked in (workflow/site-data.js, behind `site.board`).
#
# WHY THE BUILD IS LOCAL, and never a GitHub Action (issue #27 Spec, deviation
# 1): the app consumes `@omega.js/*` by `file:` spec from a sibling omega
# checkout, which no CI runner has. Probed 2026-07-28: on a machine without that
# checkout `npm install` still EXITS 0 and leaves dangling symlinks under
# node_modules/@omega.js, and only the build then fails with `omega: command not
# found`. So the tooling check below is the presence of the `omega` binary, not
# the exit status of an install — an install's success proves nothing.
#
# WHERE IT LANDS: `docs/` on the home repo's default branch. The Pages API takes
# exactly two source paths, `/` and `/docs` (probed 2026-07-28,
# `"enum":["/","/docs"]`), so that is the only subdirectory a branch can serve.
#
# Every reason not to publish is a NAMED SKIP with exit 0 — no home repo, no
# build tooling, nothing changed. Only a build or a copy that actually failed
# exits non-zero, which is what the daily job logs.
#
# Usage: publish.sh [--quiet]
# Called by: `workkit publish`, `workkit update` (a human's run), and
#            jobs/claude-daily.sh after the brief has been sent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
KIT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=./home.sh
. "$SCRIPT_DIR/home.sh"

APP_DIR="$KIT_DIR/tower/app"
APP_DIST="$APP_DIR/apps/web/dist"
OMEGA_BIN="$APP_DIR/node_modules/.bin/omega"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

_G='\033[0;32m' _Y='\033[0;33m' _C='\033[0;36m' _D='\033[0;90m' _N='\033[0m'
if [[ ! -t 1 ]]; then _G='' _Y='' _C='' _D='' _N=''; fi
say_ok()   { printf "${_G}✓${_N} %s\n" "$1"; }
say_warn() { printf "${_Y}⚠${_N} %s\n" "$1"; }
say_info() { [[ "$QUIET" -eq 1 ]] || printf "${_C}ℹ${_N} %s\n" "$1"; }
say_skip() { [[ "$QUIET" -eq 1 ]] || printf "${_D}· %s${_N}\n" "$1"; }

# ── The two things a publish needs ────────────────────────────────────────────

if ! wk_home_ready; then
  case "$(wk_home_state)" in
    unset)   say_skip "publish: no home repo — \`workkit setup\` creates one, and the site publishes from it" ;;
    nogit)   say_skip "publish: $WK_HOME_DIR is not a clone yet — \`workkit setup\` converts it in place" ;;
    foreign) say_warn "publish: $WK_HOME_DIR points at another remote — nothing is published into someone else's repo" ;;
  esac
  exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  say_skip "publish: npm is not on this machine — the dashboard cannot be built here"
  exit 0
fi
if [[ ! -x "$OMEGA_BIN" ]]; then
  say_skip "publish: the app's build tooling is not installed at $APP_DIR (no node_modules/.bin/omega — its @omega.js deps resolve by file: spec from a sibling omega checkout) — nothing is built here"
  exit 0
fi

# ── Build ─────────────────────────────────────────────────────────────────────

say_info "publish: building the dashboard from $APP_DIR"
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
if ! npm --prefix "$APP_DIR" run build >"$BUILD_LOG" 2>&1; then
  say_warn "publish: the dashboard build failed — the last lines follow"
  tail -20 "$BUILD_LOG" >&2
  exit 1
fi
if [[ ! -d "$APP_DIST" ]]; then
  say_warn "publish: the build finished but left no output at $APP_DIST"
  exit 1
fi

# ── Copy ──────────────────────────────────────────────────────────────────────
# The published folder mirrors the build exactly, so a page the app stopped
# shipping stops being served. Everything the engine adds (the snapshot, the
# CNAME, .nojekyll) is written after the mirror, never before.
mkdir -p "$WK_HOME_SITE"
# The three the ENGINE writes are excluded from the mirror in both directions:
# they are not the build's to ship, and a snapshot deleted here every day would
# be rewritten every day, which is a commit a day for a board nobody touched.
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude '/data/' --exclude '/CNAME' --exclude '/.nojekyll' \
    "$APP_DIST/" "$WK_HOME_SITE/" \
    || { say_warn "publish: could not copy the build into $WK_HOME_SITE"; exit 1; }
else
  find "$WK_HOME_SITE" -mindepth 1 -maxdepth 1 \
    ! -name data ! -name CNAME ! -name .nojekyll -exec rm -rf {} + 2>/dev/null || true
  cp -R "$APP_DIST/." "$WK_HOME_SITE/" \
    || { say_warn "publish: could not copy the build into $WK_HOME_SITE"; exit 1; }
fi

# Pages runs Jekyll over a branch unless told not to, and a build with `_`-
# prefixed asset folders loses them to it.
: >"$WK_HOME_SITE/.nojekyll"

# ── The snapshot ──────────────────────────────────────────────────────────────
# The published copy has no tower to read, so it can ship with one sweep of the
# board — and that sweep is every issue title across every repo on the roster.
#
# GitHub Pages is PUBLIC even when the repo serving it is private (there is no
# private-Pages tier below Enterprise), so baking the board in publishes it to
# anyone with the URL. That makes it the owner's call and nobody else's:
# `site.board` in workkit.json is DEFAULT OFF, and only `true` turns it on. Off,
# the snapshot is not written and one already published is taken away — flipping
# the switch back has to un-publish what the switch published.
BAKE_BOARD="$(wk_json_get "$WK_HOME_CONFIG" '.site.board')"
if [[ "$BAKE_BOARD" != 'true' ]]; then
  if [[ -f "$WK_HOME_SITE/data/board.json" ]]; then
    rm -f "$WK_HOME_SITE/data/board.json"
    rmdir "$WK_HOME_SITE/data" 2>/dev/null || true
    say_info "publish: \`site.board\` is off — the published board snapshot was removed"
  else
    say_skip "publish: \`site.board\` is off — the site publishes without a board snapshot (Pages is public even on a private repo)"
  fi
elif command -v node >/dev/null 2>&1; then
  if node "$SCRIPT_DIR/site-data.js" "$WK_HOME_SITE/data/board.json" >/dev/null 2>&1; then
    say_info "publish: baked the board snapshot into docs/data/board.json"
  else
    say_warn "publish: the board snapshot could not be composed — the site publishes without a fresh one"
  fi
else
  say_skip "publish: node is not on this machine — no board snapshot is baked in"
fi

# ── The custom URL ────────────────────────────────────────────────────────────
# `site.url` in workkit.json is the whole configuration: set, it becomes the
# CNAME Pages serves under; cleared, the CNAME goes away and Pages falls back to
# its github.io address.
SITE_URL="$(wk_json_get "$WK_HOME_CONFIG" '.site.url')"
if [[ -n "$SITE_URL" ]]; then
  printf '%s\n' "${SITE_URL#*://}" >"$WK_HOME_SITE/CNAME"
  say_info "publish: CNAME → ${SITE_URL#*://}"
else
  rm -f "$WK_HOME_SITE/CNAME"
fi

# ── Commit and push ───────────────────────────────────────────────────────────
# One commit for the site and whatever else the day changed in the committed
# layer (the project slugs a heal wrote into workkit.json). Nothing staged means
# nothing to say — a publish that changed nothing is silent.
if git -C "$WK_HOME_DIR" diff --quiet 2>/dev/null && git -C "$WK_HOME_DIR" diff --cached --quiet 2>/dev/null \
  && [[ -z "$(git -C "$WK_HOME_DIR" ls-files --others --exclude-standard 2>/dev/null)" ]]; then
  say_skip "publish: the published site is already current"
  exit 0
fi

if wk_home_commit_push "chore(site): publish $(date '+%Y-%m-%d')"; then
  say_ok "publish: the dashboard is published from $(wk_home_slug)"
else
  # commit_push already said which half failed; the site is built either way.
  exit 1
fi
