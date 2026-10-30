#!/usr/bin/env bash
# workflow/workkit/changelog.sh: `changelog`, the CHANGELOG entry format's
# linter (docs/project-state.md § CHANGELOG entries). Sourced by workkit.sh,
# functions only; the subcommand is its script in changelog/, which speaks for
# itself.

# workkit changelog lint <file> [--added-only] [--staged] [--unreleased-only]
cmd_changelog() {
  local sub="${1:-}"
  case "$sub" in
    lint) shift ;;
    *) wk_error "changelog: unknown subcommand ${sub:-(none)}; use lint"; return 1 ;;
  esac
  run_verb changelog "$sub" "$@"
}
