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
  # It requires the kit's ES modules, so it runs under a node at the floor; its
  # 1 means green, so a missing node is a stop, 2.
  run_at_floor red-proof 2 "$SCRIPT_DIR/proof/red.js" "$@"
}
