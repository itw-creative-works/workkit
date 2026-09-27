#!/bin/bash
# hooks/safety/commit-gate/checks/proof-suite.sh: the gate's last two checks,
# in the order the entry calls them: 6 the proof on every issue the message
# closes, then 5 the suite, the root's and then each touched nested package's.
# SOURCED by the entry (run.sh), never executed, and it runs nothing at load: it
# defines functions and sets nothing. Each check reads the entry's globals (cmd,
# files, has_code, has_pathspec, repo_root) and check 4's trailer_re,
# calls the entry's block and stand_down and _lib.sh's helpers, and assigns
# only plain globals.

# 6. The proof: every issue this commit
# closes must already carry a `Proof:` comment, since the trailer is the third
# stage of the same gate safety/proof-guard holds on the complete flip and the
# close. Check 4's trailer pattern, and the guard's read (hook_issue_has_proof
# in hooks/lib/proof.sh), with the same fail-open: a gh that cannot answer leaves the
# commit alone and says so. It sits BEFORE the suite on purpose, so a missing
# proof bounces without paying for a full test run. The read runs at the repo
# ROOT, where the commit is, so an issue number resolves against this repo.
# Only in repos that keep a CHANGELOG.md, the same participation signal check 4
# reads: a repo outside the pipeline closes issues with a trailer the ordinary
# way, and its issues carry no Proof: convention to check.
check_proof() {
  if [ -f "$repo_root/CHANGELOG.md" ] && printf '%s' "$cmd" | grep -Eqi "$trailer_re"; then
    unproved=""
    for n in $(printf '%s' "$cmd" | grep -Eoi "$trailer_re" | grep -Eo '[0-9]+$' | sort -u); do
      proof_status=0
      (cd "$repo_root" 2>/dev/null || exit 2; hook_issue_has_proof "$n") || proof_status=$?
      case "$proof_status" in
        0) ;;
        1) unproved="$unproved #$n" ;;
        *) echo "commit-gate: could not read issue #$n (gh could not answer), so the proof check did not run." >&2 ;;
      esac
    done
    if [ -n "$unproved" ]; then
      block "the message closes${unproved}, and no comment there opens with a \`Proof:\` line. A proof is a hard gate (docs/project-state.md, \"The proof\"): the agent that built the item comments the Proof: line first, one entry per layer with the command or the reason it was skipped, and only then does the trailer close the issue."
    fi
  fi
}

# 5. Tests must pass when the repo defines them and the commit carries CODE (at
# the repo ROOT: the session may sit in a subdirectory). The code test is
# check 2's, so a docs-only commit and a release commit's version stamps stand
# the suite down; the header records why that lands no untested code (#151). A
# pathspec commit is code by definition here, so it keeps gating strictly. The
# run carries its own deadline, kept under the hook's declared timeout (3000s
# in hooks.json): a hook the harness cancels returns no decision, and no
# decision is ALLOW, so without this, the biggest suites are exactly where the
# gate stopped enforcing (issue #93).
# Injectable so the suite can prove the bounce without a wait. The budget is
# ONE for the whole check, root and nested runs alike, counted from here.
check_suite() {
  suite_start=$SECONDS
  deadline="${WORKKIT_GATE_TEST_DEADLINE:-1500}"
  # An over-raised budget would let the harness cancel the hook at its 3000s
  # timeout first: no decision, and no decision is ALLOW (#93). Clamp so a
  # misconfigured raise still bounces loudly instead of silently allowing.
  [ "$deadline" -gt 2900 ] 2>/dev/null && deadline=2900
  if [ "$has_code" -eq 1 ] && [ -f "$repo_root/package.json" ] && hook_jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
    run_gate_suite ""
  elif [ -f "$repo_root/package.json" ] && hook_jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
    # The stand-down is deliberate (#151) but never silent (#155): a repo that
    # defines a suite hears why this commit did not run it.
    stand_down "commit-gate: suite not run: the commit carries no code (docs-only or version-stamp-only), per #151."
  fi
}

# run_gate_suite <folder>: `npm test` in <folder> under the repo root (the root
# itself when empty), in the background on what is left of check 5's budget.
# A red run, or one the budget cannot finish, bounces naming the folder.
run_gate_suite() {
  gate_suite="the test suite"
  gate_raise="Run \`WORKKIT_SUITE=1 npm test\` yourself"
  if [ -n "$1" ]; then gate_suite="the test suite of $1"; gate_raise="$gate_raise from $1"; fi
  gate_raise="$gate_raise; if this repo's suite genuinely needs longer, raise WORKKIT_GATE_TEST_DEADLINE in this repo's .claude/settings.json env block (2900s at most) and restart the session."
  case "$deadline" in
    ''|*[!0-9]*) block "WORKKIT_GATE_TEST_DEADLINE is '$deadline', not a whole number of seconds, so the gate cannot time $gate_suite. Set it in this repo's .claude/settings.json env block (2900s at most) and restart the session." ;;
  esac
  gate_budget=$((10#$deadline - (SECONDS - suite_start)))
  if [ "$gate_budget" -le 0 ]; then
    block "$gate_suite had no time left under the gate's ${deadline}s deadline, so the gate cannot prove it green. $gate_raise"
  fi
  out_file=$(mktemp "${TMPDIR:-/tmp}/commit-gate-test.XXXXXX")
  # stdin from /dev/null: a caller reading a list on stdin must not feed it to npm.
  (cd "$repo_root/$1" && npm test </dev/null >"$out_file" 2>&1) &
  test_pid=$!
  if ! hook_wait_deadline "$test_pid" "$gate_budget"; then
    rm -f "$out_file"
    block "$gate_suite was still running at the gate's ${deadline}s deadline, so the gate cannot prove it green. $gate_raise"
  fi
  if ! wait "$test_pid"; then
    {
      echo "commit-gate: BLOCKED this commit: $gate_suite failed. Fix the failures, then commit. Last lines:"
      tail -15 "$out_file"
    } >&2
    rm -f "$out_file"
    exit 2
  fi
  rm -f "$out_file"
}

# 5b. The nested pass, after check_suite so the root is already green: each
# tested package holding a change runs its own suite once, first-seen order, on
# check_suite's budget. A pathspec commit's files are unknowable, so it runs
# none and says so, where the repo tracks a tested nested package.
check_nested_suites() {
  if [ "$has_code" -eq 1 ] && [ "$has_pathspec" -eq 1 ]; then
    while IFS= read -r nested_path; do
      [ -n "$nested_path" ] || continue
      if [ -n "$(hook_test_package_dir "$repo_root" "${nested_path%/package.json}")" ]; then
        stand_down "commit-gate: nested suites not run: a pathspec commit bypasses the index, so the gate cannot read which nested packages it touches."
        break
      fi
    done <<<"$(cd "$repo_root" && git -c core.quotePath=false ls-files -- '*/package.json' 2>/dev/null)"
  elif [ "$has_code" -eq 1 ]; then
    nested_pkgs=""
    while IFS= read -r nested_path; do
      nested_pkg=$(hook_test_package_dir "$repo_root" "$nested_path")
      if [ -z "$nested_pkg" ] || grep -Fxq -- "$nested_pkg" <<<"$nested_pkgs"; then continue; fi
      nested_pkgs="$nested_pkgs$nested_pkg"$'\n'
    done <<<"$files"
    while IFS= read -r nested_pkg; do
      if [ -n "$nested_pkg" ]; then run_gate_suite "$nested_pkg"; fi
    done <<<"$nested_pkgs"
  fi
}
