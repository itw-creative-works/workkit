#!/usr/bin/env bash
# workflow/home/wizard.sh: the home half of `workkit setup`. Sourced by home.sh,
# functions only. WK_HOME_REPO_NAME is the entry's; WK_HOME_DIR is lib.sh's.

# Every failure warns and continues, except something already at the clone's
# path, which stops the rest: every later step would write into it.
wk_home_setup() {
  local login slug rc=0

  login="$(wk_home_login)" || true
  if [[ -z "$login" ]]; then
    wk_info "home: gh could not say who you are; run \`gh auth login\`, then \`workkit setup\` again to create the home repo"
    return 0
  fi
  slug="$login/$WK_HOME_REPO_NAME"

  # A non-interactive run prints what it would do and moves on.
  if [[ "$(wk_home_slug)" != "$slug" ]]; then
    if declare -f interactive >/dev/null 2>&1 && ! interactive; then
      wk_info "home: no home repo is configured; a terminal run of \`workkit setup\` creates the private $slug and makes $WK_HOME_DIR its clone"
      return 0
    fi
    printf 'Create the private home repo %s and make %s its clone? [y/N] ' "$slug" "$WK_HOME_DIR"
    local answer=''
    read -r answer || true
    case "$answer" in
      y|Y|yes|YES) ;;
      *) wk_skip "home: left as it is; \`workkit setup\` offers again"; return 0 ;;
    esac
  fi

  wk_home_ensure_repo "$slug" || rc=$?
  case "$rc" in
    0) wk_ok "home: created the private repo $slug" ;;
    2) wk_skip "home: $slug already exists; using it" ;;
    *) wk_warn "home: could not create $slug; \`gh repo create $slug --private\` reports why"; return 0 ;;
  esac

  rc=0
  wk_home_clone "$slug" || rc=$?
  # Neither 3 (something else at the path) nor 1 leaves anything safe to write.
  [[ "$rc" -eq 0 ]] || return 0

  wk_home_set_slug "$slug" >/dev/null 2>&1 || true

  # Only an empty clone is seeded; one carrying the project is left as it is.
  if wk_home_empty; then
    wk_home_seed || return 0
    wk_home_seed_runner || true
    wk_home_install
    wk_home_discussions "$slug"
    wk_home_pages "$slug"
    wk_home_commit_push 'chore(home): seed the tower project' || true
    wk_home_heal
    return 0
  fi

  wk_skip "home: the tower project is already in $WK_HOME_DIR"
  # The second machine's path: caught up first, so the runner refresh and the
  # heal push onto origin's tip. A clone that cannot catch up is left unwritten
  # (a stale base would commit what it can never push); only the GitHub-side
  # steps run, and the next setup finishes the job.
  if ! wk_home_catch_up home; then
    wk_skip "home: the clone in $WK_HOME_DIR was not written to; settle it and run \`workkit setup\` again for the runner refresh, the install and the heal"
    wk_home_discussions "$slug"
    wk_home_pages "$slug"
    return 0
  fi
  rc=0
  wk_home_seed_runner || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    wk_home_commit_push 'chore(home): refresh the cloud brief runner' || true
  fi
  wk_home_install
  wk_home_discussions "$slug"
  wk_home_pages "$slug"
  wk_home_heal
  return 0
}
