#!/usr/bin/env bash
# workflow/home/install.sh: the clone's dependencies, the catch-up and the
# commit and push its writers use, and the clone's own heal. Sourced by home.sh,
# functions only. WK_WORKFLOW_DIR (the install) and WK_KIT_DIR (the heal, read
# through seed.sh's wk_home_source) are the entry's; WK_HOME_DIR is lib.sh's.

# Run on both setup paths (unless the clone could not catch up), since a clone
# another machine seeded arrives without its dependencies. An installed omega
# binary is the gate.
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
  bash "$WK_WORKFLOW_DIR/publish/build.sh" install "$WK_HOME_DIR" >/dev/null 2>&1 || true
  # The exit status proves nothing, so the binary is the check. One retry: on a
  # fresh tree npm's workspace linking can take two runs to fill
  # node_modules/.bin.
  if [[ ! -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    bash "$WK_WORKFLOW_DIR/publish/build.sh" install "$WK_HOME_DIR" >/dev/null 2>&1 || true
  fi
  if [[ -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    wk_ok "home: the tower project can build here"
  else
    wk_warn "home: the tower project's build tooling did not install (no node_modules/.bin/omega); \`npm install\` in $WK_HOME_DIR did not produce the omega binary, so nothing publishes until it does; run it there and read its output"
  fi
  return 0
}

# Catch the clone up with origin before anything writes into it; 1 means it
# could not, and the warning says where the tree was left. `--autostash` keeps a
# hand-taken upstream edit from reading as a divergence.
# Usage: wk_home_catch_up <prefix>   (the warnings' prefix: publish, home, runner)
wk_home_catch_up() {
  local prefix="$1" pre_head stash_before
  pre_head="$(git -C "$WK_HOME_DIR" rev-parse HEAD 2>/dev/null || true)"
  stash_before="$(git -C "$WK_HOME_DIR" stash list 2>/dev/null || true)"
  if ! wk_spin "catching the tower clone up with origin" git -C "$WK_HOME_DIR" pull --rebase --autostash --quiet 2>/dev/null; then
    git -C "$WK_HOME_DIR" rebase --abort >/dev/null 2>&1 || true
    wk_warn "$prefix: $WK_HOME_DIR could not catch up with its upstream; \`git -C $WK_HOME_DIR pull --rebase\` on a clean tree reports why and reconciles it; nothing was forced"
    return 1
  fi

  # A conflicting autostash exits 0 over a tree of conflict markers; the
  # surviving stash entry is the tell. Reset to the start commit, then pop,
  # which applies onto the stash's own base and cannot conflict again.
  if [[ "$(git -C "$WK_HOME_DIR" stash list 2>/dev/null || true)" != "$stash_before" ]]; then
    if [[ -n "$pre_head" ]] \
      && git -C "$WK_HOME_DIR" reset --hard "$pre_head" >/dev/null 2>&1 \
      && git -C "$WK_HOME_DIR" stash pop >/dev/null 2>&1; then
      wk_warn "$prefix: the uncommitted changes in $WK_HOME_DIR conflict with what its upstream now carries; the tree was put back exactly as this run found it; settle it with \`git -C $WK_HOME_DIR pull --rebase\` and run it again"
    else
      wk_warn "$prefix: the uncommitted changes in $WK_HOME_DIR conflict with what its upstream now carries, and putting the tree back did not finish; the changes are safe in \`git -C $WK_HOME_DIR stash list\`; settle it by hand"
    fi
    return 1
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

# The clone's own heal, the committed kit's `standards.sh --home` (README § The
# home repo's lifecycle, step 14). Every failure is a named warning and exit 0.
# Usage: wk_home_heal [--quiet]
#   --quiet prints the heal's lines only when it failed or changed something.
wk_home_heal() {
  local quiet=0 rc=0 out changed=0 scratch kit
  [[ "${1:-}" == '--quiet' ]] && quiet=1
  wk_home_ready || {
    wk_warn "home: nothing is cloned at $WK_HOME_DIR; the home repo's labels and issue templates were not healed; \`workkit setup\` clones it"
    return 0
  }
  [[ -n "$WK_KIT_DIR" && -d "$WK_KIT_DIR" ]] || {
    wk_warn "home: the kit could not be resolved beside this engine; the home repo's labels and issue templates were not healed"
    return 0
  }
  scratch="$(mktemp -d)" || {
    wk_warn "home: could not make a scratch directory; the home repo's labels and issue templates were not healed"
    return 0
  }
  # The heal, its templates and its labels all come from the one export.
  kit="$(wk_home_source "$scratch" "$WK_KIT_DIR")" || {
    wk_warn "home: the home repo's labels and issue templates were not healed"
    rm -rf "$scratch"
    return 0
  }
  [[ -f "$kit/workflow/standards.sh" ]] || {
    wk_warn "home: the heal is missing at $kit/workflow/standards.sh; the home repo's labels and issue templates were not healed"
    rm -rf "$scratch"
    return 0
  }

  # Captured, so a quiet run can decide whether there is anything to say.
  out="$(bash "$kit/workflow/standards.sh" --home "$WK_HOME_DIR" 2>&1)" || rc=$?
  rm -rf "$scratch"

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
