#!/bin/bash
# hooks/safety/commit-gate/checks/files.sh: the gate's checks 1 to 4, the ones
# that judge what the commit carries: new-file tests, the review marker, the
# CHANGELOG format, and the CHANGELOG a closing trailer needs. SOURCED by the
# entry (run.sh), never executed, and it runs nothing at load: it defines
# functions and sets nothing. Each check reads the entry's globals (cmd, files,
# has_code, has_pathspec, has_all_flag, bookkeeping, repo_root), calls the
# entry's block and _lib.sh's helpers, and assigns only plain globals: check 3
# sets linter, and check 4 sets trailer_re, which check 6 reads.

# 1. New source files need tests (the test-TYPE proxy): a hook cannot judge what KIND of test a file holds, but it CAN see a
# commit that ADDS code files while touching no test file at all. Only in repos
# that define a test script (a repo without tests isn't asked to start here),
# and only for staged adds (pathspec commits are already gated strictly).
check_new_files() {
  if [ "$bookkeeping" -eq 0 ] && [ "$has_pathspec" -eq 0 ] && [ -f "$repo_root/package.json" ] && hook_jq -e '.scripts.test' "$repo_root/package.json" >/dev/null 2>&1; then
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
      # A test file must be PRESENT in the commit: --diff-filter=d excludes
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
}

# 2. Review marker (code commits only). The workkit:review skill touches the
# marker when it finishes; it must be newer than the previous commit.
check_review_marker() {
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
}

# 3. CHANGELOG entries must match the format. The rules live in
# workflow/changelog.js: one home, shared with the docs/changelog-guard hook,
# which runs the same check at write time. This is the authority of the two: it
# sees hand edits made outside the tools. Only the lines this commit ADDS are
# judged, so a legacy CHANGELOG is never bounced for its history. A commit
# staged with -a is judged from the working tree, which is what it will carry.
check_changelog_format() {
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
}

# 4. Collapse on ship: a commit that closes an issue carries its CHANGELOG
# entry. The rule is the spec's (docs/project-state.md § queue semantics: the
# turn that closes an issue writes the entry pointing at it), and the trailer
# makes it checkable. Read from the RAW command: the message text is inside a
# quoted span, which the clause strip replaced with a placeholder, so the
# tokenized clause cannot see it. A mention of the trailer outside the message
# reads the same way here, and asking that commit for its entry too is the
# harmless direction.
# Only in repos that keep a CHANGELOG.md, and only when the staged file list is
# knowable: a pathspec commit bypasses staging, so what it carries cannot be
# read (the same reason check 1 stands down there).
# The trailer pattern has ONE home, since checks 4 and 6 ask the same question
# of the same message: which issues does this commit close?
check_changelog_staged() {
  trailer_re='(^|[^[:alnum:]])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[[:space:]]+#[0-9]+'
  if [ "$has_pathspec" -eq 0 ] && [ -f "$repo_root/CHANGELOG.md" ] \
    && printf '%s' "$cmd" | grep -Eqi "$trailer_re"; then
    if ! printf '%s\n' "$files" | grep -Eq '(^|/)CHANGELOG\.md$'; then
      block "the message closes an issue (Fixes/Closes/Resolves #N) but no CHANGELOG.md is staged. An issue closes against its CHANGELOG entry (docs/project-state.md): add the entry under [Unreleased], stage CHANGELOG.md, then commit."
    fi
  fi
}
