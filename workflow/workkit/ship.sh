#!/usr/bin/env bash
# workflow/workkit/ship.sh: `ship`, the ship's steps the workkit:ship skill
# runs (workflow/README.md, the ship/ rows). Sourced by workkit.sh, functions
# only; each subcommand is its script in ship/, which speaks for itself.

# workkit ship items | release <x.y.z> [--keep N,M] | watch <sha> | plan | publish
cmd_ship() {
  local sub="${1:-}"
  case "$sub" in
    items|release|watch|plan|publish) shift ;;
    *) wk_error "ship: unknown subcommand ${sub:-(none)}; use items, release, watch, plan or publish"; return 1 ;;
  esac
  run_verb ship "$sub" "$@"
}
