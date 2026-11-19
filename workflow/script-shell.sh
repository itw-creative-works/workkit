#!/usr/bin/env bash
# workflow/script-shell.sh: npm's script shell, once `npm config set
# script-shell` names it. A `test` event is script-shell.js, under a node at the
# kit's floor; an install-time script is followed by the hooks' re-point; any
# other is plain sh, with nothing sourced and no node started.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

# install_repoint: after an install-time script, which may set core.hooksPath
# itself (husky's prepare), the kit's hooks are put back through the heal's own
# step, in an opted-in repo, whoever runs npm. Its line is the only output.
install_repoint() {
  local root
  root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || return 0
  [ -e "$root/.workkit/settings.json" ] || return 0
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  # shellcheck source=./lib/platform.sh
  . "$SCRIPT_DIR/lib/platform.sh"
  # shellcheck source=./lib/participation.sh
  . "$SCRIPT_DIR/lib/participation.sh"
  wk_opted_in "$root" || return 0
  # shellcheck source=./lib.sh
  . "$SCRIPT_DIR/lib.sh"
  # shellcheck source=./standards/githooks.sh
  . "$SCRIPT_DIR/standards/githooks.sh"
  needs_attention=0 WK_LOG_STDERR=1
  git_hooks_installed "$root" >/dev/null || ensure_git_hooks "$root"
}

main() {
  case "${npm_lifecycle_event:-}" in
    test)
      SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
      # shellcheck source=./lib/platform.sh
      . "$SCRIPT_DIR/lib/platform.sh"
      run_at_floor script-shell 1 "$SCRIPT_DIR/script-shell.js" "$@"
      ;;
    prepare|install|postinstall)
      rc=0
      sh "$@" || rc=$?
      install_repoint
      exit "$rc"
      ;;
    *) exec sh "$@" ;;
  esac
}

main "$@"
