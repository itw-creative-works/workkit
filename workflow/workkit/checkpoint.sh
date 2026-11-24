#!/usr/bin/env bash
# workflow/workkit/checkpoint.sh: `checkpoint`, the marker the workkit:checkpoint
# skill writes when its run put every item on the board (docs/hooks.md).
# Sourced by workkit.sh, functions only; the subcommand is its script in
# checkpoint/, which speaks for itself.

# workkit checkpoint safe. It requires the kit's ES modules, so it runs under a
# node at the floor.
cmd_checkpoint() {
  local sub="${1:-}"
  case "$sub" in
    safe) shift; run_at_floor checkpoint-marker 1 "$SCRIPT_DIR/checkpoint/mark.js" "$@" ;;
    *) wk_error "checkpoint: unknown subcommand ${sub:-(none)}; use safe"; return 1 ;;
  esac
}
