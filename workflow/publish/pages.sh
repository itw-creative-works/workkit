#!/usr/bin/env bash
# workflow/publish/pages.sh: the publish's pages side: the gh-pages worktree,
# the mirror of the build into it, the home pointer, the CNAME and the push.
# SOURCED by publish.sh, never executed, and it runs nothing at load: it
# defines functions and nothing else. It declares nothing local: every value a
# step sets is one of the entry's globals, read by the steps after it. It reads
# SOURCE_RC and calls pages_remote_state, both the entry's; WK_HOME_DIR and
# WK_HOME_DIST are lib.sh's and WK_HOME_PAGES_BRANCH is home.sh's. It sets
# WORKTREE, PAGES_STATE, BRANCH_EXISTED, SITE_HOST and PUBLISHED, plus the EXIT
# trap that runs the entry's cleanup_worktree.

# ── The published branch ──────────────────────────────────────────────────────
# A WORKTREE, so main's working tree is never checked out over: the build that
# just ran stays exactly where it is while the branch is assembled elsewhere.
# The branch is created here on the first publish: a branch is generated
# output and pushing it is this script's job, unlike the repo, Pages and
# Discussions, which only `workkit setup` ever creates (issue #71).
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
    # No branch anywhere: a detached worktree, then an orphan on top of it. The
    # orphan is what keeps main's history out of a branch that carries only
    # generated files. A stale LOCAL branch (left behind when the remote one was
    # deleted to be regenerated) would make the orphan checkout refuse: the
    # branch is generated content, so it is safe to drop first.
    git -C "$WK_HOME_DIR" branch -qD "$WK_HOME_PAGES_BRANCH" 2>/dev/null || true
    git -C "$WK_HOME_DIR" worktree add -q --detach "$WORKTREE" 2>/dev/null \
      || { wk_warn "publish: could not make a worktree beside $WK_HOME_DIR"; exit 1; }
    git -C "$WORKTREE" checkout -q --orphan "$WK_HOME_PAGES_BRANCH" 2>/dev/null \
      || { wk_warn "publish: could not start the $WK_HOME_PAGES_BRANCH branch"; exit 1; }
    git -C "$WORKTREE" rm -rq --cached . >/dev/null 2>&1 || true
  fi
}

# ── The mirror ────────────────────────────────────────────────────────────────
# The branch mirrors the build exactly, so a page the app stopped shipping stops
# being served. Everything the engine adds (the home pointer, the CNAME,
# .nojekyll) is written after the mirror, never before. `.git` is the worktree's
# link file and is the one thing the mirror must not touch.
publish_mirror() {
  find "$WORKTREE" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} + 2>/dev/null || true
  cp -R "$WK_HOME_DIST/." "$WORKTREE/" \
    || { wk_warn "publish: could not copy the build into the $WK_HOME_PAGES_BRANCH worktree"; exit 1; }

  # Pages runs Jekyll over a branch unless told not to, and a build with `_`-
  # prefixed asset folders loses them to it.
  : >"$WORKTREE/.nojekyll"
}

# ── The home pointer ──────────────────────────────────────────────────────────
# The ONE public artifact, and the only thing the site cannot work out for
# itself: which repo is the home, and which branch of it the private roster is
# on. Safe to publish because the site is SERVED from that repo (its URL already
# names it, and a branch name says nothing more once the repo is known) and it
# is the address the pages read that roster from, with the viewer's own token.
# The branch is carried rather than assumed because the writer pushes whatever
# branch the clone is on, and a reader hardcoding `main` 404s on a home repo that
# is not (issue #112).
publish_home_pointer() {
  mkdir -p "$WORKTREE/data"
  printf '{"home":"%s","branch":"%s"}\n' "$(wk_home_slug)" "$(wk_home_branch)" >"$WORKTREE/data/home.json"
  wk_info "publish: the home pointer is at data/home.json"
}

# ── The custom URL ────────────────────────────────────────────────────────────
# `site.url` in the machine settings file is the whole configuration: set, it
# becomes the CNAME Pages serves under; cleared or absent, the CNAME goes away
# and Pages falls back to its github.io address.
# The host is the engine's one reader of that option (`wk_site_host` in home/options.sh),
# so the scheme and any trailing slash are off before it gets here: a CNAME
# carries a host and a slash in one is not a valid record.
publish_custom_url() {
  SITE_HOST="$(wk_site_host)"
  if [[ -n "$SITE_HOST" ]]; then
    printf '%s\n' "$SITE_HOST" >"$WORKTREE/CNAME"
    wk_info "publish: CNAME → $SITE_HOST"
  fi
}

# ── Push the branch ───────────────────────────────────────────────────────────
# Force WITH LEASE, and only onto this one branch: it carries nothing but
# generated files, so a rewrite is what a rebuild IS, but a lease still refuses
# to overwrite a push this machine has not seen. The first publish creates the
# branch, where there is no remote ref to hold a lease against.
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
