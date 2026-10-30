#!/usr/bin/env bash
# workflow/workkit/triage.sh: `triage`, the marker the workkit:triage skill
# writes before it drains a capture file (docs/hooks.md, safety:capture-guard).
# Sourced by workkit.sh, functions only; the subcommand is its script in
# triage/, which speaks for itself.

# workkit triage mark
cmd_triage() {
  local sub="${1:-}"
  case "$sub" in
    mark) shift ;;
    *) wk_error "triage: unknown subcommand ${sub:-(none)}; use mark"; return 1 ;;
  esac
  run_verb triage "$sub" "$@"
}
