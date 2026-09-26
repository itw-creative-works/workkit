#!/bin/bash
# safety/commit-gate: PreToolUse hook (Bash)
# Every `git commit` goes through the gate:
#   1. New-file tests: a commit that ADDS source files while touching no test
#      file bounces (the test-TYPE proxy, only in repos with a test script).
#   2. Review: when the files going into the commit include CODE (not docs-only),
#      the workkit:review skill must have run since the last commit: it leaves
#      a marker file this hook checks. Docs-only commits skip this.
#   3. CHANGELOG: entries this commit adds must match the entry format.
#   4. Collapse on ship: a commit closing an issue (Fixes/Closes/Resolves #N)
#      must stage the CHANGELOG.md entry it closes against.
#   5. Tests: when the repo's package.json has a test script AND the commit
#      carries CODE, the suite must pass, within the gate's own deadline
#      (issue #93). Claude Code cancels a hook at its timeout and treats
#      no-decision as allow, so a suite that outran the harness used to let the
#      commit through untested. The gate now ends the run itself, under that
#      ceiling, and BOUNCES instead. The code test is check 2's classification
#      (issue #151), so a docs-only commit and a release commit's version stamp
#      (a version-only bump in package.json or .claude-plugin/plugin.json)
#      skip the suite. No untested code can land: every commit staging a code
#      line still gates, and a release commit skips only because its tree is
#      the previously gated tree plus generated bookkeeping, so by induction
#      every tree that ever gained code was tested when it gained it.
#      The run's budget is WORKKIT_GATE_TEST_DEADLINE (default 1500s), kept
#      under the hook's declared timeout in hooks.json (3000s). A repo whose
#      green suite outgrows the default raises the env var in its own
#      .claude/settings.json env block (issue #189): the default stays small
#      so small repos still bounce a hung suite quickly, and the timeout's
#      headroom is what makes a per-repo raise effective without touching
#      this plugin. A raise above 2900s is clamped back, so the harness can
#      never cancel the hook into a silent allow. Both the raise and a
#      plugin update take effect on a session restart.
#   6. The proof: every issue the message closes (the check 4 trailer) must
#      already carry a `Proof:` comment.
#      The trailer is the third stage of the gate safety/proof-guard holds on
#      the complete flip and the close, and it reads the issue the same way.
# Code-vs-docs classification matches the docs/change-tracker hook (same
# definition in both: a docs PATH, then a code extension winning over it, then
# the docs basenames, kept in sync by hand, no second consumer shape yet); the
# version-stamp carve-out below is the gate's alone and sits outside it.
# Fail open on anything that isn't clearly a violating commit.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

# The six checks are functions in checks/, sourced here and called in order at
# the end: checks/files.sh holds 1 to 4, checks/proof-suite.sh holds 6 and 5.
# shellcheck source=./checks/files.sh
. "$(dirname "${BASH_SOURCE[0]}")/checks/files.sh"
# shellcheck source=./checks/proof-suite.sh
. "$(dirname "${BASH_SOURCE[0]}")/checks/proof-suite.sh"

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

# A check that stands down says so on the channel a PreToolUse hook is actually
# HEARD on (issue #155): stderr from a hook exiting 0 reaches the debug log
# alone, never the transcript, never the model, which is how a silent skip
# stayed invisible for a whole session. Same shape as manager/spawn-guard's
# warning: a top-level `systemMessage` for the user plus `additionalContext`
# for Claude, and NO permissionDecision, so the commit's fate is decided
# exactly as it would be with this hook silent.
stand_down() {
  hook_jq -n --arg m "$1" '{
    "systemMessage": $m,
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "additionalContext": $m
    }
  }'
}

# A commit wrapped in an interpreter string (`sh -c "git commit …"`,
# `eval "git commit …"`) carries its flags, message, and pathspecs inside one
# quoted span: nothing below can read them. Same ruling as -C and cd: fail
# closed and ask for the plain form.
[ "$HOOK_WRAPPED_COMMIT" -eq 1 ] && block "the commit is wrapped in an interpreter string (sh -c / eval); run a plain 'git commit ...' directly so the gate can read its flags and message."

[ -n "$commit_clause" ] || exit 0

# The gate classifies the repo it is STANDING in. A commit aimed elsewhere
# (git -C <path>, or cd/pushd/popd earlier in the same command line) would be
# judged against the wrong repo: fail closed and ask for a plain commit
# instead. The pushd spelling is the same act by another word and used to walk
# past this test (issue #159); the finder flags all three.
[ "$saw_cd" -eq 1 ] && block "the command changes directory before committing; run a plain 'git commit' with the session already in the repo so the gate can see its staging."

# A command that STAGES and commits in one call is ungateable by construction
# (issue #155): the gate is PreToolUse, so it reads the index before the `git
# add` has run: over a clean index every check stood down silently, and even a
# populated one may gain files the gate never saw. Same ruling as -C and cd.
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
    # Every long flag that takes a SEPARATE value. Its value is now a visible
    # token (the quote strip leaves a placeholder), so a flag missing from this
    # list would have its value read as a pathspec and gate the commit strictly
    # for no reason (review 2026-07-25: `--author "Jane Doe"` blocked a
    # docs-only commit).
    --message|--file|--author|--date|--trailer|--fixup|--squash|--cleanup|--pathspec-from-file|--gpg-sign|--reuse-message|--reedit-message) skip_next=1 ;;
    --*) ;;
    -[!-]*)
      case "$w" in *a*) has_all_flag=1 ;; esac
      # Only a value-taking letter at the END of the token consumes the next
      # one. `-m"docs"` arrives as `-m_hookq_`, its value already attached, and
      # must NOT swallow the pathspec after it (review 2026-07-25).
      case "$w" in *[mFtcC]) skip_next=1 ;; esac
      ;;
    *) has_pathspec=1 ;;
  esac
done

# By here the command carries a real commit clause, so a cwd that resolves no
# repository is not an ordinary Bash command passing through: it is a commit the
# gate cannot place, and every check below would stand down over the wrong tree
# or none at all. It fails CLOSED (issue #159): a background subagent sits at
# the session's primary directory, which is often no repo at all, so this was
# every one of their commits. The one thing the gate keeps failing OPEN on is a
# payload carrying no cwd at all: that is the hook's own blindness, not a
# reachable command shape, and blocking on it would wedge every commit with no
# action that could clear it.
no_repo() {
  block "the session's directory is not inside a git repository, so the gate cannot see what this commit would carry. cd into the repo's root as its own command first, then run a plain 'git commit' there."
}
cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || exit 0
cd "$cwd" 2>/dev/null || no_repo
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || no_repo
# Everything below judges the REPO, not the session cwd: a session sitting in
# a subdirectory must be gated identically (review 2026-07-23).
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || no_repo

# Files going into the commit: staged, plus modified tracked files with -a/--all.
files=$(git diff --cached --name-only 2>/dev/null || true)
if [ "$has_all_flag" -eq 1 ]; then
  files=$(printf '%s\n%s' "$files" "$(git diff --name-only 2>/dev/null || true)")
fi
files=$(printf '%s' "$files" | grep -v '^$' || true)
# Pathspec commits (`git commit -m x src/foo.js`) bypass staging, so the file
# list can't be derived: gate them strictly as code commits.
if [ -z "$files" ] && [ "$has_pathspec" -eq 0 ]; then
  # The gate never stands down SILENTLY (issue #155): skipping every check
  # without saying so is how a whole session's commits went untested. The
  # package.json probe sits on this path alone: by here the gate has already
  # resolved a real commit clause, so it is not new work on every Bash command.
  if [ -f "$repo_root/package.json" ] && hook_jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
    stand_down "commit-gate: nothing staged and no -a/pathspec: the gate has nothing to judge, so no check ran (suite included)."
  fi
  exit 0
fi

# The release commit's version stamp (issue #151): the bump the release tooling
# writes into the two files a repo keeps its version in (the ROOT package.json
# and, for a plugin repo like this one, the ROOT .claude-plugin/plugin.json) is
# generated bookkeeping, not code: the tree is the previously gated tree plus
# that one key. Proved by content the way the stamp arm below is, only `version`
# may differ from HEAD. A NEW file, unreadable or unparseable JSON, or any other
# changed key is code again, and the paths are exact: a nested package.json is
# never this.
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
    case "$base" in
      *.js|*.cjs|*.mjs|*.ts|*.jsx|*.tsx|*.sh|*.zsh|*.py|*.rb) is_doc=0 ;;
    esac
    # Docs basenames are docs wherever they live, extension arm included.
    case "$base" in
      *.md|CHANGELOG|CHANGELOG.*|LICENSE|LICENSE.*) is_doc=1 ;;
    esac
    # Not a doc, and not code either. Deliberately its own case: the classifier
    # above stays in step with docs/change-tracker's, and this carve-out is the
    # gate's alone. Twin list: VERSION_FILES in workflow/release.js, which bumps exactly these.
    case "$path" in
      package.json|.claude-plugin/plugin.json)
        if [ "$is_doc" -eq 0 ] && version_bump_only "$path"; then is_doc=1; fi ;;
    esac
    if [ "$is_doc" -eq 0 ]; then has_code=1; break; fi
  done <<<"$files"
fi

# Heal bookkeeping: a commit whose files are ALL workflow bookkeeping carries
# no judgment to review, so checks 1 and 2 stand down for it. Tests (check 5)
# still run. Any other file, or an unknowable file list, restores the full
# gate. Three arms, each proving its file is exactly the heal's output:
#   - the .workkit/settings.json version stamp (settings_is_stamp_only);
#   - the DELETION of a linter copy (wk_linter_copies), and only once no
#     workflow in the tree the commit produces still runs it
#     (linter_copy_retired). An added or edited copy, or a deletion that leaves
#     a workflow running the copy, is not the heal's output;
#   - .github/workflows/checks.yml, when the blob the commit carries is the
#     blob of the heal's rewrite of HEAD's file: its job swapped where it ran a
#     copy, its header swapped where it carried a retired paragraph, and a job
#     of the repo's own never touched, so a file the heal would not change
#     cannot match (checks_is_job_rewrite). Blobs are compared by object id,
#     so the match is byte for byte, trailing newlines included, and a CRLF
#     working tree under autocrlf is judged by what git will store.
# The copies' names, the "still runs it" question and the rewrite are all
# workflow/changelog-job.sh's, sourced through _lib.sh, the file the heal runs,
# so the two cannot disagree. Under -a/--all the working tree is what the
# commit carries, so each arm reads it there.

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

# The stamp arm proves its content: only the `version` key may differ from
# HEAD. Any other edit (flipping `enabled`, rewriting the
# `manager` block that picks every spawn's model) gets the full gate, and so
# does a NEW settings.json (the one-time opt-in commit is not a stamp).
settings_is_stamp_only() {
  local head staged a b
  head="$(cd "$repo_root" && git show "HEAD:.workkit/settings.json" 2>/dev/null)" || return 1
  if [ "$has_all_flag" -eq 1 ]; then
    staged="$(cat "$repo_root/.workkit/settings.json" 2>/dev/null)" || return 1
  else
    staged="$(cd "$repo_root" && git show ":.workkit/settings.json" 2>/dev/null)" || return 1
  fi
  [ -n "$staged" ] || return 1
  a="$(hook_jq -Sc 'del(.version)' <<<"$head" 2>/dev/null)" || return 1
  b="$(hook_jq -Sc 'del(.version)' <<<"$staged" 2>/dev/null)" || return 1
  [ -n "$a" ] && [ "$a" = "$b" ]
}

bookkeeping=0
if [ "$has_pathspec" -eq 0 ] && [ -n "$files" ]; then
  bookkeeping=1
  while IFS= read -r path; do
    case "$path" in
      .workkit/settings.json) settings_is_stamp_only || { bookkeeping=0; break; } ;;
      .github/workflows/checks.yml) checks_is_job_rewrite || { bookkeeping=0; break; } ;;
      *)
        grep -Fxq -- "$path" <<<"$(wk_linter_copies)" || { bookkeeping=0; break; }
        linter_copy_retired "$path" || { bookkeeping=0; break; } ;;
    esac
  done <<<"$files"
fi

# The checks, in the order the gate asks them: 6 sits before 5 so a missing
# proof bounces without paying for a full test run. Each function ends on an
# if, which returns 0 when it does not fire, so a bare call never stops the run.
check_new_files
check_review_marker
check_changelog_format
check_changelog_staged
check_proof
check_suite

exit 0
