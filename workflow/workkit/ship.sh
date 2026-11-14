#!/usr/bin/env bash
# workflow/workkit/ship.sh: `ship`, the ship's steps the workkit:ship skill
# runs (workflow/README.md, the ship/ rows). Sourced by workkit.sh, the verb
# list and functions only; each subcommand is its script in ship/, which speaks for itself.

# The ship's subcommands, the kit's one list: allow.sh builds its allow rules from it.
SHIP_VERBS=(items release watch cut plan publish deploy)

# workkit ship items | release <x.y.z> [--keep N,M] | watch <sha> | cut <x.y.z> | plan | publish | deploy
cmd_ship() {
  local sub="${1:-}" verb list
  for verb in "${SHIP_VERBS[@]}"; do
    if [[ "$sub" == "$verb" ]]; then
      shift
      run_verb ship "$sub" "$@"
      return
    fi
  done
  # The list as a sentence, read off SHIP_VERBS: `a, b or c`.
  list="$(printf '%s, ' "${SHIP_VERBS[@]:0:${#SHIP_VERBS[@]}-1}")"
  wk_error "ship: unknown subcommand ${sub:-(none)}; use ${list%, } or ${SHIP_VERBS[${#SHIP_VERBS[@]}-1]}"
  return 1
}
