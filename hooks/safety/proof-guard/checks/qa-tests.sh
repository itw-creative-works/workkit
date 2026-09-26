#!/bin/bash
# hooks/safety/proof-guard/checks/qa-tests.sh: the check at the flip to
# status:qa, which runs the test files the working diff touched with
# `node --test` and blocks the flip when one is red. SOURCED by the entry
# (run.sh), never executed, and it runs nothing at load: it defines functions
# and sets nothing. It reads the entry's cwd and calls _lib.sh's helpers.

# The base the committed leg is read against: the merge base of HEAD with
# origin's default branch, else with this branch's upstream. Sets qa_base, empty
# when neither ref is named or HEAD shares no history with it.
qa_find_base() {
  qa_ref=$(git -C "$1" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)
  if [ -z "$qa_ref" ]; then
    qa_ref=$(git -C "$1" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
  fi
  qa_base=""
  if [ -n "$qa_ref" ]; then
    qa_base=$(git -C "$1" merge-base "$qa_ref" HEAD 2>/dev/null || true)
  fi
}

# The working diff's paths under root $1, one per line: tracked changes against
# HEAD, untracked files, and the commits since base $2 when there is one.
# Deletions never count, and paths come unquoted.
qa_touched_paths() {
  {
    git -C "$1" -c core.quotePath=false diff --name-only --diff-filter=d HEAD 2>/dev/null || true
    git -C "$1" -c core.quotePath=false ls-files --others --exclude-standard 2>/dev/null || true
    if [ -n "$2" ]; then
      git -C "$1" -c core.quotePath=false diff --name-only --diff-filter=d "$2" HEAD 2>/dev/null || true
    fi
  } | sort -u
}

qa_block() {
  {
    echo "proof-guard: BLOCKED this flip to status:qa: $1"
    printf '  %s\n' "${qa_run[@]}"
  } >&2
}

# The run under a fixed 540s deadline, inside the 600s the wiring gives the
# hook, so a hung test bounces instead of being cancelled into an allow.
check_qa_tests() {
  if ! qa_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null); then
    hook_pretool_notice "proof-guard: the session's directory is inside no git repository, so the touched-test run did not run at the qa flip."
    return 0
  fi
  qa_find_base "$qa_root"
  # Only test-shaped files run: a helper or a runner under a test folder
  # (tests/run.js runs the whole suite) is named, never executed.
  qa_run=()
  qa_skipped=""
  qa_helpers=""
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    hook_is_test_path "$path" || continue
    [ -f "$qa_root/$path" ] || continue
    if ! hook_is_test_name "$path"; then
      qa_helpers="$qa_helpers $path"
      continue
    fi
    case "$path" in
      *.js|*.mjs|*.cjs) qa_run+=("$path") ;;
      *) qa_skipped="$qa_skipped $path" ;;
    esac
  done <<<"$(qa_touched_paths "$qa_root" "$qa_base")"
  qa_not_run=""
  if [ -n "$qa_skipped" ]; then
    qa_not_run=" Not run, since node --test runs only .js, .mjs and .cjs:${qa_skipped}."
  fi
  if [ -n "$qa_helpers" ]; then
    qa_not_run="${qa_not_run} Touched under a test folder but not a test file, so not run:${qa_helpers}."
  fi
  if [ -z "$qa_base" ]; then
    qa_not_run="${qa_not_run} Commits since the default branch were not read: origin names no default branch and this branch has no upstream, or HEAD shares no merge base with it."
  fi
  if [ "${#qa_run[@]}" -eq 0 ]; then
    hook_pretool_notice "proof-guard: no touched test files in the working diff, so nothing ran at the qa flip.${qa_not_run}"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    hook_pretool_notice "proof-guard: node is not on PATH, so the touched-test run did not run at the qa flip."
    return 0
  fi
  qa_out=$(mktemp "${TMPDIR:-/tmp}/proof-guard-qa.XXXXXX")
  (cd "$qa_root" && node --test -- "${qa_run[@]}" >"$qa_out" 2>&1) &
  qa_pid=$!
  if ! hook_wait_deadline "$qa_pid" 540; then
    rm -f "$qa_out"
    qa_block "the touched tests were still running at 540s, so the flip cannot prove them green. Run them yourself with node --test, fix what hangs, then flip again:"
    exit 2
  fi
  if ! wait "$qa_pid"; then
    qa_block "a touched test file is red."
    {
      echo "Last lines:"
      tail -15 "$qa_out"
    } >&2
    rm -f "$qa_out"
    exit 2
  fi
  rm -f "$qa_out"
  hook_pretool_notice "proof-guard: ran ${#qa_run[@]} touched test file(s) green at the qa flip: ${qa_run[*]}.${qa_not_run}"
}
