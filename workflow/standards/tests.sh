#!/usr/bin/env bash
# workflow/standards/tests.sh: the check that a repo's `npm test` prints the
# runner's totals line, read off package.json and never run, and that its
# suites live under `test/`. Sourced by standards.sh, functions only.

# ── 6. npm test prints the totals line ──
# Silent for `workkit test`, or `node`, `bash` or `sh` over a file that names a
# runner path (`test/run.js`, the kit's `workflow/test/run.js`, a `run.js`
# beside it) or carries the totals line itself, read one level deep; any other
# test script gets the one line, never a flag on the run.
check_test_runner() {
  local script file="" word words=()
  [[ -f package.json ]] || return 0
  script="$(wk_jq -r '.scripts.test // "" | if type == "string" then . else "" end' package.json 2>/dev/null)" || return 0
  [[ -n "$script" ]] || return 0

  case "$script" in
    'workkit test'|'workkit test '*) return 0 ;;
    'node '*|'bash '*|'sh '*)
      # The file is the first argument that is no flag (`node --no-warnings x.js`).
      read -ra words <<<"${script#* }"
      for word in ${words[@]+"${words[@]}"}; do
        case "$word" in -*) ;; *) file="$word"; break ;; esac
      done
      if [[ -n "$file" && -f "$file" ]] && grep -qE '/run\.js|passed, .*failed' "$file" 2>/dev/null; then
        return 0
      fi
      ;;
  esac
  wk_warn "standards: npm test does not print the totals line"
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
