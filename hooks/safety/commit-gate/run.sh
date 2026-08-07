#!/bin/bash
# safety/commit-gate — PreToolUse hook (Bash)
# Every `git commit` goes through the gate (owner ruling, 2026-07-22, plan Q3):
#   1. New-file tests: a commit that ADDS source files while touching no test
#      file bounces (the test-TYPE proxy — only in repos with a test script).
#   2. Review: when the files going into the commit include CODE (not docs-only),
#      the workkit:review skill must have run since the last commit — it leaves
#      a marker file this hook checks. Docs-only commits skip this.
#   3. CHANGELOG: entries this commit adds must match the entry format.
#   4. Collapse on ship: a commit closing an issue (Fixes/Closes/Resolves #N)
#      must stage the CHANGELOG.md entry it closes against.
#   5. Tests: when the repo's package.json has a test script AND the commit
#      carries CODE, the suite must pass — within the gate's own deadline
#      (issue #93). Claude Code cancels a hook at its timeout and treats
#      no-decision as allow, so a suite that outran the harness used to let the
#      commit through untested. The gate now ends the run itself, under that
#      ceiling, and BOUNCES instead. The code test is check 2's classification
#      (issue #151), so a docs-only commit and a release commit's version stamp
#      — a version-only bump in package.json or .claude-plugin/plugin.json —
#      skip the suite. No untested code can land: every commit staging a code
#      line still gates, and a release commit skips only because its tree is
#      the previously gated tree plus generated bookkeeping — so by induction
#      every tree that ever gained code was tested when it gained it.
# Code-vs-docs classification matches the docs/change-tracker hook (same
# definition in both — a docs PATH, then a code extension winning over it, then
# the docs basenames — kept in sync by hand, no second consumer shape yet); the
# version-stamp carve-out below is the gate's alone and sits outside it.
# Fail open on anything that isn't clearly a violating commit.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

cmd=$(jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# --- Find a real `git ... commit` COMMAND, not a mention. ---
# Shared detection (heredoc-body strip, multiline quote strip, clause scan):
# hooks/_lib.sh, used identically by the safety/commit-language hook.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"
hook_find_git_commit "$cmd"
commit_clause="$HOOK_COMMIT_CLAUSE"
saw_cd="$HOOK_SAW_CD"
saw_stage="$HOOK_SAW_STAGE"

block() {
  echo "commit-gate: BLOCKED this commit — $1" >&2
  exit 2
}

# A check that stands down says so on the channel a PreToolUse hook is actually
# HEARD on (issue #155): stderr from a hook exiting 0 reaches the debug log
# alone — never the transcript, never the model, which is how a silent skip
# stayed invisible for a whole session. Same shape as manager/spawn-guard's
# warning: a top-level `systemMessage` for the user plus `additionalContext`
# for Claude, and NO permissionDecision, so the commit's fate is decided
# exactly as it would be with this hook silent.
stand_down() {
  jq -n --arg m "$1" '{
    "systemMessage": $m,
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "additionalContext": $m
    }
  }'
}

# A commit wrapped in an interpreter string (`sh -c "git commit …"`,
# `eval "git commit …"`) carries its flags, message, and pathspecs inside one
# quoted span — nothing below can read them. Same ruling as -C and cd: fail
# closed and ask for the plain form.
[ "$HOOK_WRAPPED_COMMIT" -eq 1 ] && block "the commit is wrapped in an interpreter string (sh -c / eval); run a plain 'git commit ...' directly so the gate can read its flags and message."

[ -n "$commit_clause" ] || exit 0

# The gate classifies the repo it is STANDING in. A commit aimed elsewhere
# (git -C <path>, or cd earlier in the same command line) would be judged
# against the wrong repo — fail closed and ask for a plain commit instead.
[ "$saw_cd" -eq 1 ] && block "the command changes directory before committing; run a plain 'git commit' with the session already in the repo so the gate can see its staging."

# A command that STAGES and commits in one call is ungateable by construction
# (issue #155): the gate is PreToolUse, so it reads the index before the `git
# add` has run — over a clean index every check stood down silently, and even a
# populated one may gain files the gate never saw. Same ruling as -C and cd.
[ "$saw_stage" -eq 1 ] && block "the command stages and commits in one call, so the gate cannot see what the commit will carry; stage first (its own command), then run a plain 'git commit'."

# Walk the commit clause's tokens: detect -C/--git-dir/--work-tree/GIT_DIR=
# (wrong-repo), -a/--all (include modified tracked files), and pathspec
# arguments (commit bypasses staging entirely — ungateable precisely, so gate
# it strictly).
has_all_flag=0
has_pathspec=0
seen_commit=0
skip_next=0
for w in $commit_clause; do
  if [ "$skip_next" -eq 1 ]; then skip_next=0; continue; fi
  if [ "$seen_commit" -eq 0 ]; then
    [ "$w" = "-C" ] && block "uses 'git -C' — run the commit from the repo's own directory so the gate can see its staging."
    # Same wrong-repo shape by other spellings: judged against the cwd's
    # staging, the commit could pass while landing elsewhere.
    case "$w" in
      --git-dir|--git-dir=*|--work-tree|--work-tree=*) block "uses '${w%%=*}' — run the commit from the repo's own directory so the gate can see its staging." ;;
      GIT_DIR=*|GIT_WORK_TREE=*) block "sets ${w%%=*} — run the commit from the repo's own directory so the gate can see its staging." ;;
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

cwd=$(jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || exit 0
cd "$cwd" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
# Everything below judges the REPO, not the session cwd — a session sitting in
# a subdirectory must be gated identically (review 2026-07-23).
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0

# Files going into the commit: staged, plus modified tracked files with -a/--all.
files=$(git diff --cached --name-only 2>/dev/null || true)
if [ "$has_all_flag" -eq 1 ]; then
  files=$(printf '%s\n%s' "$files" "$(git diff --name-only 2>/dev/null || true)")
fi
files=$(printf '%s' "$files" | grep -v '^$' || true)
# Pathspec commits (`git commit -m x src/foo.js`) bypass staging, so the file
# list can't be derived — gate them strictly as code commits.
if [ -z "$files" ] && [ "$has_pathspec" -eq 0 ]; then
  # The gate never stands down SILENTLY (issue #155): skipping every check
  # without saying so is how a whole session's commits went untested. The
  # package.json probe sits on this path alone — by here the gate has already
  # resolved a real commit clause, so it is not new work on every Bash command.
  if [ -f "$repo_root/package.json" ] && jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
    stand_down "commit-gate: nothing staged and no -a/pathspec — the gate has nothing to judge, so no check ran (suite included)."
  fi
  exit 0
fi

# The release commit's version stamp (issue #151): the bump the release tooling
# writes into the two files a repo keeps its version in — the ROOT package.json
# and, for a plugin repo like this one, the ROOT .claude-plugin/plugin.json — is
# generated bookkeeping, not code: the tree is the previously gated tree plus
# that one key. Proved by content the way the stamp arm below is, only `version`
# may differ from HEAD. A NEW file, unreadable or unparseable JSON, or any other
# changed key is code again, and the paths are exact — a nested package.json is
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
  a="$(jq -Sc 'del(.version)' <<<"$head" 2>/dev/null)" || return 1
  b="$(jq -Sc 'del(.version)' <<<"$copy" 2>/dev/null)" || return 1
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
    # gate's alone.
    case "$path" in
      package.json|.claude-plugin/plugin.json)
        if [ "$is_doc" -eq 0 ] && version_bump_only "$path"; then is_doc=1; fi ;;
    esac
    if [ "$is_doc" -eq 0 ]; then has_code=1; break; fi
  done <<<"$files"
fi

# Heal bookkeeping (owner ruling, 2026-07-27): a commit whose files are ALL
# workflow bookkeeping — the .workkit/settings.json version stamp, and the
# vendored .github/changelog-lint.js when its content is exactly what the
# engine would vendor — carries no judgment to review, so checks 1 and 2 stand
# down for it. Tests (check 5) still run. Any other file in the commit, a
# hand-edited linter copy, or an unknowable file list restores the full gate.
linter_is_vendor_current() {
  local engine copy
  engine="$(hook_changelog_linter 2>/dev/null)" || return 1
  # Judge the bytes the COMMIT will carry: the staged blob normally, the
  # working tree under -a/--all (which is what such a commit stages).
  if [ "$has_all_flag" -eq 1 ]; then
    copy="$(cat "$repo_root/.github/changelog-lint.js" 2>/dev/null)" || return 1
  else
    copy="$(cd "$repo_root" && git show ":.github/changelog-lint.js" 2>/dev/null)" || return 1
  fi
  [ -n "$copy" ] || return 1
  # The vendored shape is standards.sh render_changelog_linter's: the engine's
  # shebang, the vendor header on line 2, then the engine's own bytes.
  [ "$(printf '%s\n' "$copy" | head -n 1)" = "$(head -n 1 "$engine")" ] || return 1
  case "$(printf '%s\n' "$copy" | sed -n 2p)" in "// Vendored"*) ;; *) return 1 ;; esac
  cmp -s <(printf '%s\n' "$copy" | tail -n +3) <(tail -n +2 "$engine")
}

# The stamp arm proves its content like the linter arm does: only the `version`
# key may differ from HEAD. Any other edit — flipping `enabled`, rewriting the
# `manager` block that picks every spawn's model — gets the full gate, and so
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
  a="$(jq -Sc 'del(.version)' <<<"$head" 2>/dev/null)" || return 1
  b="$(jq -Sc 'del(.version)' <<<"$staged" 2>/dev/null)" || return 1
  [ -n "$a" ] && [ "$a" = "$b" ]
}

bookkeeping=0
if [ "$has_pathspec" -eq 0 ] && [ -n "$files" ]; then
  bookkeeping=1
  while IFS= read -r path; do
    case "$path" in
      .workkit/settings.json) settings_is_stamp_only || { bookkeeping=0; break; } ;;
      .github/changelog-lint.js) linter_is_vendor_current || { bookkeeping=0; break; } ;;
      *) bookkeeping=0; break ;;
    esac
  done <<<"$files"
fi

# 1. New source files need tests (owner ruling, 2026-07-23, the test-TYPE
# proxy): a hook cannot judge what KIND of test a file holds, but it CAN see a
# commit that ADDS code files while touching no test file at all. Only in repos
# that define a test script (a repo without tests isn't asked to start here),
# and only for staged adds (pathspec commits are already gated strictly).
if [ "$bookkeeping" -eq 0 ] && [ "$has_pathspec" -eq 0 ] && [ -f "$repo_root/package.json" ] && jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
  added=$(git diff --cached --name-only --diff-filter=A 2>/dev/null || true)
  new_code=""
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in
      tests/*|*/tests/*|test/*|*/test/*|*/__tests__/*|_attic/*|*/_attic/*) continue ;;
    esac
    base="$(basename "$path")"
    case "$base" in
      *.test.*|*.spec.*|*_test.*|*.config.*) continue ;;
    esac
    case "$base" in
      *.js|*.cjs|*.mjs|*.ts|*.jsx|*.tsx|*.sh|*.zsh|*.py|*.rb) new_code="$new_code $path" ;;
    esac
  done <<<"$added"
  if [ -n "$new_code" ]; then
    # A test file must be PRESENT in the commit — --diff-filter=d excludes
    # deletions, so removing tests/old.test.js cannot satisfy the proxy.
    files_present=$(git diff --cached --name-only --diff-filter=d 2>/dev/null || true)
    if [ "$has_all_flag" -eq 1 ]; then
      files_present=$(printf '%s\n%s' "$files_present" "$(git diff --name-only --diff-filter=d 2>/dev/null || true)")
    fi
    has_test_file=0
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      case "$path" in
        tests/*|*/tests/*|test/*|*/test/*|*/__tests__/*) has_test_file=1; break ;;
      esac
      case "$(basename "$path")" in
        *.test.*|*.spec.*|*_test.*) has_test_file=1; break ;;
      esac
    done <<<"$files_present"
    if [ "$has_test_file" -eq 0 ]; then
      block "the commit adds new source files (${new_code# }) but touches no test file. The test obligation scales with the change (AGENTS.md §6): write/extend tests for the new files, stage them, then commit."
    fi
  fi
fi

# 2. Review marker (code commits only). The workkit:review skill touches the
# marker when it finishes; it must be newer than the previous commit.
if [ "$has_code" -eq 1 ] && [ "$bookkeeping" -eq 0 ]; then
  marker="${TMPDIR:-/tmp}/claude-review-marker/$(printf '%s' "$repo_root" | shasum | cut -d' ' -f1)"
  if [ ! -f "$marker" ]; then
    block "the commit contains code and no review has run. Run the workkit:review skill on the diff first (it records a marker), then commit."
  fi
  last_commit_ts=$(git log -1 --format=%ct 2>/dev/null || echo 0)
  marker_ts=$(hook_file_mtime "$marker")
  if [ "$marker_ts" -lt "$last_commit_ts" ]; then
    block "the review marker predates the last commit — this commit's code has not been reviewed. Run the workkit:review skill again, then commit."
  fi
fi

# 3. CHANGELOG entries must match the format. The rules live in
# workflow/changelog.js — one home, shared with the docs/changelog-guard hook,
# which runs the same check at write time. This is the authority of the two: it
# sees hand edits made outside the tools. Only the lines this commit ADDS are
# judged, so a legacy CHANGELOG is never bounced for its history. A commit
# staged with -a is judged from the working tree, which is what it will carry.
if linter="$(hook_changelog_linter 2>/dev/null)"; then
  lint_source="--staged"
  [ "$has_all_flag" -eq 1 ] && lint_source=""
  changelogs="$(printf '%s\n' "$files" | grep -E '(^|/)CHANGELOG\.md$' || true)"
  # A pathspec commit bypasses staging, so the file list is unknowable — the
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

# 4. Collapse on ship: a commit that closes an issue carries its CHANGELOG
# entry. The rule is the spec's (docs/project-state.md § queue semantics — the
# turn that closes an issue writes the entry pointing at it), and the trailer
# makes it checkable. Read from the RAW command: the message text is inside a
# quoted span, which the clause strip replaced with a placeholder, so the
# tokenized clause cannot see it. A mention of the trailer outside the message
# reads the same way here, and asking that commit for its entry too is the
# harmless direction.
# Only in repos that keep a CHANGELOG.md, and only when the staged file list is
# knowable — a pathspec commit bypasses staging, so what it carries cannot be
# read (the same reason check 1 stands down there).
if [ "$has_pathspec" -eq 0 ] && [ -f "$repo_root/CHANGELOG.md" ] \
  && printf '%s' "$cmd" | grep -Eqi '(^|[^[:alnum:]])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[[:space:]]+#[0-9]+'; then
  if ! printf '%s\n' "$files" | grep -Eq '(^|/)CHANGELOG\.md$'; then
    block "the message closes an issue (Fixes/Closes/Resolves #N) but no CHANGELOG.md is staged. An issue closes against its CHANGELOG entry (docs/project-state.md): add the entry under [Unreleased], stage CHANGELOG.md, then commit."
  fi
fi

# 5. Tests must pass when the repo defines them and the commit carries CODE (at
# the repo ROOT — the session may sit in a subdirectory). The code test is
# check 2's, so a docs-only commit and a release commit's version stamps stand
# the suite down; the header records why that lands no untested code (#151). A
# pathspec commit is code by definition here, so it keeps gating strictly. The
# run carries its own deadline, kept under the hook's declared timeout (1600s
# in hooks.json): a hook the harness cancels returns no decision, and no
# decision is ALLOW — so without this, the biggest suites are exactly where the
# gate stopped enforcing (issue #93).
# Injectable so the suite can prove the bounce without a wait.
gate_end_tree() {
  local pid kid
  pid="$1"
  for kid in $(pgrep -P "$pid" 2>/dev/null); do gate_end_tree "$kid"; done
  kill -9 "$pid" 2>/dev/null || true
}
if [ "$has_code" -eq 1 ] && [ -f "$repo_root/package.json" ] && jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
  deadline="${WORKKIT_GATE_TEST_DEADLINE:-1500}"
  out_file=$(mktemp "${TMPDIR:-/tmp}/commit-gate-test.XXXXXX")
  (cd "$repo_root" && npm test >"$out_file" 2>&1) &
  test_pid=$!
  start=$SECONDS
  while kill -0 "$test_pid" 2>/dev/null && [ $((SECONDS - start)) -lt "$deadline" ]; do
    sleep 0.2
  done
  if kill -0 "$test_pid" 2>/dev/null; then
    gate_end_tree "$test_pid"
    rm -f "$out_file"
    block "the test suite was still running at the gate's ${deadline}s deadline, so the gate cannot prove it green. Run npm test yourself; if this repo's suite genuinely needs longer, raise WORKKIT_GATE_TEST_DEADLINE (and the hook's own timeout with it)."
  fi
  if ! wait "$test_pid"; then
    {
      echo "commit-gate: BLOCKED this commit — the test suite failed. Fix the failures, then commit. Last lines:"
      tail -15 "$out_file"
    } >&2
    rm -f "$out_file"
    exit 2
  fi
  rm -f "$out_file"
elif [ -f "$repo_root/package.json" ] && jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
  # The stand-down is deliberate (#151) but never silent (#155): a repo that
  # defines a suite hears why this commit did not run it.
  stand_down "commit-gate: suite not run — the commit carries no code (docs-only or version-stamp-only), per #151."
fi

exit 0
