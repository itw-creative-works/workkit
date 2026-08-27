#!/usr/bin/env bash
# workflow/publish.sh — build the tower project and publish it to gh-pages.
#
# The tower is two processes on this machine. The PUBLISHED tower is the same
# app built to static files and served by GitHub Pages from the home repo — the
# board readable from a phone, and NOTHING about it is baked in: the site reads
# GitHub live from the browser with the viewer's own token (issue #81). The one
# artifact this script writes beside the pages is `data/home.json`, the home
# repo's slug and the branch the roster is on, nothing else (issues #110, #112). The ROSTER — which repos the board
# sweeps — is written to the home repo's default branch instead, where the repo's
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
# the exit status of an install — an install's success proves nothing.
#
# WHERE THE BUILD RUNS, probed against the real tower/app 2026-07-29: `build` is
# a command of @omega.js/web and resolves only INSIDE the target — at the brand
# root the `omega` bin dispatches to @omega.js/manager, which has no build at
# all. So the build is `npm --prefix <clone>/targets/web run build`, and it
# writes `targets/web/dist/`.
#
# WHERE IT LANDS: the `gh-pages` branch, at its ROOT. Nothing built is ever
# committed on main, and no folder on main is named for a Pages rule. The branch
# is generated output and is published with a worktree — main's working tree is
# never touched, and the only forcing that ever happens is a lease onto that one
# branch.
#
# WHAT THE SWITCH GOVERNS. `site.publish` decides the SITE, and since issue #113
# it decides whether that site EXISTS rather than only whether it is updated: a
# run that finds the switch off and a `gh-pages` branch still on the home repo
# takes the site down — the branch is generated content and the next yes rebuilds
# it from scratch. Two things are outside the switch. The roster is one (issue
# #111): `data/repos.json` on the home repo's default branch is read by the CLOUD
# BRIEF as well as by the published dashboard, so it is refreshed and pushed
# ABOVE the gate and before any build tooling is asked for — it needs node, git
# and the clone, and nothing that publishing needs. Whatever else the day changed
# in the project rides with it, in the same commit.
#
# Every reason not to publish is a NAMED SKIP with exit 0 — no home repo, no
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

OMEGA_BIN="$WK_HOME_DIR/node_modules/.bin/omega"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1

# The palette is lib.sh's, sourced above — one home for the codes and for the
# question of whether a run gets any (issue #90).
wk_set_palette
say_ok()   { printf "${_G}✓${_N} %s\n" "$1"; }
say_warn() { printf "${_Y}⚠${_N} %s\n" "$1"; }
say_info() { [[ "$QUIET" -eq 1 ]] || printf "${_C}ℹ${_N} %s\n" "$1"; }
say_skip() { [[ "$QUIET" -eq 1 ]] || printf "${_D}· %s${_N}\n" "$1"; }

# Whether the home remote already carries the published branch — `present`,
# `absent` or `unreachable`, and the three are told apart on purpose.
# `--exit-code` answers 2 for a remote that replied with no such branch and 128
# for one that could not be reached at all, and reading the second as the first
# is what made an offline run drop its local ref and then fail at the push
# (issue #111). It is also what keeps an offline run from tearing a site down it
# cannot see.
pages_remote_state() {
  local rc=0
  git -C "$WK_HOME_DIR" ls-remote --exit-code --heads origin "$WK_HOME_PAGES_BRANCH" >/dev/null 2>&1 || rc=$?
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
# tidy-up. A local copy of the branch is dropped with it — it is generated
# content, and leaving it behind is what makes the next orphan checkout refuse.
site_teardown() {
  local slug out rc=0
  slug="$(wk_home_slug)"
  if ! git -C "$WK_HOME_DIR" push -q origin --delete "$WK_HOME_PAGES_BRANCH" 2>/dev/null; then
    say_warn "publish: could not delete $WK_HOME_PAGES_BRANCH on $slug — the site it serves is still up; \`git -C $WK_HOME_DIR push origin --delete $WK_HOME_PAGES_BRANCH\` reports why"
    return 0
  fi
  say_ok "publish: the site is taken down — $slug's $WK_HOME_PAGES_BRANCH branch is deleted"
  git -C "$WK_HOME_DIR" branch -qD "$WK_HOME_PAGES_BRANCH" >/dev/null 2>&1 || true

  if ! command -v gh >/dev/null 2>&1; then
    say_skip "publish: gh is not on this machine — Pages is still configured on $slug with nothing to serve; turn it off at https://github.com/$slug/settings/pages"
    return 0
  fi
  out="$(gh api -X DELETE "repos/$slug/pages" 2>&1)" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    say_ok "publish: Pages is disabled on $slug"
  elif [[ "$out" == *404* ]]; then
    say_skip "publish: Pages was not configured on $slug — there was nothing to disable"
  else
    say_warn "publish: could not disable Pages on $slug — the branch is gone, so it serves nothing, but the configuration is still there; turn it off at https://github.com/$slug/settings/pages"
  fi
}

# ── The three things a publish needs ──────────────────────────────────────────

# The site options decide what is published, so a settings file that does not
# parse is not a default — it is an answer nobody can read. Reading on would
# turn every switch silently off and drop the CNAME, which is the loudest
# way to publish the wrong thing quietly. It is asked FIRST because the same
# file names the home repo, so every check below would otherwise report an
# unreadable file as a machine with no home at all.
if [[ -f "$WK_HOME_SETTINGS" ]] && command -v jq >/dev/null 2>&1 \
  && ! jq . "$WK_HOME_SETTINGS" >/dev/null 2>&1; then
  say_warn "publish: $WK_HOME_SETTINGS does not parse as JSON — the site options (\`site.publish\`, \`site.url\`) cannot be read, so nothing was published; fix the file and run it again"
  exit 0
fi

# Without jq the switch cannot be READ, and an unreadable switch is not an off
# one: the gate below reads empty on a machine with no jq, so it would tell an
# owner who already said yes to go and turn on what is already on.
if ! command -v jq >/dev/null 2>&1; then
  say_skip "publish: jq is missing — cannot read the publish switch (\`site.publish\`), so nothing is built or pushed; install jq and run it again"
  exit 0
fi

# `site.publish` is the whole decision about the site, and it is DEFAULT OFF —
# an absent key reads as off, and only `true` publishes (issue #80). It is all or
# nothing: a machine that has not said yes builds nothing and pushes nothing,
# whoever asked for the run, because what Pages serves is public and saying so
# once is the owner's to do. The engine takes that yes at its word and checks
# nothing else — not the account's plan, not the repo's visibility (owner ruling,
# 2026-07-29). It is READ here and ACTED ON below the roster: the answer decides
# the site, and the roster is not part of the site (issue #111).
PUBLISH_SITE="$(wk_json_get "$WK_HOME_SETTINGS" '.site.publish')"

if ! wk_home_ready; then
  case "$(wk_home_state)" in
    unset)  say_skip "publish: no home repo — \`workkit setup\` creates one, and the site publishes from it" ;;
    absent) say_skip "publish: nothing is cloned at $WK_HOME_DIR yet — \`workkit setup\` clones and seeds the tower project" ;;
    other)  say_warn "publish: $WK_HOME_DIR is not the home repo's clone — nothing is published out of somebody else's folder" ;;
  esac
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

# ── The home repo's own heal ──────────────────────────────────────────────────
# The clone gets the standard every participating repo gets — its labels and its
# issue forms (issue #123). It sits here, beside the roster and ABOVE the site
# switch, for the roster's reason (issue #111): what makes the home repo fileable
# into is owed whether or not a site is published, and a phone filing into a home
# repo with no templates is a capture nobody's queue can see. It commits and
# pushes only what it changed, so the ordinary morning's tree is untouched and
# the roster below still finds nothing but its own edit.
if [[ "$QUIET" -eq 1 ]]; then wk_home_heal --quiet; else wk_home_heal; fi

# ── The sync ──────────────────────────────────────────────────────────────────
# The clone is the project, seeded ONCE — so before issue #129 every tower
# improvement made after the home repo was created stopped at the checkout, and
# what Pages served was the app as it looked on seed day. The catch-up runs
# here, by content: an unchanged file is not written, so a second run changes
# nothing and there is nothing to commit.
#
# It sits ABOVE the source push rather than beside the build, because what it
# writes is SOURCE: the refreshed project rides to the default branch in the
# same commit the roster does, so the clone a second machine takes is a current
# one and a run that ends at the switch does not leave a tree dirty until
# tomorrow. Which puts it above the switch as well — the same place the roster
# sits, and for the same reason: it needs git and the clone, and nothing that
# publishing needs.
#
# A checkout with no `tower/app` beside its engine — a moved link target, a bare
# engine folder — is a NAMED SKIP: the clone is built exactly as it is, which is
# what every run before this one did.
SYNC_CHANGED=0
SYNC_RC=0
wk_home_sync || SYNC_RC=$?
[[ "$SYNC_RC" -eq 0 ]] && SYNC_CHANGED=1

# A PART-refreshed clone (rc=3: a write failed mid-walk) never goes further:
# committing and building half a refresh is exactly the broken-site publish the
# mint's own abort exists to prevent. The named skip (rc=1) and already-current
# (rc=2) both continue — the clone is whole in those, just not newer.
if [[ "$SYNC_RC" -eq 3 ]]; then
  say_warn "publish: the tower project in $WK_HOME_DIR is part-refreshed — nothing was committed, built or published; fix the write failure above and publish again"
  exit 1
fi

# ── The roster ────────────────────────────────────────────────────────────────
# Which REPOSITORIES the board sweeps is this machine's roster, and it names
# private repos — so it is written to the home repo's default branch, which is
# as private as that repo is, and never beside the pages (issue #110). The
# published dashboard and the cloud brief both read it from there through the
# GitHub API, each with a token it already holds.
#
# It is refreshed ABOVE the site switch and above every build check (issue #111),
# because those two readers do not share a fate: the cloud brief sweeps this list
# whether or not a site is published, so a machine with the switch off, or
# without the tooling to build, still owes it a current one. What it needs is
# node, git and the clone — nothing that publishing needs.
#
# It carries no stamp of any kind: an unchanged roster produces a byte-identical
# file, git sees nothing staged, and a machine publishing daily does not commit a
# file a day for the time of day.
#
# Without node the list cannot be composed, and the readers carry on with
# whatever is already there — so the run says so and does everything else.
#
# A compose that FAILS says the same thing: an unreadable roster leaves the
# existing file exactly as it is rather than publishing an empty list over a good
# one (issue #116), and this warns without touching the exit code — a
# stale-but-good roster is the designed outcome, unlike the source push below,
# whose failure loses work and is what SOURCE_RC carries.
if command -v node >/dev/null 2>&1; then
  if node "$SCRIPT_DIR/site-repos.js" "$WK_HOME_DIR/data/repos.json" "$WK_USER_DIR" >/dev/null 2>&1; then
    say_info "publish: the repo list is on $(wk_home_slug)'s default branch at data/repos.json"
  else
    say_warn "publish: the repo list could not be composed — the published dashboard and the cloud brief both read it, so both carry on with whatever list is already there, and a machine that has never composed one finds no repos to sweep"
  fi
else
  say_skip "publish: node is not on this machine — the repo list cannot be refreshed, so the published dashboard and the cloud brief both carry on with whatever list is already there, and a machine that has never composed one finds no repos to sweep"
fi

# ── The source side ───────────────────────────────────────────────────────────
# The roster just written, the project the sync just refreshed, plus whatever
# else the day changed in the clone — an upstream file someone took by hand.
# Nothing staged means nothing to say. A push that did not land is remembered
# rather than acted on: it is the caller's failure to see, and it must not cost
# the site a publish it can still make.
#
# The subject names whichever of the two was the reason there is a commit at
# all; the other rides along, the way anything else dirty in the tree always has.
SOURCE_SUBJECT='chore(home): refresh the repo list'
[[ "$SYNC_CHANGED" -eq 1 ]] && SOURCE_SUBJECT='chore(home): sync the tower project'
SOURCE_RC=0
if git -C "$WK_HOME_DIR" diff --quiet 2>/dev/null && git -C "$WK_HOME_DIR" diff --cached --quiet 2>/dev/null \
  && [[ -z "$(git -C "$WK_HOME_DIR" ls-files --others --exclude-standard 2>/dev/null)" ]]; then
  :
elif ! wk_home_commit_push "$SOURCE_SUBJECT"; then
  # commit_push already said which half failed.
  SOURCE_RC=1
fi

# ── The switch ────────────────────────────────────────────────────────────────
# Off is not only "publish nothing today": it is "there is no site" (issue #113).
# A branch still on the remote is a site still being served, so the run takes it
# down — the branch is generated content, rebuilt from scratch by the next yes,
# and nothing is lost. A machine that never published has nothing to remove and
# hears nothing about it. Offline, whether it still serves a site is unknown, and
# an unknown is never torn down.
if [[ "$PUBLISH_SITE" != 'true' ]]; then
  say_skip "publish: \`site.publish\` is off in $WK_HOME_SETTINGS — nothing is built or pushed; set it to true to publish the site (what Pages serves is public, even from a private repo)"
  case "$(pages_remote_state)" in
    present)     site_teardown ;;
    unreachable) say_warn "publish: the home remote could not be reached, so whether it still serves a site is unknown — nothing was taken down; run it again when the network is back" ;;
  esac
  exit "$SOURCE_RC"
fi

if ! command -v npm >/dev/null 2>&1; then
  say_skip "publish: npm is not on this machine — the dashboard cannot be built here"
  exit "$SOURCE_RC"
fi
if [[ ! -x "$OMEGA_BIN" ]]; then
  say_skip "publish: the tower project's build tooling is not installed at $WK_HOME_DIR (no node_modules/.bin/omega — its @omega.js deps resolve by file: spec from a sibling omega checkout) — nothing is built here; \`(cd -P $WK_HOME_DIR && npm install)\` on a machine with that checkout installs it"
  exit "$SOURCE_RC"
fi

# ── The clone's dependencies ──────────────────────────────────────────────────
# A sync that refreshed a MANIFEST leaves the clone one step behind itself: the
# new package.json is there and nothing has installed it, so until issue #130
# the first publish after a tower dependency change built against the tree the
# last install left and failed loudly on the missing module, red every morning
# until someone ran an install by hand. The sync says which kind of file it
# wrote, so this runs exactly when a manifest moved and never on the ordinary
# page-only refresh, where it would spend a minute for nothing.
#
# npm is not asked for again: the gate two steps above is that named skip, and
# nothing between here and it can take npm away.
#
# A FAILED install aborts before the build, for the mint's reason — building
# over a half-installed tree publishes a broken site. It leaves NO sticky
# marker, unlike the mint, because npm's own stamp is the memory (#130 verify,
# F1): the flag only says a manifest moved THIS run, and a run that wrote
# manifests but ended before this step — the switch was off, or the install
# itself failed — would leave the clone permanently behind if the flag were
# the whole trigger. So the backstop compares each manifest against
# node_modules/.package-lock.json, which npm rewrites on every install. The
# sync copies with -p, so a synced manifest keeps its authored time — always
# older than the stamp of any install that has already seen it, and newer than
# one that has not.
INSTALL_NEEDED="$WK_HOME_SYNC_MANIFESTS"
INSTALL_STAMP="$WK_HOME_DIR/node_modules/.package-lock.json"
if [[ "$INSTALL_NEEDED" -eq 0 ]]; then
  for m in "$WK_HOME_DIR/package.json" "$WK_HOME_DIR"/targets/*/package.json; do
    [[ -f "$m" ]] || continue
    if [[ ! -f "$INSTALL_STAMP" || "$m" -nt "$INSTALL_STAMP" ]]; then
      INSTALL_NEEDED=1
      break
    fi
  done
fi
# The install runs INSIDE the clone, with its links resolved, and never with
# `--prefix` (issue #166): `~/.workkit` is a symlink here, and npm given a
# prefix resolves the project through the link while keying the tree from the
# CALLER'S cwd. The lockfile took package paths outside the project root, the
# targets/web workspace went extraneous, @omega.js/web never installed, and the
# next run died inside arborist. `cd -P` is what makes the cwd physical.
if [[ "$INSTALL_NEEDED" -eq 1 ]]; then
  say_info "publish: installing the tower project's dependencies in $WK_HOME_DIR"
  INSTALL_LOG="$(mktemp)"
  if ! (cd -P "$WK_HOME_DIR" && npm install) >"$INSTALL_LOG" 2>&1; then
    say_warn "publish: the tower project's dependencies could not be installed in $WK_HOME_DIR — nothing was built or published, because a build over a half-installed tree is a broken site; \`npm install\` inside $WK_HOME_DIR reports it in full, and the last lines follow"
    tail -20 "$INSTALL_LOG" >&2
    rm -f "$INSTALL_LOG"
    exit 1
  fi
  rm -f "$INSTALL_LOG"
fi

# ── The mint ──────────────────────────────────────────────────────────────────
# The brand assets, minted from the one authored mark at `assets/logo` into the
# gitignored `.omega/assets` the web build's static channel bridges. It runs at
# the BRAND ROOT, where the `omega` bin is the manager's and the assets service
# lives — the mirror image of the build, which resolves only inside the app.
#
# THREE triggers, and no others: a sync that changed something (the authored
# mark or the brand config may be what changed), a clone that has never minted
# at all — which is every freshly seeded one, since `.omega` is among the trees
# the seed leaves behind — and a marker left by a mint that FAILED. The marker
# is what makes a failure sticky: the failing sync's changes were already
# committed above, so tomorrow's run reads "already current" and would
# otherwise mint nothing and publish straight over the failure. `.omega` is
# gitignored in the clone, so the marker never reaches a commit.
#
# A mint that FAILS aborts, before the build rather than after it: the sidebar
# and the og/twitter tags emit the minted paths unconditionally, so a build on
# top of a failed mint publishes a public site with a broken logo. A stale site
# beats that, and the exit code is what the daily job logs.
MINT_FAILED_MARK="$WK_HOME_DIR/.omega/.mint-failed"
if [[ "$SYNC_CHANGED" -eq 1 || ! -d "$WK_HOME_DIR/.omega/assets/logo" || -f "$MINT_FAILED_MARK" ]]; then
  say_info "publish: minting the brand assets in $WK_HOME_DIR"
  MINT_LOG="$(mktemp)"
  if ! (cd "$WK_HOME_DIR" && "$OMEGA_BIN" --service=assets) >"$MINT_LOG" 2>&1; then
    mkdir -p "$WK_HOME_DIR/.omega" && : >"$MINT_FAILED_MARK"
    say_warn "publish: the brand assets could not be minted in $WK_HOME_DIR — nothing was built or published, because the sidebar and the social tags reference the minted paths unconditionally and a stale site beats one with a broken logo; the failure is remembered and every publish aborts here until a mint succeeds; the last lines follow"
    tail -20 "$MINT_LOG" >&2
    rm -f "$MINT_LOG"
    exit 1
  fi
  rm -f "$MINT_LOG" "$MINT_FAILED_MARK"
fi

# ── Build ─────────────────────────────────────────────────────────────────────

# The build emits its asset URLs from the site's ROOT, and a project site is not
# served at one: `<owner>.github.io/<name>/` puts everything a path deeper, so a
# build told nothing writes `/assets/...` and every one of them 404s (issue
# #165). The publisher is the only side that knows the final address, so it
# derives the prefix here and hands it over.
#
# `site.url` decides it, and decides it alone: a CNAME carries a HOST and can
# never carry a path, so a custom domain serves at the domain's root (`/`) and
# no custom domain means the default project address (`/<name>/`, the repo half
# of the slug). Two cases, exhaustive, and neither asks GitHub anything — a
# publish that cannot reach the network still builds the right URLs.
#
# `OMEGA_PATH_PREFIX` is the contract with the framework (omega#355), and the
# installed omega HONORS it: its engine registers the path-prefix transform
# whenever the variable is set, so what is exported here is what the built
# pages emit their URLs under.
PATH_PREFIX='/'
if [[ -z "$(wk_json_get "$WK_HOME_SETTINGS" '.site.url')" ]]; then
  HOME_SLUG="$(wk_home_slug)"
  PATH_PREFIX="/${HOME_SLUG##*/}/"
fi

say_info "publish: building the dashboard from $WK_HOME_TARGET"
say_info "publish: the site serves at $PATH_PREFIX — the build is told so"
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
if ! OMEGA_PATH_PREFIX="$PATH_PREFIX" npm --prefix "$WK_HOME_TARGET" run build >"$BUILD_LOG" 2>&1; then
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
PAGES_STATE="$(pages_remote_state)"
if [[ "$PAGES_STATE" == 'unreachable' ]]; then
  say_warn "publish: the home remote could not be reached to see whether it already carries $WK_HOME_PAGES_BRANCH — nothing was published and no local branch was touched; run it again when the network is back"
  exit "$SOURCE_RC"
fi
BRANCH_EXISTED=0
[[ "$PAGES_STATE" == 'present' ]] && BRANCH_EXISTED=1

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
  # generated files. A stale LOCAL branch (left behind when the remote one was
  # deleted to be regenerated) would make the orphan checkout refuse — the
  # branch is generated content, so it is safe to drop first.
  git -C "$WK_HOME_DIR" branch -qD "$WK_HOME_PAGES_BRANCH" 2>/dev/null || true
  git -C "$WK_HOME_DIR" worktree add -q --detach "$WORKTREE" 2>/dev/null \
    || { say_warn "publish: could not make a worktree beside $WK_HOME_DIR"; exit 1; }
  git -C "$WORKTREE" checkout -q --orphan "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
    || { say_warn "publish: could not start the $WK_HOME_PAGES_BRANCH branch"; exit 1; }
  git -C "$WORKTREE" rm -rq --cached . >/dev/null 2>&1 || true
fi

# ── The mirror ────────────────────────────────────────────────────────────────
# The branch mirrors the build exactly, so a page the app stopped shipping stops
# being served. Everything the engine adds (the home pointer, the CNAME,
# .nojekyll) is written after the mirror, never before. `.git` is the worktree's
# link file and is the one thing the mirror must not touch.
find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null || true
cp -R "$WK_HOME_DIST/." "$WORKTREE/" \
  || { say_warn "publish: could not copy the build into the $WK_HOME_PAGES_BRANCH worktree"; exit 1; }

# Pages runs Jekyll over a branch unless told not to, and a build with `_`-
# prefixed asset folders loses them to it.
: >"$WORKTREE/.nojekyll"

# ── The home pointer ──────────────────────────────────────────────────────────
# The ONE public artifact, and the only thing the site cannot work out for
# itself: which repo is the home, and which branch of it the private roster is
# on. Safe to publish because the site is SERVED from that repo — its URL already
# names it, and a branch name says nothing more once the repo is known — and it
# is the address the pages read that roster from, with the viewer's own token.
# The branch is carried rather than assumed because the writer pushes whatever
# branch the clone is on, and a reader hardcoding `main` 404s on a home repo that
# is not (issue #112).
mkdir -p "$WORKTREE/data"
printf '{"home":"%s","branch":"%s"}\n' "$(wk_home_slug)" "$(wk_home_branch)" >"$WORKTREE/data/home.json"
say_info "publish: the home pointer is at data/home.json"

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

if [[ "$PUBLISHED" -eq 1 ]]; then
  say_ok "publish: the dashboard is published from $(wk_home_slug) on $WK_HOME_PAGES_BRANCH"
else
  say_skip "publish: the published site is already current"
fi

exit "$SOURCE_RC"
