#!/usr/bin/env bash
# jobs/brief-dispatch.sh: hands the day to the cloud, a `workflow_dispatch` of
# brief.yml on the home repo. Sourced by the scheduled morning and by `workkit
# brief`; it prints nothing, sets DISPATCH_REASON or DISPATCH_LINE, and each
# caller decides what a refusal is worth. It resolves the engine from its own
# location, so any command can source it.
#
# Usage: . jobs/brief-dispatch.sh
#   if dispatch_brief; then echo "$DISPATCH_LINE"; else echo "$DISPATCH_REASON"; fi

# Both callers have wk_spin from workflow/lib.sh; a caller that sourced this
# file alone gets the plain pass-through instead of a command not found.
if ! declare -f wk_spin >/dev/null 2>&1; then
  wk_spin() { shift; "$@"; }
fi

# The workflow on the home repo that runs the morning on a runner. The dispatch
# below names it; `workkit setup` seeds it as .github/workflows/brief.yml.
BRIEF_WORKFLOW='brief.yml'

# The engine beside this file: the same folder in a checkout and in the runner
# tree setup seeds. Resolve before any cd: BASH_SOURCE may be a relative path.
WK_DISPATCH_ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../workflow" 2>/dev/null && pwd || printf '%s' "$(dirname "${BASH_SOURCE[0]}")/../workflow")"

# Every reason the dispatch cannot be made is a named one: nothing is composed
# anywhere to cover for it (jobs/README.md § The morning on this machine).
DISPATCH_REASON=''
DISPATCH_LINE=''
# The home repo this dispatch was made against: what a caller points a human at
# to go and watch the run.
DISPATCH_SLUG=''
dispatch_brief() {
  local slug secrets
  if [[ ! -f "$WK_DISPATCH_ENGINE/lib.sh" || ! -f "$WK_DISPATCH_ENGINE/home.sh" ]]; then
    DISPATCH_REASON="the engine's home-repo library is missing at $WK_DISPATCH_ENGINE"
    return 1
  fi
  if ! command -v gh >/dev/null 2>&1; then
    DISPATCH_REASON='gh is not on this machine'
    return 1
  fi
  # In a subshell: this is one read of a helper, and sourcing the engine into
  # the job's own shell for it would leak its every function and address.
  slug="$(. "$WK_DISPATCH_ENGINE/lib.sh"; . "$WK_DISPATCH_ENGINE/home.sh"; wk_home_slug)" || slug=''
  if [[ -z "$slug" ]]; then
    DISPATCH_REASON='no home repo is configured; `workkit setup` creates it'
    return 1
  fi
  DISPATCH_SLUG="$slug"
  # A dispatch succeeds the moment the workflow is on the default branch, so both
  # secrets are checked first, in one listing. A failed listing and an empty one
  # are different mornings: a repo this token cannot read, and one with none.
  if ! secrets="$(wk_spin "reading the secrets on $slug" gh secret list --repo "$slug" 2>/dev/null)"; then
    DISPATCH_REASON="the secrets on $slug could not be listed"
    return 1
  fi
  if [[ -z "$secrets" ]]; then
    DISPATCH_REASON="$slug carries no secrets; \`workkit setup\` wires both"
    return 1
  fi
  if ! grep -qE '^CLAUDE_CODE_OAUTH_TOKEN([[:space:]]|$)' <<<"$secrets"; then
    DISPATCH_REASON="$slug does not carry CLAUDE_CODE_OAUTH_TOKEN; a runner without it composes nothing"
    return 1
  fi
  if ! grep -qE '^WORKKIT_GITHUB_TOKEN([[:space:]]|$)' <<<"$secrets"; then
    DISPATCH_REASON="$slug does not carry WORKKIT_GITHUB_TOKEN; a runner without it sweeps no board"
    return 1
  fi
  if ! wk_spin "dispatching $BRIEF_WORKFLOW on $slug" gh workflow run "$BRIEF_WORKFLOW" --repo "$slug" >/dev/null 2>&1; then
    DISPATCH_REASON="gh workflow run $BRIEF_WORKFLOW on $slug did not land"
    return 1
  fi
  DISPATCH_LINE="brief: dispatched $BRIEF_WORKFLOW on $slug; the cloud runner composes and publishes today's brief"
  return 0
}
