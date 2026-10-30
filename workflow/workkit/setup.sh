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
    wk_warn "roster: $WK_HOME_REPOS cannot be read as JSON (unreadable or not valid JSON); fix or remove it, then re-run a session in any repo"
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
# to run once it has them, rather than silently getting no home; forced, that
# is a failure, as every stop of `setup --home` is.
home_steps() {
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_warn "home: the home-repo library is missing beside $SCRIPT_DIR; the kit is incomplete"
    [[ -z "${1:-}" ]]
    return
  fi
  wk_home_setup "$@"
}

# cloud_na <step>: a step a cloud session has no use for, one line in the skip
# voice labelled by the step (`signin` by identity), counted by nothing. The table
# holds every not-applicable reason, one shared wherever setup, update and doctor
# print the same step.
cloud_na() {
  local why label="$1"
  case "$1" in
    plugin)   why="the session installs plugins from its settings" ;;
    schedule) why="the 9am job is a Mac's launchd" ;;
    tower)    why="the dashboard runs on your own machine" ;;
    home)     why="the home repo is cloned on your own machine" ;;
    runner)   why="the cloud brief's runner is compared on your own machine" ;;
    secrets)  why="the cloud brief's secrets are set from your own machine" ;;
    site)     why="publishing runs from your own machine" ;;
    repo)     why="a repo joins through its committed .workkit/settings.json" ;;
    identity) why="workkit-agent[bot]'s install is an owner's click on GitHub" ;;
    signin)   why="the session's GitHub proxy signs every call as the account"; label=identity ;;
    *) wk_error "cloud_na: no reason for $1"; return 1 ;;
  esac
  wk_skip "$label: not applicable in a cloud session; $why"
}

# setup --cloud: the gh login check, the links and npm's script-shell as update
# makes them. Every other step is one cloud_na line; it asks nothing and opens
# nothing.
cloud_steps() {
  wk_section "💻 This machine"
  cloud_na plugin
  check_gh || true
  machine_links
  cloud_na schedule
  cloud_na tower

  wk_section "🏠 Home repo"
  cloud_na home

  wk_section "🔑 Cloud brief secrets"
  cloud_na secrets

  wk_section "🪪 Identity"
  identity_report machine

  wk_section "🌐 Dashboard site"
  cloud_na site

  wk_section "📁 This repo"
  cloud_na repo
  cloud_na identity
}

cmd_setup() {
  case "${1:-}" in
    --token)
      wk_title "🔑 workkit setup --token: the cloud brief's Claude token"
      token_step
      return 0
      ;;
    --login)
      wk_title "🪪 workkit setup --login: the bot identity's sign-in"
      identity_step force || return 1
      return 0
      ;;
    --bot)
      wk_title "🤖 workkit setup --bot: workkit-agent[bot]'s install on this repo's owner"
      identity_install_step force || return 1
      return 0
      ;;
    --home)
      wk_title "🏠 workkit setup --home: the home repo"
      home_steps force || return 1
      return 0
      ;;
    --cloud)
      wk_title "☁️ workkit setup --cloud: this cloud session"
      cloud_steps
      return 0
      ;;
    '') ;;
    *) wk_error "setup: unknown option $1"; return 1 ;;
  esac

  wk_title "🧰 workkit setup in $KIT_DIR"

  wk_section "💻 This machine"
  install_plugin
  check_gh || true
  machine_links
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

  wk_section "🪪 Identity"
  identity_step

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
  identity_install_step
  wk_done "Setup is idempotent: re-run it any time. \`workkit doctor\` reports what is left."
}
