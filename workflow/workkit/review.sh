#!/usr/bin/env bash
# workflow/workkit/review.sh: `review`, the review markers the workkit:review
# and workkit:ship skills write and read (docs/hooks.md, safety:commit-gate).
# Sourced by workkit.sh, functions only; each subcommand is its script in
# review/, which speaks for itself.

# workkit review covers | mark [full]
cmd_review() {
  local sub="${1:-}"
  case "$sub" in
    covers|mark) shift ;;
    *) wk_error "review: unknown subcommand ${sub:-(none)}; use covers or mark"; return 1 ;;
  esac
  run_verb review "$sub" "$@"
}
