#!/usr/bin/env bash
# workflow/workkit/public.sh: `public`, the pairing of a public issue repo with
# this private one (docs/project-state.md § Capture, the public pairing).
# Sourced by workkit.sh, functions only; each subcommand is its node script in
# public/, run from the shell's folder, which speaks for itself.

# workkit public intake | mirror <N>... | mirror --all | close <version> <N>...
cmd_public() {
  local sub="${1:-}"
  case "$sub" in
    intake|mirror|close) shift ;;
    *) wk_error "public: unknown subcommand ${sub:-(none)}; use intake, mirror or close"; return 1 ;;
  esac
  if ! command -v node >/dev/null 2>&1; then
    wk_error "public: the verb runs node, and there is no node on PATH"
    return 1
  fi
  exec node "$SCRIPT_DIR/public/$sub.js" "$@"
}
