#!/usr/bin/env bash
# workflow/workkit/proof.sh: `proof`, the red proof a pair's verifier runs
# (docs/agents.md § Crew sizing). Sourced by workkit.sh, functions only; the
# subcommand is its script in proof/, which speaks for itself.

# workkit proof red [--live] <path>... -- <command>...
cmd_proof() {
  local sub="${1:-}"
  case "$sub" in
    red) shift ;;
    *) wk_error "proof: unknown subcommand ${sub:-(none)}; use red"; return 1 ;;
  esac
  run_verb proof "$sub" "$@"
}
