#!/usr/bin/env bash
# workflow/home/install.sh: the clone's dependencies, the commit and push every
# writer ends on, and the clone's own heal. Sourced by home.sh, functions only.
# WK_WORKFLOW_DIR is the entry's; WK_HOME_DIR is lib.sh's.

# Run on both setup paths, since a clone another machine seeded arrives without
# its dependencies. An installed omega binary is the gate.
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
  # Inside the clone with `cd -P`, never `--prefix`: `~/.workkit` can be a
  # symlink, and npm given a prefix keys the tree from the caller's cwd,
  # corrupting the lockfile.
  (cd -P "$WK_HOME_DIR" && npm install) >/dev/null 2>&1 || true
  # The exit status proves nothing, so the binary is the check. One retry: on a
  # fresh tree npm's workspace linking can take two runs to fill
  # node_modules/.bin.
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

# Commit what changed and push; nothing staged means no commit. Never forces.
# Usage: wk_home_commit_push <subject>
wk_home_commit_push() {
  local subject="$1" branch
  wk_home_ready || return 1

  # `.workkit` is excluded rather than trusted to be absent: in the clone it can
  # only be scratch.
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

# The clone's own heal, `standards.sh --home` (README § The home repo's
# lifecycle, step 14). Every failure is a named warning and exit 0.
# Usage: wk_home_heal [--quiet]
#   --quiet prints the heal's lines only when it failed or changed something.
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

  # Captured, so a quiet run can decide whether there is anything to say.
  out="$(bash "$WK_WORKFLOW_DIR/standards.sh" --home "$WK_HOME_DIR" 2>&1)" || rc=$?

  # Asked of the forms only, the one thing this heal writes into the tree, so a
  # half-finished edit elsewhere never triggers a commit about templates.
  if [[ -n "$(git -C "$WK_HOME_DIR" status --porcelain -- .github/ISSUE_TEMPLATE 2>/dev/null)" ]]; then
    changed=1
  fi

  # A commit a past failed push stranded locally is a change too.
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
  # commit_push names its own failure; the ahead check retries it tomorrow.
  wk_home_commit_push 'chore(home): install the issue templates' || true
  return 0
}
