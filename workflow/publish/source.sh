#!/usr/bin/env bash
# workflow/publish/source.sh: the publish's source side, the steps that run
# above the site switch: catching the clone up with its remote, the home repo's
# own heal, the sync from this checkout's tower/app, the roster, and the commit
# and push of whatever they changed. SOURCED by publish.sh, never executed, and
# it runs nothing at load: it defines functions and nothing else. It declares
# nothing local: every value a step sets is one of the entry's globals, read by
# the steps after it. It reads QUIET and SCRIPT_DIR, the entry's, and
# WK_HOME_DIR and WK_USER_DIR, lib.sh's, and sets PRE_HEAD, STASH_BEFORE,
# SYNC_CHANGED, SYNC_RC, SOURCE_SUBJECT and SOURCE_RC.

# ── Catch up with the remote ──────────────────────────────────────────────────
# Another machine's publish, or an edit made to the project on GitHub, is the
# ordinary reason main has moved. A rebase that cannot finish means the two
# histories disagree, which is a human's to settle: the run says so, aborts the
# rebase it started, and publishes NOTHING rather than pushing over the other
# side.
#
# `--autostash` because the ordinary local state here is a project file nobody
# has committed yet: an upstream change someone took by hand. Without it a
# rebase refuses on the dirty tree and every such tree would read as a
# divergence.
#
# A pull that cannot finish is not always a divergence (offline, an auth
# refusal and a branch with no upstream all land here) so the warn names the
# symptom and hands over the command that reports the cause.
publish_catch_up() {
  PRE_HEAD="$(git -C "$WK_HOME_DIR" rev-parse HEAD 2>/dev/null || true)"
  STASH_BEFORE="$(git -C "$WK_HOME_DIR" stash list 2>/dev/null || true)"
  if ! wk_spin "catching the tower clone up with origin" git -C "$WK_HOME_DIR" pull --rebase --autostash --quiet 2>/dev/null; then
    git -C "$WK_HOME_DIR" rebase --abort >/dev/null 2>&1 || true
    wk_warn "publish: $WK_HOME_DIR could not catch up with its upstream; \`git -C $WK_HOME_DIR pull --rebase\` on a clean tree reports why and reconciles it; nothing was published and nothing was forced"
    exit 0
  fi

  # The autostash's own failure is SILENT (probed 2026-07-29): a rebase that
  # lands while the stash it took CONFLICTS on the way back exits 0 and leaves
  # the tree full of conflict markers. A run carrying on from there would build
  # them and push the markers to main. The stash
  # entry surviving the pull is the tell, and the restore is the one git itself
  # names: back to the commit this run started on, then pop, which applies onto
  # the base the stash was taken from and so cannot conflict again.
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
# The clone gets the standard every participating repo gets: its labels and its
# issue forms (issue #123). It sits here, beside the roster and ABOVE the site
# switch, for the roster's reason (issue #111): what makes the home repo fileable
# into is owed whether or not a site is published, and a phone filing into a home
# repo with no templates is a capture nobody's queue can see. It commits and
# pushes only what it changed, so the ordinary morning's tree is untouched and
# the roster below still finds nothing but its own edit.
publish_home_heal() {
  if [[ "$QUIET" -eq 1 ]]; then wk_home_heal --quiet; else wk_home_heal; fi
}

# ── The sync ──────────────────────────────────────────────────────────────────
# The clone is the project, seeded ONCE, so before issue #129 every tower
# improvement made after the home repo was created stopped at the checkout, and
# what Pages served was the app as it looked on seed day. The catch-up runs
# here, by content: an unchanged file is not written, so a second run changes
# nothing and there is nothing to commit.
#
# It sits ABOVE the source push rather than beside the build, because what it
# writes is SOURCE: the refreshed project rides to the default branch in the
# same commit the roster does, so the clone a second machine takes is a current
# one and a run that ends at the switch does not leave a tree dirty until
# tomorrow. Which puts it above the switch as well: the same place the roster
# sits, and for the same reason: it needs git and the clone, and nothing that
# publishing needs.
#
# A checkout with no `tower/app` beside its engine (a moved link target, a bare
# engine folder) is a NAMED SKIP: the clone is built exactly as it is, which is
# what every run before this one did.
publish_sync() {
  SYNC_CHANGED=0
  SYNC_RC=0
  wk_home_sync || SYNC_RC=$?
  [[ "$SYNC_RC" -eq 0 ]] && SYNC_CHANGED=1

  # A PART-refreshed clone (rc=3: a write failed mid-walk) never goes further:
  # committing and building half a refresh is exactly the broken-site publish the
  # mint's own abort exists to prevent. The named skip (rc=1) and already-current
  # (rc=2) both continue: the clone is whole in those, just not newer.
  if [[ "$SYNC_RC" -eq 3 ]]; then
    wk_warn "publish: the tower project in $WK_HOME_DIR is part-refreshed; nothing was committed, built or published; fix the write failure above and publish again"
    exit 1
  fi
}

# ── The roster ────────────────────────────────────────────────────────────────
# Which REPOSITORIES the board sweeps is this machine's roster, and it names
# private repos, so it is written to the home repo's default branch, which is
# as private as that repo is, and never beside the pages (issue #110). The
# published dashboard and the cloud brief both read it from there through the
# GitHub API, each with a token it already holds.
#
# It is refreshed ABOVE the site switch and above every build check (issue #111),
# because those two readers do not share a fate: the cloud brief sweeps this list
# whether or not a site is published, so a machine with the switch off, or
# without the tooling to build, still owes it a current one. What it needs is
# node, git and the clone: nothing that publishing needs.
#
# It carries no stamp of any kind: an unchanged roster produces a byte-identical
# file, git sees nothing staged, and a machine publishing daily does not commit a
# file a day for the time of day.
#
# Without node the list cannot be composed, and the readers carry on with
# whatever is already there, so the run says so and does everything else.
#
# A compose that FAILS says the same thing: an unreadable roster leaves the
# existing file exactly as it is rather than publishing an empty list over a good
# one (issue #116), and this warns without touching the exit code: a
# stale-but-good roster is the designed outcome, unlike the source push below,
# whose failure loses work and is what SOURCE_RC carries.
publish_roster() {
  if command -v node >/dev/null 2>&1; then
    if node "$SCRIPT_DIR/site-repos.js" "$WK_HOME_DIR/data/repos.json" "$WK_USER_DIR" >/dev/null 2>&1; then
      wk_info "publish: the repo list is on $(wk_home_slug)'s default branch at data/repos.json"
    else
      wk_warn "publish: the repo list could not be composed; the published dashboard and the cloud brief both read it, so both carry on with whatever list is already there, and a machine that has never composed one finds no repos to sweep"
    fi
  else
    wk_skip "publish: node is not on this machine; the repo list cannot be refreshed, so the published dashboard and the cloud brief both carry on with whatever list is already there, and a machine that has never composed one finds no repos to sweep"
  fi
}

# ── The source side ───────────────────────────────────────────────────────────
# The roster just written, the project the sync just refreshed, plus whatever
# else the day changed in the clone: an upstream file someone took by hand.
# Nothing staged means nothing to say. A push that did not land is remembered
# rather than acted on: it is the caller's failure to see, and it must not cost
# the site a publish it can still make.
#
# The subject names whichever of the two was the reason there is a commit at
# all; the other rides along, the way anything else dirty in the tree always has.
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
