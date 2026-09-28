#!/bin/bash
# safety/commit-gate: PreToolUse hook (Bash). Every `git commit` passes six
# checks: 1 new files carry tests, 2 code carries a fresh review marker, 3 added
# CHANGELOG entries match the format, 4 a `Fixes #N` commit stages its entry,
# 6 every closed issue carries a `Proof:` comment, 5 the suite passes under the
# gate's own deadline (nested packages included). A commit the gate cannot
# place fails closed; anything else not clearly violating fails open.
# Detail: docs/hooks.md § safety:commit-gate.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# --- Find a real `git ... commit` COMMAND, not a mention. ---
# Shared detection (heredoc-body strip, multiline quote strip, clause scan):
# hooks/lib/commit.sh, used identically by the safety/commit-language hook.
hook_find_git_commit "$cmd"
commit_clause="$HOOK_COMMIT_CLAUSE"
saw_cd="$HOOK_SAW_CD"
saw_stage="$HOOK_SAW_STAGE"

block() {
  echo "commit-gate: BLOCKED this commit: $1" >&2
  exit 2
}

# A stand-down collects its line; on exit 0 the trap prints them as ONE notice,
# since the harness reads a single stdout JSON object (stderr reaches only the
# debug log). A bounce exits 2, so it prints none.
gate_notices=""
stand_down() {
  if [ -n "$gate_notices" ]; then gate_notices="$gate_notices"$'\n'"$1"; else gate_notices="$1"; fi
}
trap 'if [ "$?" -eq 0 ] && [ -n "$gate_notices" ]; then hook_pretool_notice "$gate_notices"; fi' EXIT

# A commit wrapped in an interpreter string (`sh -c "git commit …"`,
# `eval "git commit …"`) carries its flags, message, and pathspecs inside one
# quoted span: nothing below can read them. Same ruling as -C and cd: fail
# closed and ask for the plain form.
[ "$HOOK_WRAPPED_COMMIT" -eq 1 ] && block "the commit is wrapped in an interpreter string (sh -c / eval); run a plain 'git commit ...' directly so the gate can read its flags and message."

[ -n "$commit_clause" ] || exit 0

# The gate classifies the repo it stands in, so a commit aimed elsewhere (git -C,
# or cd/pushd/popd earlier in the line) fails closed and asks for a plain commit.
[ "$saw_cd" -eq 1 ] && block "the command changes directory before committing; run a plain 'git commit' with the session already in the repo so the gate can see its staging."

# Stage-and-commit in one call is ungateable: the gate reads the index before
# the in-command `git add` runs. Same ruling as -C and cd.
[ "$saw_stage" -eq 1 ] && block "the command stages and commits in one call, so the gate cannot see what the commit will carry; stage first (its own command), then run a plain 'git commit'."

# Walk the commit clause's tokens: detect -C/--git-dir/--work-tree/GIT_DIR=
# (wrong-repo), -a/--all (include modified tracked files), and pathspec
# arguments (commit bypasses staging entirely: ungateable precisely, so gate
# it strictly).
has_all_flag=0
has_pathspec=0
seen_commit=0
skip_next=0
for w in $commit_clause; do
  if [ "$skip_next" -eq 1 ]; then skip_next=0; continue; fi
  if [ "$seen_commit" -eq 0 ]; then
    [ "$w" = "-C" ] && block "uses 'git -C'. Run the commit from the repo's own directory so the gate can see its staging."
    # Same wrong-repo shape by other spellings: judged against the cwd's
    # staging, the commit could pass while landing elsewhere.
    case "$w" in
      --git-dir|--git-dir=*|--work-tree|--work-tree=*) block "uses '${w%%=*}'. Run the commit from the repo's own directory so the gate can see its staging." ;;
      GIT_DIR=*|GIT_WORK_TREE=*) block "sets ${w%%=*}. Run the commit from the repo's own directory so the gate can see its staging." ;;
    esac
    [ "$w" = "commit" ] && seen_commit=1
    continue
  fi
  case "$w" in
    --) has_pathspec=1; break ;;
    --all) has_all_flag=1 ;;
    --message=*|--file=*) ;;
    # Every long flag that takes a SEPARATE value: the quote strip leaves the
    # value as a visible token, so a flag missing here would read it as a pathspec.
    --message|--file|--author|--date|--trailer|--fixup|--squash|--cleanup|--pathspec-from-file|--gpg-sign|--reuse-message|--reedit-message) skip_next=1 ;;
    --*) ;;
    -[!-]*)
      case "$w" in *a*) has_all_flag=1 ;; esac
    # Only a value-taking letter at the END of the token consumes the next one:
    # `-m"docs"` arrives as `-m_hookq_`, its value already attached.
      case "$w" in *[mFtcC]) skip_next=1 ;; esac
      ;;
    # A redirect is shell syntax, never an argument: a bare operator hands its
    # target to the next token, an attached one carries it.
    *[\<\>]*)
      span=$(hook_redirect_span "$w")
      if [ "$span" -gt 0 ]; then skip_next=$((span - 1)); else has_pathspec=1; fi
      ;;
    *) has_pathspec=1 ;;
  esac
done

# A real commit in a cwd that resolves no repository is a commit the gate cannot
# place (a background subagent's steady state), so it fails closed. A payload
# with no cwd at all still fails open: that is the hook's own blindness, and
# blocking would wedge every commit.
no_repo() {
  block "the session's directory is not inside a git repository, so the gate cannot see what this commit would carry. cd into the repo's root as its own command first, then run a plain 'git commit' there."
}
cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || exit 0
cd "$cwd" 2>/dev/null || no_repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || no_repo
# Everything below judges the REPO, not the session cwd, so a session in a
# subdirectory is gated identically.
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || no_repo

# Files going into the commit: staged, plus modified tracked files with -a/--all.
files=$(git -c core.quotePath=false diff --cached --name-only 2>/dev/null || true)
if [ "$has_all_flag" -eq 1 ]; then
  files=$(printf '%s\n%s' "$files" "$(git -c core.quotePath=false diff --name-only 2>/dev/null || true)")
fi
files=$(printf '%s' "$files" | grep -v '^$' || true)
# Pathspec commits (`git commit -m x src/foo.js`) bypass staging, so the file
# list can't be derived: gate them strictly as code commits.
if [ -z "$files" ] && [ "$has_pathspec" -eq 0 ]; then
  # The gate never stands down silently. The package.json probe sits on this
  # path alone, past a resolved commit clause, so ordinary commands never pay it.
  if hook_has_test_script "$repo_root"; then
    stand_down "commit-gate: nothing staged and no -a/pathspec: the gate has nothing to judge, so no check ran (suite included)."
  fi
  exit 0
fi

# A version stamp in the ROOT package.json, .claude-plugin/plugin.json or
# .workkit/settings.json is generated bookkeeping, not code: proved by content,
# only `version` may differ from HEAD. A new file, unparseable JSON, another
# changed key, a nested package.json or anything else fails the proof.
version_bump_only() {
  local file head copy a b
  file="$1"
  head="$(cd "$repo_root" && git show "HEAD:$file" 2>/dev/null)" || return 1
  # Judge the bytes the COMMIT will carry: the staged blob normally, the
  # working tree under -a/--all.
  if [ "$has_all_flag" -eq 1 ]; then
    copy="$(cat "$repo_root/$file" 2>/dev/null)" || return 1
  else
    copy="$(cd "$repo_root" && git show ":$file" 2>/dev/null)" || return 1
  fi
  [ -n "$copy" ] || return 1
  a="$(hook_jq -Sc 'del(.version)' <<<"$head" 2>/dev/null)" || return 1
  b="$(hook_jq -Sc 'del(.version)' <<<"$copy" 2>/dev/null)" || return 1
  [ -n "$a" ] && [ "$a" = "$b" ]
}

has_code=0
[ "$has_pathspec" -eq 1 ] && has_code=1
if [ -n "$files" ]; then
  while IFS= read -r path; do
    base="$(basename "$path")"
    is_doc=0
    case "$path" in
      docs/*|*/docs/*) is_doc=1 ;;
    esac
    # A code EXTENSION wins over the docs path (same list check 1 uses): this
    # repo keeps hooks/docs/*/run.sh, executable bash sitting under a docs
    # directory, and classifying it as docs would let a hook change commit with
    # no suite and no review marker.
    if hook_has_code_ext "$base"; then is_doc=0; fi
    # Docs basenames are docs wherever they live, extension arm included.
    case "$base" in
      *.md|CHANGELOG|CHANGELOG.*|LICENSE|LICENSE.*) is_doc=1 ;;
    esac
    # Not a doc, and not code either. Deliberately its own case: the classifier
    # above stays in step with docs/change-tracker's, and this carve-out is the
    # gate's alone. Twin list: VERSION_FILES in workflow/ship/release.js, which bumps exactly these.
    case "$path" in
      package.json|.claude-plugin/plugin.json)
        if [ "$is_doc" -eq 0 ] && version_bump_only "$path"; then is_doc=1; fi ;;
    esac
    if [ "$is_doc" -eq 0 ]; then has_code=1; break; fi
  done <<<"$files"
fi

# Heal bookkeeping: a commit whose files are all the heal's output stands checks
# 1 and 2 down; the suite still runs. Three arms, each proving its file byte
# for byte (docs/hooks.md § safety:commit-gate). Under -a/--all each arm reads
# the working tree, which is what the commit carries.

linter_copy_retired() {
  local tmp rc=1
  {
    git diff --cached --name-only --diff-filter=D 2>/dev/null || true
    if [ "$has_all_flag" -eq 1 ]; then git diff --name-only --diff-filter=D 2>/dev/null || true; fi
  } | grep -Fxq -- "$1" || return 1
  if [ "$has_all_flag" -eq 1 ]; then
    wk_workflows_run_copy "$repo_root" "$1" && return 1
    return 0
  fi
  # The index's workflows, checked out where the question can read them.
  tmp="$(mktemp -d 2>/dev/null)" || return 1
  if (cd "$repo_root" && git ls-files -z -- .github/workflows | xargs -0 git checkout-index --prefix="$(wk_git_path "$tmp")/" --) >/dev/null 2>&1; then
    wk_workflows_run_copy "$tmp" "$1" || rc=0
  fi
  rm -rf "$tmp"
  return "$rc"
}

checks_is_job_rewrite() {
  local file=".github/workflows/checks.yml" tmp want have rc=1
  tmp="$(mktemp -d 2>/dev/null)" || return 1
  if (cd "$repo_root" && git show "HEAD:$file") >"$tmp/head" 2>/dev/null \
    && wk_changelog_job_rewrite "$tmp/head" "$(wk_checks_template)" >"$tmp/rewrite" 2>/dev/null \
    && want="$(cd "$repo_root" && git hash-object --path="$file" "$(wk_git_path "$tmp/rewrite")" 2>/dev/null)"; then
    if [ "$has_all_flag" -eq 1 ]; then
      have="$(cd "$repo_root" && git hash-object --path="$file" "$file" 2>/dev/null)" || have=""
    else
      have="$(cd "$repo_root" && git rev-parse -q --verify ":$file" 2>/dev/null)" || have=""
    fi
    if [ -n "$want" ] && [ "$want" = "$have" ]; then rc=0; fi
  fi
  rm -rf "$tmp"
  return "$rc"
}

bookkeeping=0
if [ "$has_pathspec" -eq 0 ] && [ -n "$files" ]; then
  bookkeeping=1
  while IFS= read -r path; do
    case "$path" in
      .workkit/settings.json) version_bump_only ".workkit/settings.json" || { bookkeeping=0; break; } ;;
      .github/workflows/checks.yml) checks_is_job_rewrite || { bookkeeping=0; break; } ;;
      *)
        grep -Fxq -- "$path" <<<"$(wk_linter_copies)" || { bookkeeping=0; break; }
        linter_copy_retired "$path" || { bookkeeping=0; break; } ;;
    esac
  done <<<"$files"
fi

# 1. New source files need tests (the test-TYPE proxy): a hook cannot judge what KIND of test a file holds, but it CAN see a
# commit that adds code files while touching no test file at all. Only in repos
# that define a test script (a repo without tests isn't asked to start here),
# and only for staged adds (pathspec commits are already gated strictly).
if [ "$bookkeeping" -eq 0 ] && [ "$has_pathspec" -eq 0 ] && hook_has_test_script "$repo_root"; then
  added=$(git -c core.quotePath=false diff --cached --name-only --diff-filter=A 2>/dev/null || true)
  new_code=""
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if hook_is_code_path "$path"; then new_code="$new_code $path"; fi
  done <<<"$added"
  if [ -n "$new_code" ]; then
    # A test file must be PRESENT in the commit: --diff-filter=d excludes
    # deletions, so removing tests/old.test.js cannot satisfy the proxy.
    files_present=$(git -c core.quotePath=false diff --cached --name-only --diff-filter=d 2>/dev/null || true)
    if [ "$has_all_flag" -eq 1 ]; then
      files_present=$(printf '%s\n%s' "$files_present" "$(git -c core.quotePath=false diff --name-only --diff-filter=d 2>/dev/null || true)")
    fi
    has_test_file=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      if hook_is_test_path "$path"; then has_test_file=1; break; fi
    done <<<"$files_present"
    if [ "$has_test_file" -eq 0 ]; then
      block "the commit adds new source files (${new_code# }) but touches no test file. The test obligation scales with the change (AGENTS.md §6): write/extend tests for the new files, stage them, then commit."
    fi
  fi
fi

# 2. Review marker (code commits only). The workkit:review skill touches the
# marker when it finishes; it must be newer than the previous commit.
if [ "$has_code" -eq 1 ] && [ "$bookkeeping" -eq 0 ]; then
  # The marker's name is hook_review_marker_path's, the same helper
  # scripts/review-marker.sh writes through, so the gate and the skill can
  # never name two different files. No digest tool at all is loud: an empty key
  # would be one marker shared by every repo on the machine.
  if ! marker="$(hook_review_marker_path "$repo_root")"; then
    block "this machine has neither shasum nor sha1sum, so the gate cannot name the review marker. Install one, then commit."
  fi
  if [ ! -f "$marker" ]; then
    block "the commit contains code and no review has run. Run the workkit:review skill on the diff first (it records a marker), then commit."
  fi
  last_commit_ts=$(git log -1 --format=%ct 2>/dev/null || echo 0)
  marker_ts=$(hook_file_mtime "$marker")
  if [ "$marker_ts" -lt "$last_commit_ts" ]; then
    block "the review marker predates the last commit. This commit's code has not been reviewed. Run the workkit:review skill again, then commit."
  fi
fi

# 3. CHANGELOG entries this commit adds must match the format (the rules live in
# workflow/changelog/changelog.js, shared with docs/changelog-guard; this is the
# authority, since it sees hand edits). Under -a the working tree is judged.
if linter="$(hook_changelog_linter 2>/dev/null)"; then
  lint_source="--staged"
  [ "$has_all_flag" -eq 1 ] && lint_source=""
  changelogs="$(printf '%s\n' "$files" | grep -E '(^|/)CHANGELOG\.md$' || true)"
  # A pathspec commit bypasses staging, so the file list is unknowable: the
  # gate already treats those strictly. Judge the repo's own CHANGELOG from the
  # working tree, which is what such a commit would carry.
  if [ "$has_pathspec" -eq 1 ] && [ -f "$repo_root/CHANGELOG.md" ]; then
    changelogs="CHANGELOG.md"
    lint_source=""
  fi
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    # shellcheck disable=SC2086  # lint_source is one optional flag, not a path
    if ! lint_out=$(cd "$repo_root" && node "$linter" "$repo_root/$path" --added-only $lint_source 2>&1); then
      block "the CHANGELOG entry does not match the format (see docs/project-state.md). $lint_out"
    fi
  done <<<"$changelogs"
fi

# 4. Collapse on ship: a commit closing an issue carries its CHANGELOG entry
# (docs/project-state.md § queue semantics). The trailer is read from the RAW
# command, where the message still is; only with a CHANGELOG.md and a knowable
# file list. The trailer pattern's one home serves checks 4 and 6 alike.
trailer_re='(^|[^[:alnum:]])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[[:space:]]+#[0-9]+'
if [ "$has_pathspec" -eq 0 ] && [ -f "$repo_root/CHANGELOG.md" ] \
  && printf '%s' "$cmd" | grep -Eqi "$trailer_re"; then
  if ! printf '%s\n' "$files" | grep -Eq '(^|/)CHANGELOG\.md$'; then
    block "the message closes an issue (Fixes/Closes/Resolves #N) but no CHANGELOG.md is staged. An issue closes against its CHANGELOG entry (docs/project-state.md): add the entry under [Unreleased], stage CHANGELOG.md, then commit."
  fi
fi

# 6. The proof: every issue this commit closes must carry a `Proof:` comment,
# read by hook_issue_has_proof at the repo root, failing open out loud. It runs
# before the suite so a missing proof costs no test run, and only where a
# CHANGELOG.md marks the repo as in the pipeline.
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

# run_gate_suite <folder>: `npm test` in <folder> under the repo root (the root
# itself when empty), in the background on what is left of check 5's budget.
# A red run, or one the budget cannot finish, bounces naming the folder.
run_gate_suite() {
  gate_suite="the test suite"
  gate_raise="Run \`npm test\` yourself"
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

# 5. Tests pass when the repo defines them and the commit carries CODE, run at
# the repo root under the gate's own deadline, since a hook the harness cancels
# is an allow. A pathspec commit is code here. The budget is injectable so the
# suite proves the bounce without a wait, and it is one for root and nested runs.
suite_start=$SECONDS
deadline="${WORKKIT_GATE_TEST_DEADLINE:-1500}"
# Clamp an over-raised budget under the 3000s hook timeout: a cancelled hook
# is an allow, and a misconfigured raise must still bounce loudly.
[ "$deadline" -gt 2900 ] 2>/dev/null && deadline=2900
if [ "$has_code" -eq 1 ] && hook_has_test_script "$repo_root"; then
  # A green run proved the tree this commit carries (the real index); the gate's
  # own green run records the working tree, so a hand run right after is a repeat.
  if hook_suite_proved "$repo_root" "$(hook_suite_index_tree "$repo_root")"; then
    stand_down "commit-gate: suite proved by the run on this tree, skipped"
  else
    run_gate_suite ""
    hook_suite_marker_write "$repo_root" || true
  fi
elif hook_has_test_script "$repo_root"; then
  # The stand-down is deliberate but never silent: a repo that defines a suite
  # hears why this commit did not run it.
  stand_down "commit-gate: suite not run: the commit carries no code (docs-only or version-stamp-only)."
fi

# 5b. The nested pass, after check 5 so the root is already green: each
# tested package holding a change runs its own suite once, first-seen order, on
# check 5's budget. A pathspec commit's files are unknowable, so it runs
# none and says so, where the repo tracks a tested nested package.
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

exit 0
