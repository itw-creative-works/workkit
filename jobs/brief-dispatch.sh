#!/usr/bin/env bash
# jobs/brief-dispatch.sh: the hand-off of brief-dispatch.js for `workkit brief`,
# sourced and never executed. Loading it prints nothing; dispatch_brief runs the
# Node file under the kit's Node (run_at_floor) and fills DISPATCH_SLUG, then
# DISPATCH_LINE or DISPATCH_REASON. The caller has sourced workflow/lib.sh
# first, as the hand-offs of workflow/home.sh need.
#
# Usage: . workflow/lib.sh; . jobs/brief-dispatch.sh
#   if dispatch_brief; then echo "$DISPATCH_LINE"; else echo "$DISPATCH_REASON"; fi

# The workflow on the home repo that runs the morning on a runner, named for
# the caller that points a human at it; its home is BRIEF_WORKFLOW of the Node file.
BRIEF_WORKFLOW='brief.yml'

DISPATCH_SLUG=''
DISPATCH_LINE=''
DISPATCH_REASON=''

# The program's line 1 is the slug, line 2 the line or the reason; its code
# picks which. The capture is a subshell, so run_at_floor's exec ends it alone.
dispatch_brief() {
  local out rc=0
  out="$(run_at_floor brief 1 "${BASH_SOURCE[0]%/*}/brief-dispatch.js")" || rc=$?
  DISPATCH_SLUG="${out%%$'\n'*}"
  DISPATCH_LINE=''
  DISPATCH_REASON=''
  if (( rc == 0 )); then
    DISPATCH_LINE="${out#*$'\n'}"
    return 0
  fi
  [[ "$out" != *$'\n'* ]] || DISPATCH_REASON="${out#*$'\n'}"
  return 1
}
