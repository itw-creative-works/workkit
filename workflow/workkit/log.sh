#!/usr/bin/env bash
# workflow/workkit/log.sh: `log`, the hooks log the loader writes, one line per
# hook fire (docs/hooks.md § The hooks log). Sourced by workkit.sh, functions
# only; the path is wk_hooks_log's (lib/platform.sh), the one library it needs.

# workkit log [-n N] [--follow]: the log's last N lines, 40 unless -n says;
# --follow keeps printing what the hooks append.
cmd_log() {
  local lines=40 follow=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -n)
        [[ "${2:-}" =~ ^[0-9]+$ ]] || { wk_error "log: -n takes a number of lines"; return 1; }
        lines="$2"
        shift 2
        ;;
      --follow) follow=1; shift ;;
      *) wk_error "log: unknown option $1"; return 1 ;;
    esac
  done

  # The log's address is the engine's folder (wk_user_dir in lib/platform.sh).
  if ! declare -F wk_hooks_log >/dev/null; then
    wk_error "log: the engine library is missing beside $SCRIPT_DIR; this engine cannot name the hooks log"
    return 1
  fi
  wk_hooks_log
  if [[ ! -f "$WK_HOOKS_LOG" ]]; then
    wk_skip "log: no hooks log at $WK_HOOKS_LOG yet; the first hook fire writes it"
    return 0
  fi
  if [[ "$follow" -eq 1 ]]; then
    exec tail -n "$lines" -f "$WK_HOOKS_LOG"
  fi
  tail -n "$lines" "$WK_HOOKS_LOG"
}
