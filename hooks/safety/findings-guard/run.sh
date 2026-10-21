#!/bin/bash
# safety/findings-guard: PreToolUse hook (Bash). Holds the ship's review-notes
# issue to findings.file: a `gh issue create` whose title starts `review notes
# from` bounces while the setting reads anything but true, so the off default
# holds on the ship path. Scope: docs/hooks.md § safety:findings-guard.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

PHRASE="review notes from"

# Two literal tests on the raw command first, so a command that cannot be the
# create never reaches the clause walk. ASCII folding only: the phrase is ASCII.
hook_gh_names "$cmd" create || exit 0
case "$(printf '%s' "$cmd" | LC_ALL=C tr '[:upper:]' '[:lower:]')" in
  *"$PHRASE"*) ;;
  *) exit 0 ;;
esac

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

block() {
  {
    echo "findings-guard: BLOCKED this gh issue create: a review notes issue files findings, and findings.file is not on for this repo."
    echo "$(hook_findings_route "$cwd") findings.file: true in the settings file (the repo's .workkit/settings.json, or ~/.workkit/settings.json) turns filing on."
  } >&2
  exit 2
}

# A heredoc body is file content, never a clause, and the & of a redirect never
# splits one. The title is read off each create clause's raw shell words, where
# a quoted span stays inside its word.
src=$(hook_strip_heredocs "$cmd")
src=$(hook_fold_redirect_amp "$src")
while IFS= read -r clause; do
  [ -n "$clause" ] || continue
  hook_gh_names "$(hook_strip_quotes "$clause")" create || continue
  while IFS= read -r title; do
    [ -n "$title" ] || continue
    title=$(hook_unquote_word "$title" | LC_ALL=C tr '[:upper:]' '[:lower:]')
    case "$title" in
      "$PHRASE"*)
        hook_findings_on "$cwd" && exit 0
        block
        ;;
    esac
  done <<TITLES
$(hook_gh_flag_values "$clause" --title -t)
TITLES
done <<CLAUSES
$(hook_gh_clauses "$src")
CLAUSES

exit 0
