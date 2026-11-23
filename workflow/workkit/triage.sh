#!/usr/bin/env bash
# workflow/workkit/triage.sh: `triage`, the marker the workkit:triage skill
# writes before it drains a capture file (docs/hooks.md, safety:capture-guard).
# Sourced by workkit.sh, functions only; the subcommand is its script in
# triage/, which speaks for itself.

# workkit triage mark. It requires the kit's ES modules, so it runs under a node
# at the floor.
cmd_triage() {
  local sub="${1:-}"
  case "$sub" in
    mark) shift; run_at_floor triage-marker 1 "$SCRIPT_DIR/triage/mark.js" "$@" ;;
    *) wk_error "triage: unknown subcommand ${sub:-(none)}; use mark"; return 1 ;;
  esac
}
