#!/usr/bin/env bash
# workflow/standards/tests.sh: the check that a repo's `npm test` runs
# workkit-core's runner, read off package.json and never run, and that its
# suites live under `test/`. Sourced by standards.sh, functions only.

# ── 6. npm test runs workkit-core's runner ──
# Silent when devDependencies names workkit-core (wk_has_core_package, read off
# package.json, never run), whatever script wraps `workkit test`; any other test
# script gets one line naming both changes, never a flag on the run.
check_test_runner() {
  local script
  [[ -f package.json ]] || return 0
  script="$(wk_jq -r '.scripts.test // "" | if type == "string" then . else "" end' package.json 2>/dev/null)" || return 0
  [[ -n "$script" ]] || return 0
  wk_has_core_package && return 0
  wk_warn "test script: npm test does not run workkit-core's runner; run \`npm i -D workkit-core\` and set \`\"test\": \"workkit test\"\`"
}

# ── 6b. The suites live under test/ ──
# A Node repo (one with a package.json) whose suites sit in `tests/` with no
# `test/` beside it gets the one line naming the move; the runner still reads
# it, so never a flag on the run.
check_test_folder() {
  [[ -f package.json ]] || return 0
  [[ -d tests && ! -d test ]] || return 0
  wk_warn "tests/: the suites live under tests/; Node's convention is test/ (git mv tests test)"
}
