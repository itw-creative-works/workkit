#!/usr/bin/env bash
# workflow/workkit/commands.sh: the other five commands the dispatch names,
# `update`, `publish`, `brief`, `test` and `doctor`. Sourced by workkit.sh, functions
# only; every name it reads, and the QUIET and PUBLISH_FAILED it sets, are the
# entry's.

cmd_update() {
  case "${1:-}" in
    --auto) QUIET=1 ;;
    '') ;;
    *) wk_error "update: unknown option $1"; return 1 ;;
  esac

  wk_title "🔄 workkit update in $KIT_DIR"
  refresh_engine_link
  link_command
  link_gh_shim
  script_shell
  update_cron
  # Reported, never wired: the daily --auto run is the one path that must not
  # prompt or mint, so a missing value is a line and nothing else.
  secrets_report update || true
  # The daily --auto run links the gh shim on a machine set up before the
  # identity shipped, and this line is how that machine hears it must sign in.
  # The ok line is stdout and --auto drops it; the warning rides stderr.
  if [[ "$QUIET" -eq 1 ]]; then
    identity_report machine >/dev/null || true
  else
    identity_report machine || true
  fi

  # A human's update republishes from this checkout, so a shipped tower change
  # reaches the site; --auto leaves that to the daily job.
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
    wk_warn "site: publish.sh is missing at $PUBLISH; the kit is incomplete"
    PUBLISH_FAILED=1
    return 0
  fi
  bash "$PUBLISH" "$@" || { wk_warn "site: the publish did not finish; run \`bash $PUBLISH\` to see why"; PUBLISH_FAILED=1; }
  return 0
}

# Today's brief, asked for now: the scheduled morning's own dispatch, except
# that a refusal fails the command. `--local` is the full local rehearsal.
cmd_brief() {
  if [[ "${1:-}" == '--local' ]]; then
    if [[ ! -f "$MORNING" ]]; then
      wk_error "no morning job beside this engine ($MORNING), and this command needs the whole kit"
      exit 1
    fi
    exec bash "$MORNING" --now
  fi
  if [[ $# -gt 0 ]]; then
    wk_error "brief takes --local or nothing, not $1"
    exit 1
  fi
  if [[ ! -f "$BRIEF_DISPATCH" ]]; then
    wk_error "no brief dispatch beside this engine ($BRIEF_DISPATCH), and this command needs the whole kit"
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

# The kit's test runner over the repo the command stands in, the suite paths
# narrowing it as `npm test -- <paths>` does. The engine is exported so the
# repo's test/lib re-exports resolve the same kit copy as the runner.
cmd_test() {
  if ! command -v node >/dev/null 2>&1; then
    wk_error "test: the runner needs node, and there is none on PATH"
    exit 1
  fi
  export WORKKIT_ENGINE="$SCRIPT_DIR"
  # The repo root as prove finds it, so the verb runs the same from any folder.
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"
  exec node "$TEST_RUNNER" --root "$root" -- "$@"
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

  local linked
  linked="$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)"
  if [[ -L "$ENGINE_LINK" && "$linked" == "$SCRIPT_DIR" ]]; then
    wk_ok "engine: $ENGINE_LINK → $SCRIPT_DIR"
  elif [[ -L "$ENGINE_LINK" && -n "$linked" ]] && wk_clone_outranks "$KIT_DIR" "$linked"; then
    wk_ok "engine: $ENGINE_LINK → $linked, the workkit clone, which outranks the plugin cache"
  else
    wk_warn "engine: $ENGINE_LINK does not point at this engine; run \`workkit update\`"
    attention=$((attention + 1))
  fi

  if report_bin_link "$SCRIPT_DIR/workkit.sh" "$BIN_LINK" command; then
    case ":${PATH:-}:" in
      *":$BIN_DIR:"*) ;;
      *) wk_warn "command: $BIN_DIR is not on your PATH; add \`export PATH=\"\$HOME/.local/bin:\$PATH\"\` to your shell rc"
         attention=$((attention + 1)) ;;
    esac
  else
    attention=$((attention + 1))
  fi
  if report_bin_link "$SCRIPT_DIR/identity/gh" "$GH_SHIM_LINK" 'gh shim' "$GH_SHIM_OURS"; then
    # The shim only runs when the gh PATH finds is the link itself.
    local first_gh
    first_gh="$(command -v gh 2>/dev/null || true)"
    if [[ -n "$first_gh" && "$(wk_physical_path "$first_gh")" != "$(wk_physical_path "$GH_SHIM_LINK")" ]]; then
      wk_warn "gh shim: $first_gh comes first on PATH, so the shim never runs; put ~/.local/bin ahead of it"
      attention=$((attention + 1))
    fi
  else
    attention=$((attention + 1))
  fi

  script_shell doctor || attention=$((attention + 1))

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

  local identity_attention=0
  identity_report machine || identity_attention=$?
  attention=$((attention + identity_attention))

  report_globals

  # The home repo: whether one is named, whether the folder is its clone, and
  # where that clone stands against its upstream.
  wk_section "🏠 Home repo"
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_warn "home: the home-repo library is missing beside $SCRIPT_DIR; the kit is incomplete"
    attention=$((attention + 1))
  else
    local home_attention=0
    wk_home_doctor || home_attention=$?
    attention=$((attention + home_attention))
    # The seeded cloud runner drifts on a `git pull` of this checkout; doctor
    # reports what the last morning could not heal.
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
  state="$(repo_state)"
  case "$state" in
    enabled) wk_ok "repo: $PWD is in the workflow" ;;
    nogit)   wk_skip "repo: $PWD is not a git repo" ;;
    *)       wk_info "repo: $PWD is '$state'; \`workkit enable\` joins it" ;;
  esac
  identity_attention=0
  identity_report repo || identity_attention=$?
  attention=$((attention + identity_attention))

  if [[ "$attention" -gt 0 ]]; then
    wk_warn "$attention item(s) need attention: the command to fix each is above."
  else
    wk_done "Everything this command can see is current."
  fi
}
