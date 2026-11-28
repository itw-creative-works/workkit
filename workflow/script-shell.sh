#!/usr/bin/env bash
# workflow/script-shell.sh: npm's script shell, once `npm config set
# script-shell` names it. A `test` event is script-shell.js, under the node npm
# runs on; an install-time script is followed by its `--git-hooks`; any other is
# plain sh, with nothing sourced and no node started.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

# here: this file's folder, physical, where script-shell.js sits.
here() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P
}

# hooks_back: after an install-time script, which may set core.hooksPath itself
# (husky's prepare), script-shell.js puts the kit's hooks back. A repo with no
# .workkit/settings.json at its root starts no node.
hooks_back() {
  local root
  root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -e "$root/.workkit/settings.json" ] || return 0
  "${npm_node_execpath:-node}" "$(here)/script-shell.js" --git-hooks
}

main() {
  case "${npm_lifecycle_event:-}" in
    test) exec "${npm_node_execpath:-node}" "$(here)/script-shell.js" "$@" ;;
    prepare|install|postinstall)
      rc=0
      sh "$@" || rc=$?
      hooks_back
      exit "$rc"
      ;;
    *) exec sh "$@" ;;
  esac
}

main "$@"
