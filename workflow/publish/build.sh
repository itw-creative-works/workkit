#!/usr/bin/env bash
# workflow/publish/build.sh: the publish's build side: the site switch and the
# build tooling it gates, the clone's dependencies, the brand mint and the
# build itself. SOURCED by publish.sh, never executed, and it runs nothing at
# load: it defines functions and nothing else. It declares nothing local: every
# value a step sets is one of the entry's globals, read by the steps after it.
# It reads PUBLISH_SITE, OMEGA_BIN, SYNC_CHANGED and SOURCE_RC and calls
# pages_remote_state and site_teardown, all the entry's; WK_HOME_SETTINGS,
# WK_HOME_DIR, WK_HOME_TARGET and WK_HOME_DIST are lib.sh's and
# WK_HOME_SYNC_MANIFESTS is home.sh's. It sets INSTALL_NEEDED, INSTALL_STAMP,
# INSTALL_LOG, MINT_FAILED_MARK, MINT_LOG, PATH_PREFIX, HOME_SLUG and
# BUILD_LOG, plus the EXIT trap that removes the build log.

# ── The switch ────────────────────────────────────────────────────────────────
# Off is not only "publish nothing today": it is "there is no site" (issue #113).
# A branch still on the remote is a site still being served, so the run takes it
# down: the branch is generated content, rebuilt from scratch by the next yes,
# and nothing is lost. A machine that never published has nothing to remove and
# hears nothing about it. Offline, whether it still serves a site is unknown, and
# an unknown is never torn down.
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
    wk_skip "publish: the tower project's build tooling is not installed at $WK_HOME_DIR (no node_modules/.bin/omega; its @omega.js deps resolve by file: spec from a sibling omega checkout); nothing is built here; \`(cd -P $WK_HOME_DIR && npm install)\` on a machine with that checkout installs it"
    exit "$SOURCE_RC"
  fi
}

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
# A FAILED install aborts before the build, for the mint's reason: building
# over a half-installed tree publishes a broken site. It leaves NO sticky
# marker, unlike the mint, because npm's own stamp is the memory (#130 verify,
# F1): the flag only says a manifest moved THIS run, and a run that wrote
# manifests but ended before this step (the switch was off, or the install
# itself failed) would leave the clone permanently behind if the flag were
# the whole trigger. So the backstop compares each manifest against
# node_modules/.package-lock.json, which npm rewrites on every install. The
# sync copies with -p, so a synced manifest keeps its authored time: always
# older than the stamp of any install that has already seen it, and newer than
# one that has not.
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
  # The install runs INSIDE the clone, with its links resolved, and never with
  # `--prefix` (issue #166): `~/.workkit` is a symlink here, and npm given a
  # prefix resolves the project through the link while keying the tree from the
  # CALLER'S cwd. The lockfile took package paths outside the project root, the
  # targets/web workspace went extraneous, @omega.js/web never installed, and the
  # next run died inside arborist. `cd -P` is what makes the cwd physical.
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
# The brand assets, minted from the one authored mark at `assets/logo` into the
# gitignored `.omega/assets` the web build's static channel bridges. It runs at
# the BRAND ROOT, where the `omega` bin is the manager's and the assets service
# lives: the mirror image of the build, which resolves only inside the app.
#
# THREE triggers, and no others: a sync that changed something (the authored
# mark or the brand config may be what changed), a clone that has never minted
# at all (which is every freshly seeded one, since `.omega` is among the trees
# the seed leaves behind) and a marker left by a mint that FAILED. The marker
# is what makes a failure sticky: the failing sync's changes were already
# committed above, so tomorrow's run reads "already current" and would
# otherwise mint nothing and publish straight over the failure. `.omega` is
# gitignored in the clone, so the marker never reaches a commit.
#
# A mint that FAILS aborts, before the build rather than after it: the sidebar
# and the og/twitter tags emit the minted paths unconditionally, so a build on
# top of a failed mint publishes a public site with a broken logo. A stale site
# beats that, and the exit code is what the daily job logs.
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

# The build emits its asset URLs from the site's ROOT, and a project site is not
# served at one: `<owner>.github.io/<name>/` puts everything a path deeper, so a
# build told nothing writes `/assets/...` and every one of them 404s (issue
# #165). The publisher is the only side that knows the final address, so it
# derives the prefix here and hands it over.
#
# `site.url` decides it, and decides it alone: a CNAME carries a HOST and can
# never carry a path, so a custom domain serves at the domain's root (`/`) and
# no custom domain means the default project address (`/<name>/`, the repo half
# of the slug). Two cases, exhaustive, and neither asks GitHub anything: a
# publish that cannot reach the network still builds the right URLs.
#
# `OMEGA_PATH_PREFIX` is the contract with the framework (omega#355), and the
# installed omega HONORS it: its engine registers the path-prefix transform
# whenever the variable is set, so what is exported here is what the built
# pages emit their URLs under.
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
