#!/usr/bin/env bash
# workflow/home.sh: the home repo's hand-offs, sourced and never executed. Each
# function runs its verb of home.js under the kit's Node (run_at_floor), with
# the caller's voice handed over; home.js and home/ hold every rule. Needs
# lib.sh sourced first.

# Pages serves this branch's root, so no build output is committed as source.
# Its twin is PAGES_BRANCH in workflow/home/options.js, the one home.js reads.
WK_HOME_PAGES_BRANCH='gh-pages'

# One verb of home.js with the caller's voice. The subshell keeps the caller
# alive, since run_at_floor ends in exec.
# Usage: _wk_home_run <verb> [args...]
_wk_home_run() { (WK_LOG_STDERR="${WK_LOG_STDERR:-0}" WK_LOG_INDENT="${WK_LOG_INDENT:-}" QUIET="${QUIET:-0}" run_at_floor home 1 "${BASH_SOURCE[0]%/*}/home.js" "$@"); }

wk_home_setup() { _wk_home_run setup "$@"; }
wk_home_doctor() { _wk_home_run doctor "$@"; }
wk_home_runner_doctor() { _wk_home_run runner-doctor "$@"; }
wk_home_slug() { _wk_home_run slug "$@"; }
wk_site_host() { _wk_home_run host "$@"; }
wk_home_set_slug() { _wk_home_run set-slug "$@"; }
wk_home_state() { _wk_home_run state "$@"; }
wk_home_ready() { _wk_home_run ready "$@"; }
wk_home_catch_up() { _wk_home_run catch-up "$@"; }
wk_home_seed_runner() { _wk_home_run seed-runner "$@"; }
wk_home_commit_push() { _wk_home_run commit-push "$@"; }
