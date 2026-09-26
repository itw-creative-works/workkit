#!/usr/bin/env bash
# workflow/home/install.sh: keeping the clone working. The project's
# dependencies, the commit and push every writer ends on, and the clone's own
# heal. SOURCED by home.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. WK_WORKFLOW_DIR is the entry's;
# WK_HOME_DIR is lib.sh's.

# The project's dependencies, so the daily publish has something to build with.
# Absent tooling is an honest skip: the publish checks for the same binary and
# says the same thing.
#
# Run on BOTH setup paths: the seed and the clone another machine already
# seeded, which arrives with the project and none of its dependencies. An
# installed tree is the gate below: the binary already being there means there
# is nothing to install, so a second setup costs nothing.
wk_home_install() {
  if [[ -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    wk_skip "home: the tower project's dependencies are already installed in $WK_HOME_DIR"
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    wk_skip "home: npm is not on this machine; the tower project's dependencies are not installed, so nothing publishes from here yet"
    return 0
  fi
  wk_info "home: installing the tower project's dependencies in $WK_HOME_DIR"
  # INSIDE the clone, links resolved, and never with `--prefix` (issue #171,
  # the same defect publish.sh carried as #166): `~/.workkit` can be a symlink,
  # and npm given a prefix resolves the project through the link while keying
  # the tree from the CALLER'S cwd: a lockfile with package paths outside the
  # project root, a workspace that reads extraneous, and an arborist crash on
  # the next install. This is the FIRST install a machine ever runs, so the
  # corruption would be there from the start. `cd -P` makes the cwd physical.
  (cd -P "$WK_HOME_DIR" && npm install) >/dev/null 2>&1 || true
  # The exit status proves nothing (probed 2026-07-28: an install with no omega
  # checkout to resolve still exits 0 and leaves dangling symlinks), so the
  # binary itself is the check, the same one publish.sh makes.
  #
  # A second pass when the bin is still missing: on a fresh tree npm's own
  # workspace linking took two runs to put anything but omega-manager in
  # node_modules/.bin (observed on the first real setup, 2026-07-29). The retry
  # is one extra run over an installed tree, never a loop. If the bin is absent
  # after it, the warn below is the genuine failure.
  if [[ ! -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    (cd -P "$WK_HOME_DIR" && npm install) >/dev/null 2>&1 || true
  fi
  if [[ -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    wk_ok "home: the tower project can build here"
  else
    wk_warn "home: the tower project's build tooling did not install (no node_modules/.bin/omega); its @omega.js deps resolve by file: link into the omega monorepo, so nothing publishes until that checkout is reachable"
  fi
  return 0
}

# Commit whatever of the committed layer has changed, and push. The message is
# fixed and the commit is skipped when there is nothing staged, so a second run
# writes no empty commit. Never forces.
#
# Usage: wk_home_commit_push <subject>
wk_home_commit_push() {
  local subject="$1" branch
  wk_home_ready || return 1

  # `.workkit` is excluded rather than trusted to be absent: the clone carries no
  # participation state of its own, so anything that appeared under that name is
  # scratch, and an unattended daily commit must never push it to the default
  # branch (issue #79).
  git -C "$WK_HOME_DIR" add -A -- ':!.workkit' >/dev/null 2>&1 || true
  if ! git -C "$WK_HOME_DIR" diff --cached --quiet 2>/dev/null; then
    git -C "$WK_HOME_DIR" -c user.name="${GIT_AUTHOR_NAME:-workkit}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-workkit@localhost}" \
      commit -q -m "$subject" >/dev/null 2>&1 \
      || { wk_warn "home: the commit did not finish in $WK_HOME_DIR"; return 1; }
  fi

  branch="$(wk_home_branch)"
  if wk_spin "pushing $branch" git -C "$WK_HOME_DIR" push -q -u origin "$branch" 2>/dev/null; then
    return 0
  fi
  wk_warn "home: could not push $branch to origin; the commit is local; \`git -C $WK_HOME_DIR push\` reports why"
  return 1
}

# The clone's own heal (issue #123): the home repo gets the SAME standard every
# participating repo gets, from the same code, and only the trigger differs:
# the session hook heals a repo somebody opens, and nobody ever opens a session
# in the clone.
#
# Scoped to what makes a repo FILEABLE INTO: the labels every queue reads and
# the issue forms that apply them. None of the session-state scaffolding, the
# clone carries no `.workkit/`, no opt-in and no local files (issue #79), which
# is why this is `standards.sh --home` rather than the whole heal.
#
# The labels are a REMOTE write and leave nothing in the tree; the forms are
# files. So the commit is asked for only when the FORMS changed, which is what
# makes the second run write nothing, commit nothing and push nothing.
#
# Every failure is a named warning and exit 0: this runs inside the morning, and
# a home repo that could not be healed costs the day nothing.
#
# Usage: wk_home_heal [--quiet]
#   --quiet keeps the heal's own step-by-step lines out of an unattended log,
#   the way the daily publish keeps its own: they are held and printed only when
#   the run failed or actually changed something, which is the only morning
#   where there is anything to read.
wk_home_heal() {
  local quiet=0 rc=0 out changed=0
  [[ "${1:-}" == '--quiet' ]] && quiet=1
  wk_home_ready || {
    wk_warn "home: nothing is cloned at $WK_HOME_DIR; the home repo's labels and issue templates were not healed; \`workkit setup\` clones it"
    return 0
  }
  [[ -n "$WK_WORKFLOW_DIR" && -f "$WK_WORKFLOW_DIR/standards.sh" ]] || {
    wk_warn "home: the heal is missing at ${WK_WORKFLOW_DIR:-this engine}/standards.sh; the home repo's labels and issue templates were not healed"
    return 0
  }

  # The heal speaks on stderr; it is captured so a quiet run can decide whether
  # this morning has anything worth saying.
  out="$(bash "$WK_WORKFLOW_DIR/standards.sh" --home "$WK_HOME_DIR" 2>&1)" || rc=$?

  # The question is asked of the FORMS and of nothing else: they are the only
  # thing this heal writes into the tree (the labels are a remote write), and a
  # heal that read the whole tree would commit somebody's half-finished edit
  # under a message about templates. Whatever else is dirty still rides the
  # commit when there IS one: that is `wk_home_commit_push`'s contract, the
  # same one the daily roster push already lives with.
  if [[ -n "$(git -C "$WK_HOME_DIR" status --porcelain -- .github/ISSUE_TEMPLATE 2>/dev/null)" ]]; then
    changed=1
  fi

  # A past run whose push failed left a commit stranded local. That is a change
  # too: commit_push skips the empty commit and pushes what stayed behind.
  if [[ "$changed" -eq 0 ]]; then
    local ahead
    ahead="$(git -C "$WK_HOME_DIR" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
    [[ "${ahead:-0}" -gt 0 ]] && changed=1
  fi

  if [[ -n "$out" ]] && [[ "$quiet" -eq 0 || "$rc" -ne 0 || "$changed" -eq 1 ]]; then
    printf '%s\n' "$out" >&2
  fi
  if [[ "$rc" -ne 0 ]]; then
    wk_warn "home: the heal of $WK_HOME_DIR did not finish; see the warning above; it runs again tomorrow"
  fi

  [[ "$changed" -eq 1 ]] || return 0
  # commit_push already names which half failed; the morning carries on either
  # way, and the ahead-of-origin check above pushes what stayed local tomorrow.
  wk_home_commit_push 'chore(home): install the issue templates' || true
  return 0
}
