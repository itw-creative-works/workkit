#!/usr/bin/env bash
# workflow/workkit/commands.sh: the other four commands the dispatch names,
# `update`, `publish`, `brief` and `doctor`. SOURCED by workkit.sh, never
# executed, and it runs nothing at load: it defines functions and sets nothing.
# Every name it reads (KIT_DIR, SCRIPT_DIR, STANDARDS, PUBLISH, MORNING,
# BRIEF_DISPATCH, PLUGIN_ID, ENGINE_LINK, BIN_DIR, BIN_LINK, DAILY_PLIST,
# DAILY_LABEL, HOME_LIBS) and the two it sets at run time (QUIET,
# PUBLISH_FAILED) are the entry's.

cmd_update() {
  case "${1:-}" in
    --auto) QUIET=1 ;;
    '') ;;
    *) wk_error "update: unknown option $1"; return 1 ;;
  esac

  wk_title "🔄 workkit update in $KIT_DIR"
  refresh_engine_link
  link_command
  update_cron
  # Reported, never wired: the daily --auto run is the one path that must not
  # prompt or mint, so a missing value is a line and nothing else.
  secrets_report update || true

  # The published site is rebuilt from THIS checkout, so a human's update is
  # also how a shipped tower improvement reaches it. The automatic path leaves
  # it alone: an app build at session start is minutes of work nobody asked for,
  # and the daily job publishes anyway.
  if [[ "$QUIET" -eq 1 ]]; then
    wk_skip "site: the daily job publishes it; \`workkit publish\` does it now"
  else
    cmd_publish
  fi
}

# The site publish, which is the engine's own script, named here so everything
# stays reachable from one command.
cmd_publish() {
  PUBLISH_FAILED=0
  if [[ ! -f "$PUBLISH" ]]; then
    wk_warn "site: publish.sh is missing at $PUBLISH; this checkout is incomplete"
    PUBLISH_FAILED=1
    return 0
  fi
  bash "$PUBLISH" "$@" || { wk_warn "site: the publish did not finish; run \`bash $PUBLISH\` to see why"; PUBLISH_FAILED=1; }
  return 0
}

# Today's brief, asked for now (issue #54). The scheduled morning dispatches the
# cloud run and this is that same dispatch, through the same one function: the
# difference is who is listening. Nine o'clock logs a refusal and carries on;
# a human standing at a terminal is told, and the command fails.
#
# `--local` is the rehearsal the job already has: the full local morning, with
# the brief composed and sent from this machine and never posted to the home
# repo. The morning's other steps still run where they can: the summaries can
# post their Discussion and the site publish still fires when it is switched on.
cmd_brief() {
  if [[ "${1:-}" == '--local' ]]; then
    if [[ ! -f "$MORNING" ]]; then
      wk_error "no morning job beside this engine ($MORNING), and this command needs the workkit checkout"
      exit 1
    fi
    exec bash "$MORNING" --now
  fi
  if [[ $# -gt 0 ]]; then
    wk_error "brief takes --local or nothing, not $1"
    exit 1
  fi
  if [[ ! -f "$BRIEF_DISPATCH" ]]; then
    wk_error "no brief dispatch beside this engine ($BRIEF_DISPATCH), and this command needs the workkit checkout"
    exit 1
  fi
  # shellcheck source=../../jobs/brief-dispatch.sh
  . "$BRIEF_DISPATCH"
  if ! dispatch_brief; then
    wk_warn "brief: the day could not be handed to the cloud; $DISPATCH_REASON"
    exit 1
  fi
  wk_ok "$DISPATCH_LINE"
  wk_info "watch it: https://github.com/$DISPATCH_SLUG/actions/workflows/$BRIEF_WORKFLOW"
}

cmd_doctor() {
  local attention=0
  wk_title "🩺 workkit doctor in $KIT_DIR"

  wk_section "💻 This machine"
  if command -v claude >/dev/null 2>&1; then
    if wk_spin 'reading the installed plugins' claude plugin list --json 2>/dev/null | grep -q "\"$PLUGIN_ID\""; then
      wk_ok "plugin: $PLUGIN_ID is installed"
    else
      wk_warn "plugin: $PLUGIN_ID is not installed; run \`workkit setup\`"
      attention=$((attention + 1))
    fi
  else
    wk_skip "plugin: no claude CLI on this machine"
  fi

  check_gh

  if [[ -L "$ENGINE_LINK" && "$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)" == "$SCRIPT_DIR" ]]; then
    wk_ok "engine: $ENGINE_LINK → $SCRIPT_DIR"
  else
    wk_warn "engine: $ENGINE_LINK does not point at this checkout; run \`workkit update\`"
    attention=$((attention + 1))
  fi

  if [[ -L "$BIN_LINK" && "$(readlink "$BIN_LINK" || true)" == "$SCRIPT_DIR/workkit.sh" ]]; then
    wk_ok "command: $BIN_LINK → $SCRIPT_DIR/workkit.sh"
    case ":${PATH:-}:" in
      *":$BIN_DIR:"*) ;;
      *) wk_warn "command: $BIN_DIR is not on your PATH; add \`export PATH=\"\$HOME/.local/bin:\$PATH\"\` to your shell rc"
         attention=$((attention + 1)) ;;
    esac
  else
    wk_warn "command: $BIN_LINK is missing or points elsewhere; run \`workkit update\`"
    attention=$((attention + 1))
  fi

  if [[ "$(uname -s)" != "Darwin" ]]; then
    wk_skip "schedule: launchd is macOS"
  elif [[ ! -f "$DAILY_PLIST" ]]; then
    wk_warn "schedule: the 9am job is not installed; run \`workkit setup\`"
    attention=$((attention + 1))
  else
    local drift
    if ! drift="$(cron_drift)"; then
      wk_warn "schedule: $drift"
      attention=$((attention + 1))
    elif [[ -z "$drift" ]]; then
      wk_ok "schedule: $DAILY_LABEL is installed and current"
    else
      printf '%s\n' "$drift" | while IFS= read -r line; do
        wk_warn "schedule: $line; run \`workkit update\`"
      done
      attention=$((attention + 1))
    fi
  fi

  report_globals

  # The home repo: whether one is named, whether the folder is its clone, and
  # where that clone stands against its upstream.
  wk_section "🏠 Home repo"
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_warn "home: the home-repo library is missing beside $SCRIPT_DIR; this checkout is incomplete"
    attention=$((attention + 1))
  else
    local home_attention=0
    wk_home_doctor || home_attention=$?
    attention=$((attention + home_attention))
    # The seeded cloud runner drifts on a `git pull` of this checkout, and only
    # `setup` writes it back, so doctor is the one place that can notice.
    local runner_attention=0
    wk_home_runner_doctor || runner_attention=$?
    attention=$((attention + runner_attention))
  fi

  wk_section "🔑 Cloud brief secrets"
  local secrets_attention=0
  secrets_report doctor || secrets_attention=$?
  attention=$((attention + secrets_attention))

  wk_section "📁 This repo"
  local state
  state="$(bash "$STANDARDS" --state "$PWD" 2>/dev/null | tail -1 || printf 'nogit')"
  case "$state" in
    enabled) wk_ok "repo: $PWD is in the workflow" ;;
    nogit)   wk_skip "repo: $PWD is not a git repo" ;;
    *)       wk_info "repo: $PWD is '$state'; \`workkit enable\` joins it" ;;
  esac

  if [[ "$attention" -gt 0 ]]; then
    wk_warn "$attention item(s) need attention: the command to fix each is above."
  else
    wk_done "Everything this command can see is current."
  fi
}
