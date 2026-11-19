#!/usr/bin/env bash
# workflow/workkit/command-list.sh: the kit's one list of its commands, each with
# the permission its rule lands in, and its readers. Sourced by workkit.sh
# before every other piece, the list and functions only; it needs none of them.

# <command>=<permission>: allow keeps `Bash(workkit <command>:*)` at
# permissions.allow, ask at permissions.ask, none keeps no rule (a command
# that runs other code). The dispatch refuses a first word with no entry here.
WORKKIT_COMMANDS=(
  help=allow setup=allow update=allow doctor=allow publish=allow brief=allow log=allow
  test=none
  tools=allow convert=allow public=allow
  'ship items=allow' 'ship release=allow' 'ship watch=allow' 'ship cut=allow' 'ship plan=allow' 'ship publish=allow'
  'ship deploy=ask'
  review=allow triage=allow
  'proof red=none'
  changelog=allow tower=none enable=allow decline=allow heal=allow state=allow note=allow
  prove=none supervise=none
  watch=allow
)

# wk_commands_with <permission>: the commands with that permission, one per
# line in the list's order.
wk_commands_with() {
  local entry
  for entry in "${WORKKIT_COMMANDS[@]}"; do
    [[ "${entry##*=}" != "$1" ]] || printf '%s\n' "${entry%=*}"
  done
}

# wk_command_listed <word>: 0 when an entry's first word is <word>.
wk_command_listed() {
  local entry command
  for entry in "${WORKKIT_COMMANDS[@]}"; do
    command="${entry%=*}"
    [[ "${command%% *}" != "$1" ]] || return 0
  done
  return 1
}

# wk_command_verbs <word>: the second word of each entry whose first word is
# <word>, one per line in the list's order.
wk_command_verbs() {
  local entry command
  for entry in "${WORKKIT_COMMANDS[@]}"; do
    command="${entry%=*}"
    [[ "$command" != "$1 "* ]] || printf '%s\n' "${command#"$1" }"
  done
}
