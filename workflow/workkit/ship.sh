#!/usr/bin/env bash
# workflow/workkit/ship.sh: `ship`, the ship's steps the workkit:ship skill
# runs (workflow/README.md, the ship/ rows). Sourced by workkit.sh, the verb
# list and functions only; each subcommand is its script in ship/, which speaks for itself.

# The ship's subcommands, read off the `ship <verb>` entries of WORKKIT_COMMANDS
# (command-list.sh, sourced first) in their order.
SHIP_VERBS=()
while IFS= read -r _wk_verb; do
  SHIP_VERBS+=("$_wk_verb")
done < <(wk_command_verbs ship)
unset _wk_verb

# workkit ship items | release <x.y.z> [--keep N,M] | watch <sha> | cut <x.y.z> | plan | publish | deploy
cmd_ship() {
  local sub="${1:-}" verb list
  for verb in "${SHIP_VERBS[@]}"; do
    [[ "$sub" == "$verb" ]] || continue
    shift
    # These hand the terminal to npm publish (whose one-time password it may
    # ask), the deploy script or a ship hook (ship/publish.js, deploy.js, hooks.js).
    case "$sub" in
      cut|publish|deploy) wk_terminal_step "ship $sub" run_verb ship "$sub" "$@" ;;
      # These require the kit's ES modules, so they run under a node at the floor.
      watch) run_at_floor "ship watch" 1 "$SCRIPT_DIR/ship/watch.js" "$@" ;;
      items) run_at_floor ship-items 1 "$SCRIPT_DIR/ship/items.js" "$@" ;;
      *) run_verb ship "$sub" "$@" ;;
    esac
    return
  done
  # The list as a sentence, read off SHIP_VERBS: `a, b or c`.
  list="$(printf '%s, ' "${SHIP_VERBS[@]:0:${#SHIP_VERBS[@]}-1}")"
  wk_error "ship: unknown subcommand ${sub:-(none)}; use ${list%, } or ${SHIP_VERBS[${#SHIP_VERBS[@]}-1]}"
  return 1
}
