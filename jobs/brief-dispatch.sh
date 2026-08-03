#!/usr/bin/env bash
# jobs/brief-dispatch.sh — handing the day to the cloud. SOURCED, never executed.
#
# The one home of "dispatch today's brief on the home repo", and it has two
# callers: the scheduled morning (`jobs/morning.sh`), where a refusal is a logged
# line and an exit 0, and `workkit brief`, where a human asked for it now and a
# refusal is loud. The FUNCTION decides nothing about the run — it sets the
# reason or the line and returns a status; each caller decides what that is
# worth.
#
# It sets no shell options and runs nothing at load. The engine libraries it
# needs are sourced inside a subshell in the function, so nothing it reads leaks
# into the caller's shell — and it resolves the engine from its OWN location
# rather than from the caller's, which is what lets a command that knows nothing
# about the 9am job source it and call it.
#
# Usage:
#   . jobs/brief-dispatch.sh
#   if dispatch_brief; then echo "$DISPATCH_LINE"; else echo "$DISPATCH_REASON"; fi

# The workflow on the home repo that runs the morning on a runner. The dispatch
# below names it; `workkit setup` seeds it as .github/workflows/brief.yml.
BRIEF_WORKFLOW='brief.yml'

# The engine beside this file — the same folder in a checkout and in the runner
# tree setup seeds. Resolve before any cd: BASH_SOURCE may be a relative path.
WK_DISPATCH_ENGINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../workflow" 2>/dev/null && pwd || printf '%s' "$(dirname "${BASH_SOURCE[0]}")/../workflow")"

# The scheduled brief on this machine is the DISPATCH and nothing more (issue
# #107): a `workflow_dispatch` on the HOME repo's brief.yml, which runs this same
# script on a runner with the credentials the compose and the sweep need.
#
# The home repo, not this checkout's (issue #91): the workflow and its secrets
# live on `<login>/workkit`, because the plugin repo is distributed and a
# consumer cannot set secrets on a repo they do not own. `workkit setup` seeds
# the workflow there and writes the secrets there, so one slug answers both.
#
# Every reason it cannot be made is a NAMED one in DISPATCH_REASON — nothing is
# composed anywhere to cover for it, so what the caller does with that reason is
# the only thing that says why nine o'clock was quiet.
DISPATCH_REASON=''
DISPATCH_LINE=''
# The home repo this dispatch was made against — what a caller points a human at
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
    DISPATCH_REASON='no home repo is configured — `workkit setup` creates it'
    return 1
  fi
  DISPATCH_SLUG="$slug"
  # The workflow existing is not the workflow WORKING: `gh workflow run` succeeds
  # the moment the file is on the default branch, and a runner missing either
  # credential composes nothing worth having — no OAuth token and it composes
  # nothing at all, no `WORKKIT_GITHUB_TOKEN` and it sweeps no board. So BOTH
  # secrets are checked on the same repo first, in one listing.
  # A FAILED listing and an EMPTY one are different mornings: the first is a
  # repo this token cannot read, the second a repo that truly has no secrets —
  # and this line's whole job is saying honestly why nine o'clock was quiet.
  if ! secrets="$(gh secret list --repo "$slug" 2>/dev/null)"; then
    DISPATCH_REASON="the secrets on $slug could not be listed"
    return 1
  fi
  if [[ -z "$secrets" ]]; then
    DISPATCH_REASON="$slug carries no secrets — \`workkit setup\` wires both"
    return 1
  fi
  if ! grep -qE '^CLAUDE_CODE_OAUTH_TOKEN([[:space:]]|$)' <<<"$secrets"; then
    DISPATCH_REASON="$slug does not carry CLAUDE_CODE_OAUTH_TOKEN — a runner without it composes nothing"
    return 1
  fi
  if ! grep -qE '^WORKKIT_GITHUB_TOKEN([[:space:]]|$)' <<<"$secrets"; then
    DISPATCH_REASON="$slug does not carry WORKKIT_GITHUB_TOKEN — a runner without it sweeps no board"
    return 1
  fi
  if ! gh workflow run "$BRIEF_WORKFLOW" --repo "$slug" >/dev/null 2>&1; then
    DISPATCH_REASON="gh workflow run $BRIEF_WORKFLOW on $slug did not land"
    return 1
  fi
  DISPATCH_LINE="brief: dispatched $BRIEF_WORKFLOW on $slug — the cloud runner composes and publishes today's brief"
  return 0
}
