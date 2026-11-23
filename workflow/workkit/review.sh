#!/usr/bin/env bash
# workflow/workkit/review.sh: `review`, the review markers the workkit:review
# and workkit:ship skills write and read (docs/hooks.md, safety:commit-gate).
# Sourced by workkit.sh, functions only; each subcommand is its script in
# review/, which speaks for itself.

# workkit review covers | mark [full]. Each requires the kit's ES modules, so it
# runs under a node at the floor.
cmd_review() {
  local sub="${1:-}"
  case "$sub" in
    covers) shift; run_at_floor review-covers 2 "$SCRIPT_DIR/review/covers.js" "$@" ;;
    mark) shift; run_at_floor review-marker 1 "$SCRIPT_DIR/review/mark.js" "$@" ;;
    *) wk_error "review: unknown subcommand ${sub:-(none)}; use covers or mark"; return 1 ;;
  esac
}
