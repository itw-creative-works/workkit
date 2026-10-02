#!/usr/bin/env bash
# workflow/publish.sh: build the tower project in the home clone and publish it
# to gh-pages. Every reason not to publish is a named skip with exit 0; the
# mechanism is workflow/README.md § Publishing the dashboard.
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

# `present`, `absent` or `unreachable`: `--exit-code` answers 2 for no such
# branch and 128 for no reply, and an unreachable remote must never read as
# absent, or an offline run drops its ref and tears down a site it cannot see.
pages_remote_state() {
  local rc=0
  wk_spin "asking origin about $WK_HOME_PAGES_BRANCH" git -C "$WK_HOME_DIR" ls-remote --exit-code --heads origin "$WK_HOME_PAGES_BRANCH" >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) printf 'present' ;;
    2) printf 'absent' ;;
    *) printf 'unreachable' ;;
  esac
}

# Called only when the switch is off and the remote still carries the branch.
# The branch goes first, since it is what Pages serves; the local copy goes too,
# or the next orphan checkout refuses.
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

# An unparseable settings file is refused, never read as defaults (every switch
# off, no CNAME). Asked first, since the same file names the home repo.
if [[ -f "$WK_HOME_SETTINGS" ]] && command -v jq >/dev/null 2>&1 \
  && ! wk_jq . "$WK_HOME_SETTINGS" >/dev/null 2>&1; then
  wk_warn "publish: $WK_HOME_SETTINGS does not parse as JSON; the site options (\`site.publish\`, \`site.url\`) cannot be read, so nothing was published; fix the file and run it again"
  exit 0
fi

# Without jq the switch cannot be read, and an unreadable switch is not an off
# one.
if ! command -v jq >/dev/null 2>&1; then
  wk_skip "publish: jq is missing; cannot read the publish switch (\`site.publish\`), so nothing is built or pushed; install jq and run it again"
  exit 0
fi

# Default off: only `true` publishes. Read here and acted on below the roster,
# which is not part of the site.
PUBLISH_SITE="$(wk_json_get "$WK_HOME_SETTINGS" '.site.publish')"

if ! wk_home_ready; then
  case "$(wk_home_state)" in
    unset)  wk_skip "publish: no home repo; \`workkit setup\` creates one, and the site publishes from it" ;;
    absent) wk_skip "publish: nothing is cloned at $WK_HOME_DIR yet; \`workkit setup\` clones and seeds the tower project" ;;
    other)  wk_warn "publish: $WK_HOME_DIR is not the home repo's clone; nothing is published out of somebody else's folder" ;;
  esac
  exit 0
fi

# ── Catch up with the remote ──────────────────────────────────────────────────
# A pull that cannot finish (a divergence, offline, an auth refusal) publishes
# nothing; `--autostash` keeps a hand-taken upstream edit from reading as one.
publish_catch_up() {
  PRE_HEAD="$(git -C "$WK_HOME_DIR" rev-parse HEAD 2>/dev/null || true)"
  STASH_BEFORE="$(git -C "$WK_HOME_DIR" stash list 2>/dev/null || true)"
  if ! wk_spin "catching the tower clone up with origin" git -C "$WK_HOME_DIR" pull --rebase --autostash --quiet 2>/dev/null; then
    git -C "$WK_HOME_DIR" rebase --abort >/dev/null 2>&1 || true
    wk_warn "publish: $WK_HOME_DIR could not catch up with its upstream; \`git -C $WK_HOME_DIR pull --rebase\` on a clean tree reports why and reconciles it; nothing was published and nothing was forced"
    exit 0
  fi

  # A conflicting autostash exits 0 over a tree of conflict markers; the
  # surviving stash entry is the tell. Reset to the start commit, then pop,
  # which applies onto the stash's own base and cannot conflict again.
  if [[ "$(git -C "$WK_HOME_DIR" stash list 2>/dev/null || true)" != "$STASH_BEFORE" ]]; then
    if [[ -n "$PRE_HEAD" ]] \
      && git -C "$WK_HOME_DIR" reset --hard "$PRE_HEAD" >/dev/null 2>&1 \
      && git -C "$WK_HOME_DIR" stash pop >/dev/null 2>&1; then
      wk_warn "publish: the uncommitted changes in $WK_HOME_DIR conflict with what its upstream now carries; the tree was put back exactly as this run found it; settle it with \`git -C $WK_HOME_DIR pull --rebase\` and run it again. Nothing was published and nothing was committed"
    else
      wk_warn "publish: the uncommitted changes in $WK_HOME_DIR conflict with what its upstream now carries, and putting the tree back did not finish; the changes are safe in \`git -C $WK_HOME_DIR stash list\`; settle it by hand. Nothing was published and nothing was committed"
    fi
    exit 0
  fi
}

# ── The home repo's own heal ──────────────────────────────────────────────────
# Above the site switch: the home repo is owed its labels and forms whether or
# not a site is published.
publish_home_heal() {
  if [[ "$QUIET" -eq 1 ]]; then wk_home_heal --quiet; else wk_home_heal; fi
}

# ── The sync ──────────────────────────────────────────────────────────────────
# Above the source push, so the refreshed project rides the roster's commit
# (`workflow/README.md` § Publishing the dashboard).
publish_sync() {
  SYNC_CHANGED=0
  SYNC_RC=0
  wk_home_sync || SYNC_RC=$?
  [[ "$SYNC_RC" -eq 0 ]] && SYNC_CHANGED=1

  # rc=3 is a part-refreshed clone (a write failed mid-walk): stop, since half a
  # refresh is the broken site the mint's abort prevents. rc=1 (a named skip)
  # and rc=2 (already current) leave the clone whole, so they continue.
  if [[ "$SYNC_RC" -eq 3 ]]; then
    wk_warn "publish: the tower project in $WK_HOME_DIR is part-refreshed; nothing was committed, built or published; fix the write failure above and publish again"
    exit 1
  fi
}

# ── The roster ────────────────────────────────────────────────────────────────
# Above the site switch and every build check, since the cloud brief reads it
# too. A failed compose warns and leaves the exit code alone: a stale-but-good
# roster is the designed outcome, unlike a failed source push.
publish_roster() {
  if command -v node >/dev/null 2>&1; then
    if node "$SCRIPT_DIR/publish/site-repos.js" "$WK_HOME_DIR/data/repos.json" "$WK_USER_DIR" >/dev/null 2>&1; then
      wk_info "publish: the repo list is on $(wk_home_slug)'s default branch at data/repos.json"
    else
      wk_warn "publish: the repo list could not be composed; the published dashboard and the cloud brief both read it, so both carry on with whatever list is already there, and a machine that has never composed one finds no repos to sweep"
    fi
  else
    wk_skip "publish: node is not on this machine; the repo list cannot be refreshed, so the published dashboard and the cloud brief both carry on with whatever list is already there, and a machine that has never composed one finds no repos to sweep"
  fi
}

# ── The source side ───────────────────────────────────────────────────────────
# A push that did not land is remembered in SOURCE_RC rather than acted on, so
# it never costs the site a publish it can still make.
publish_source_side() {
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
}

# ── The switch ────────────────────────────────────────────────────────────────
# Off means there is no site: a branch still on the remote is taken down, and
# an unreachable remote is never torn down on a guess.
publish_switch() {
  if [[ "$PUBLISH_SITE" != 'true' ]]; then
    wk_skip "publish: \`site.publish\` is off in $WK_HOME_SETTINGS; nothing is built or pushed; set it to true to publish the site (what Pages serves is public, even from a private repo)"
    case "$(pages_remote_state)" in
      present)     site_teardown ;;
      unreachable) wk_warn "publish: the home remote could not be reached, so whether it still serves a site is unknown; nothing was taken down; run it again when the network is back" ;;
    esac
    exit "$SOURCE_RC"
  fi

  if ! command -v npm >/dev/null 2>&1; then
    wk_skip "publish: npm is not on this machine; the dashboard cannot be built here"
    exit "$SOURCE_RC"
  fi
  if [[ ! -x "$OMEGA_BIN" ]]; then
    wk_skip "publish: there is no omega binary at $WK_HOME_DIR/node_modules/.bin/omega, so nothing is built here; run \`(cd -P $WK_HOME_DIR && npm install)\` and read its output"
    exit "$SOURCE_RC"
  fi
}

# ── The clone's dependencies ──────────────────────────────────────────────────
# Runs when the sync wrote a manifest, or when a manifest is newer than npm's
# own stamp (a run that ended before this step). The sync copies with -p, so a
# synced manifest keeps its authored time. A failed install aborts the build.
publish_dependencies() {
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
  # Inside the clone with `cd -P`, never `--prefix`: `~/.workkit` may be a
  # symlink, and a prefixed npm keys the tree from the caller's cwd.
  if [[ "$INSTALL_NEEDED" -eq 1 ]]; then
    wk_info "publish: installing the tower project's dependencies in $WK_HOME_DIR"
    INSTALL_LOG="$(mktemp)"
    if ! wk_spin "installing the tower project's dependencies" bash -c 'cd -P "$1" && npm install' _ "$WK_HOME_DIR" >"$INSTALL_LOG" 2>&1; then
      wk_warn "publish: the tower project's dependencies could not be installed in $WK_HOME_DIR; nothing was built or published, because a build over a half-installed tree is a broken site; \`npm install\` inside $WK_HOME_DIR reports it in full, and the last lines follow"
      tail -20 "$INSTALL_LOG" >&2
      rm -f "$INSTALL_LOG"
      exit 1
    fi
    rm -f "$INSTALL_LOG"
  fi
}

# ── The mint ──────────────────────────────────────────────────────────────────
# At the brand root, the mirror of the build. The failed-mint marker under the
# gitignored `.omega` keeps a failure sticky past tomorrow's "already current".
publish_mint() {
  MINT_FAILED_MARK="$WK_HOME_DIR/.omega/.mint-failed"
  if [[ "$SYNC_CHANGED" -eq 1 || ! -d "$WK_HOME_DIR/.omega/assets/logo" || -f "$MINT_FAILED_MARK" ]]; then
    wk_info "publish: minting the brand assets in $WK_HOME_DIR"
    MINT_LOG="$(mktemp)"
    if ! wk_spin 'minting the brand assets' bash -c 'cd "$1" && "$2" --service=assets' _ "$WK_HOME_DIR" "$OMEGA_BIN" >"$MINT_LOG" 2>&1; then
      mkdir -p "$WK_HOME_DIR/.omega" && : >"$MINT_FAILED_MARK"
      wk_warn "publish: the brand assets could not be minted in $WK_HOME_DIR; nothing was built or published, because the sidebar and the social tags reference the minted paths unconditionally and a stale site beats one with a broken logo; the failure is remembered and every publish aborts here until a mint succeeds; the last lines follow"
      tail -20 "$MINT_LOG" >&2
      rm -f "$MINT_LOG"
      exit 1
    fi
    rm -f "$MINT_LOG" "$MINT_FAILED_MARK"
  fi
}

# ── Build ─────────────────────────────────────────────────────────────────────

# A project site serves a path deep, so the build is told its prefix: `/` when
# `site.url` is set, `/<name>/` otherwise. No GitHub call, so an offline
# publish still builds the right URLs.
publish_build() {
  PATH_PREFIX='/'
  if [[ -z "$(wk_site_host)" ]]; then
    HOME_SLUG="$(wk_home_slug)"
    PATH_PREFIX="/${HOME_SLUG##*/}/"
  fi

  wk_info "publish: building the dashboard from $WK_HOME_TARGET"
  wk_info "publish: the site serves at $PATH_PREFIX; the build is told so"
  BUILD_LOG="$(mktemp)"
  trap 'rm -f "$BUILD_LOG"' EXIT
  if ! wk_spin 'building the dashboard' env OMEGA_PATH_PREFIX="$PATH_PREFIX" npm --prefix "$WK_HOME_TARGET" run build >"$BUILD_LOG" 2>&1; then
    wk_warn "publish: the dashboard build failed; the last lines follow"
    tail -20 "$BUILD_LOG" >&2
    exit 1
  fi
  if [[ ! -d "$WK_HOME_DIST" ]]; then
    wk_warn "publish: the build finished but left no output at $WK_HOME_DIST"
    exit 1
  fi
}

# ── The published branch ──────────────────────────────────────────────────────
# A worktree, so main's tree is never checked out over. The branch is created
# here on the first publish; the repo, Pages and Discussions are setup's alone.
publish_branch() {
  WORKTREE="$(mktemp -d)"
  rm -rf "$WORKTREE"
  PAGES_STATE="$(pages_remote_state)"
  if [[ "$PAGES_STATE" == 'unreachable' ]]; then
    wk_warn "publish: the home remote could not be reached to see whether it already carries $WK_HOME_PAGES_BRANCH; nothing was published and no local branch was touched; run it again when the network is back"
    exit "$SOURCE_RC"
  fi
  BRANCH_EXISTED=0
  [[ "$PAGES_STATE" == 'present' ]] && BRANCH_EXISTED=1

  trap cleanup_worktree EXIT

  if [[ "$BRANCH_EXISTED" -eq 1 ]]; then
    wk_spin "fetching $WK_HOME_PAGES_BRANCH" git -C "$WK_HOME_DIR" fetch -q origin "$WK_HOME_PAGES_BRANCH" 2>/dev/null || true
    git -C "$WK_HOME_DIR" worktree add -q -B "$WK_HOME_PAGES_BRANCH" "$WORKTREE" \
      "origin/$WK_HOME_PAGES_BRANCH" 2>/dev/null \
      || { wk_warn "publish: could not check $WK_HOME_PAGES_BRANCH out beside $WK_HOME_DIR"; exit 1; }
  else
    # An orphan keeps main's history out of a generated branch. A stale local
    # branch would make the orphan checkout refuse, so it is dropped first.
    git -C "$WK_HOME_DIR" branch -qD "$WK_HOME_PAGES_BRANCH" 2>/dev/null || true
    git -C "$WK_HOME_DIR" worktree add -q --detach "$WORKTREE" 2>/dev/null \
      || { wk_warn "publish: could not make a worktree beside $WK_HOME_DIR"; exit 1; }
    git -C "$WORKTREE" checkout -q --orphan "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
      || { wk_warn "publish: could not start the $WK_HOME_PAGES_BRANCH branch"; exit 1; }
    git -C "$WORKTREE" rm -rq --cached . >/dev/null 2>&1 || true
  fi
}

# ── The mirror ────────────────────────────────────────────────────────────────
# The branch mirrors the build exactly, so a retired page stops being served.
# Engine additions are written after the mirror; `.git` is the worktree's link.
publish_mirror() {
  find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null || true
  cp -R "$WK_HOME_DIST/." "$WORKTREE/" \
    || { wk_warn "publish: could not copy the build into the $WK_HOME_PAGES_BRANCH worktree"; exit 1; }

  # Pages runs Jekyll over a branch unless told not to, and a build with `_`-
  # prefixed asset folders loses them to it.
  : >"$WORKTREE/.nojekyll"
}

# ── The home pointer ──────────────────────────────────────────────────────────
# The one public artifact: the home repo and the branch its private roster is
# on. The branch is carried because a reader assuming `main` 404s on a home
# repo whose default is not.
publish_home_pointer() {
  mkdir -p "$WORKTREE/data"
  printf '{"home":"%s","branch":"%s"}\n' "$(wk_home_slug)" "$(wk_home_branch)" >"$WORKTREE/data/home.json"
  wk_info "publish: the home pointer is at data/home.json"
}

# ── The custom URL ────────────────────────────────────────────────────────────
# `site.url` set becomes the CNAME; cleared, the CNAME goes and Pages falls
# back to github.io. `wk_site_host` has already taken the scheme and slash off.
publish_custom_url() {
  SITE_HOST="$(wk_site_host)"
  if [[ -n "$SITE_HOST" ]]; then
    printf '%s\n' "$SITE_HOST" >"$WORKTREE/CNAME"
    wk_info "publish: CNAME → $SITE_HOST"
  fi
}

# ── Push the branch ───────────────────────────────────────────────────────────
# Force with lease onto this one generated branch: a rewrite is what a rebuild
# is, and the lease still refuses a push this machine has not seen.
publish_push() {
  git -C "$WORKTREE" add -A >/dev/null 2>&1 || true
  PUBLISHED=0
  if ! git -C "$WORKTREE" diff --cached --quiet 2>/dev/null; then
    git -C "$WORKTREE" -c user.name="${GIT_AUTHOR_NAME:-workkit}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-workkit@localhost}" \
      commit -q -m "chore(site): publish $(date '+%Y-%m-%d')" >/dev/null 2>&1 \
      || { wk_warn "publish: the $WK_HOME_PAGES_BRANCH commit did not finish"; exit 1; }

    if [[ "$BRANCH_EXISTED" -eq 1 ]]; then
      wk_spin "publishing $WK_HOME_PAGES_BRANCH" git -C "$WORKTREE" push -q --force-with-lease origin "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
        || { wk_warn "publish: could not push $WK_HOME_PAGES_BRANCH; someone else published since this run started; \`git -C $WK_HOME_DIR fetch\` and run it again"; exit 1; }
    else
      wk_spin "publishing $WK_HOME_PAGES_BRANCH" git -C "$WORKTREE" push -q -u origin "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
        || { wk_warn "publish: could not push $WK_HOME_PAGES_BRANCH to origin; \`git -C $WK_HOME_DIR push origin $WK_HOME_PAGES_BRANCH\` reports why"; exit 1; }
    fi
    PUBLISHED=1
  fi

  if [[ "$PUBLISHED" -eq 1 ]]; then
    wk_ok "publish: the dashboard is published from $(wk_home_slug) on $WK_HOME_PAGES_BRANCH"
  else
    wk_skip "publish: the published site is already current"
  fi
}

# ── The steps ─────────────────────────────────────────────────────────────────
# Every reason not to publish is an `exit` inside the step that found it, so a
# call that returns means its step went through. No step declares a local, so a
# later step reads what the step before it left.
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
