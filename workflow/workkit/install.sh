#!/usr/bin/env bash
# workflow/workkit/install.sh: setup's steps that check before they act on
# this machine and this repo: the plugin, the gh login, the tower pointer, and
# the repo the shell stands in. Sourced by workkit.sh, functions only; KIT_DIR,
# PLUGIN_ID, STANDARDS, HOME_LIBS, SCRIPT_DIR and the `interactive` check are the
# entry's.

# The plugin, on a machine that may not have Claude Code at all. Detection first,
# because `marketplace add` on an installed marketplace is noise nobody needs to
# read; a missing `claude` is a named skip, never a failure: the engine, the
# schedule, and the capture CLI all work without it.
install_plugin() {
  if ! command -v claude >/dev/null 2>&1; then
    wk_skip "plugin: the claude CLI is not on this machine; skipping the plugin install"
    return 0
  fi
  if wk_spin 'reading the installed plugins' claude plugin list --json 2>/dev/null | grep -q "\"$PLUGIN_ID\""; then
    wk_skip "plugin: $PLUGIN_ID is installed"
    return 0
  fi
  wk_spin 'adding the marketplace' claude plugin marketplace add "$KIT_DIR" >/dev/null 2>&1 \
    || { wk_warn "plugin: \`claude plugin marketplace add $KIT_DIR\` did not finish; run it by hand"; return 0; }
  wk_spin "installing $PLUGIN_ID" claude plugin install "$PLUGIN_ID" >/dev/null 2>&1 \
    || { wk_warn "plugin: \`claude plugin install $PLUGIN_ID\` did not finish; run it by hand"; return 0; }
  wk_ok "plugin: installed $PLUGIN_ID from $KIT_DIR; it loads in a new session"
}

# gh is how the whole standard reaches its issues; an unauthenticated one turns
# the label heals, the board, and the brief into skips. Report, never fix: `gh
# auth login` is a browser flow and a human's to run. Returns 1 on a warning,
# which doctor counts.
check_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    wk_warn "gh: not installed; the label heals and the board need it (https://cli.github.com)"
    return 1
  fi
  local signed_in=0 login
  if wk_is_cloud; then
    # A cloud session's proxy answers REST alone, signed as the account.
    login="$(wk_spin 'checking the gh login' gh api user -q .login 2>/dev/null)" || login=''
    [[ -n "$login" ]] && signed_in=1
  elif wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1; then
    signed_in=1
  fi
  if [[ "$signed_in" -eq 1 ]]; then
    wk_skip "gh: installed and authenticated"
  else
    wk_warn "gh: installed but not authenticated; run \`gh auth login\`"
    return 1
  fi
}

# The tower is started, never installed: it is two long-running processes and
# nothing schedules them. Setup's job is to say where they are.
tower_pointer() {
  wk_info "tower: mission control is \`workkit tower\`; the API on 8693 and the dashboard on 4300 together, replacing any previous instance"
}

# The opt-in state of the repo the shell is standing in, as the engine reads it:
# enabled, disabled, declined, undecided, or nogit.
repo_state() {
  bash "$STANDARDS" --state "$PWD" 2>/dev/null | tail -1 || printf 'nogit'
}

# The repo the shell is standing in. Undecided is the only state with anything
# to ask, and the question is asked only where there is someone to answer it.
offer_repo() {
  local state
  # The question is the engine library's wk_ask_yes; without it there is none to ask.
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_skip "repo: the home-repo library is missing beside $SCRIPT_DIR; the kit is incomplete"
    return 0
  fi
  state="$(repo_state)"
  case "$state" in
    enabled)  wk_skip "repo: $PWD is in the workflow" ;;
    disabled) wk_skip "repo: $PWD has a committed no; leaving it alone" ;;
    nogit)    wk_skip "repo: $PWD is not a git repo; nothing to enable" ;;
    declined|undecided)
      if ! interactive; then
        wk_info "repo: $PWD is not in the workflow; \`workkit enable\` joins it"
        return 0
      fi
      if wk_ask_yes "Add $PWD to the issue workflow?" n; then
        bash "$STANDARDS" --enable "$PWD"
      else
        wk_skip "repo: left as it is; \`workkit enable\` joins it later"
      fi
      ;;
    *) wk_skip "repo: $PWD reports state '$state'; nothing to do" ;;
  esac
}
