#!/usr/bin/env bash
# workflow/workkit/setup.sh: `setup`, the wizard that runs every step in its
# order, and the two global-layer steps beside it: the roster report `doctor`
# prints too, and the home repo's setup. Sourced by workkit.sh, functions only;
# every name it reads is the entry's, and the steps it calls live in the other
# pieces.

# The global layer, reported and never written: how many repos this machine has
# registered in the roster (the engine maintains it on every heal), and whether a
# home repo is named for the work that belongs to no single repo.
report_globals() {
  local count home

  # The roster's address is the engine's (WK_HOME_REPOS in lib.sh), so a
  # checkout without the library cannot name it.
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_skip "roster: the engine library is missing beside $SCRIPT_DIR; this engine cannot name the roster"
    return 0
  fi
  if [[ ! -f "$WK_HOME_REPOS" ]]; then
    wk_info "roster: $WK_HOME_REPOS does not exist yet; the first heal writes it"
    return 0
  fi
  # A count it cannot take (no jq) is a count it says nothing about.
  if ! command -v jq >/dev/null 2>&1; then
    wk_skip "roster: reading $WK_HOME_REPOS needs jq"
    return 0
  fi

  count="$(wk_jq -r '[(.repos // {}) | to_entries[] | select(.value != "declined")] | length' "$WK_HOME_REPOS" 2>/dev/null || printf '')"
  if [[ -z "$count" ]]; then
    wk_warn "roster: $WK_HOME_REPOS is not valid JSON; fix or remove it, then re-run a session in any repo"
    return 0
  fi
  # Zero is the one count worth a different voice: an empty roster means the
  # tower, the board and the brief have nothing to read.
  if [[ "$count" == "0" ]]; then
    wk_info "roster: no repos registered in $WK_HOME_REPOS yet; it fills as a session opens in each enabled repo"
  else
    wk_ok "roster: $count repo(s) registered in $WK_HOME_REPOS"
  fi

}

# The home repo half of setup: the private repo, the clone at ~/.workkit/tower,
# the tower project seeded into it, its dependencies, Discussions and Pages. A
# machine without the libraries (an incomplete checkout) is told which command
# to run once it has them, rather than silently getting no home.
home_steps() {
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_warn "home: the home-repo library is missing beside $SCRIPT_DIR; the kit is incomplete"
    return 0
  fi
  wk_home_setup
}

cmd_setup() {
  case "${1:-}" in
    --token)
      wk_title "🔑 workkit setup --token: the cloud brief's Claude token"
      token_step
      return 0
      ;;
    '') ;;
    *) wk_error "setup: unknown option $1"; return 1 ;;
  esac

  wk_title "🧰 workkit setup in $KIT_DIR"

  wk_section "💻 This machine"
  install_plugin
  check_gh
  refresh_engine_link
  link_command
  script_shell
  install_cron
  # The tower pointer is about this machine's dashboard, not the repo the shell
  # stands in: it lives here, not under "This repo".
  tower_pointer

  wk_section "🏠 Home repo"
  home_steps

  wk_section "🔑 Cloud brief secrets"
  # After the home steps, because the repo it writes to is the home repo they
  # settle.
  secrets_step

  wk_section "🌐 Dashboard site"
  offer_site_publish
  # The switch ends on, so setup publishes, then hands the token over; off or
  # unanswered adds no call, leaving publish.sh's gate the one refusal.
  if [[ "$SITE_PUBLISH" == 'true' ]]; then
    cmd_publish
    # A token handed to an unfinished publish is handed to a stale site.
    # cmd_publish never fails a run, so PUBLISH_FAILED is what says it finished.
    if [[ "$PUBLISH_FAILED" -eq 0 ]]; then
      handover_token
    else
      wk_skip "site: the token handover waits for a publish that finished"
    fi
  fi

  wk_section "📁 This repo"
  offer_repo
  wk_done "Setup is idempotent: re-run it any time. \`workkit doctor\` reports what is left."
}
