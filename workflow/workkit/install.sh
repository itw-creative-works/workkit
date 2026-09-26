#!/usr/bin/env bash
# workflow/workkit/install.sh: setup's steps that check before they act on
# this machine and this repo: the plugin, the gh login, the tower pointer, and
# the repo the shell stands in. SOURCED by workkit.sh, never executed, and it
# runs nothing at load: it defines functions and sets nothing. Every name it
# reads (KIT_DIR, PLUGIN_ID, STANDARDS, the `interactive` check) is the
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
# auth login` is a browser flow and a human's to run.
check_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    wk_warn "gh: not installed; the label heals and the board need it (https://cli.github.com)"
    return 0
  fi
  if wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1; then
    wk_skip "gh: installed and authenticated"
  else
    wk_warn "gh: installed but not authenticated; run \`gh auth login\`"
  fi
}

# The tower is started, never installed: it is two long-running processes and
# nothing schedules them. Setup's job is to say where they are.
tower_pointer() {
  wk_info "tower: mission control is \`workkit tower\`; the API on 8693 and the dashboard on 4300 together, replacing any previous instance"
}

# The repo the shell is standing in. Undecided is the only state with anything
# to ask, and the question is asked only where there is someone to answer it.
offer_repo() {
  local state
  state="$(bash "$STANDARDS" --state "$PWD" 2>/dev/null | tail -1 || printf 'nogit')"
  case "$state" in
    enabled)  wk_skip "repo: $PWD is in the workflow" ;;
    disabled) wk_skip "repo: $PWD has a committed no; leaving it alone" ;;
    nogit)    wk_skip "repo: $PWD is not a git repo; nothing to enable" ;;
    declined|undecided)
      if ! interactive; then
        wk_info "repo: $PWD is not in the workflow; \`workkit enable\` joins it"
        return 0
      fi
      printf 'Add %s to the issue workflow? [y/N] ' "$PWD"
      local answer=""
      read -r answer || true
      case "$answer" in
        y|Y|yes|YES) bash "$STANDARDS" --enable "$PWD" ;;
        *) wk_skip "repo: left as it is; \`workkit enable\` joins it later" ;;
      esac
      ;;
    *) wk_skip "repo: $PWD reports state '$state'; nothing to do" ;;
  esac
}
