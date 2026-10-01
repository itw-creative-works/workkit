#!/bin/bash
# safety/proof-guard: PreToolUse hook (Bash), the mechanical half of the spec's
# proof rule (docs/project-state.md § The proof). Blocks the flip to
# status:complete and `gh issue close <N>` while the issue carries no `Proof:`
# line (the never-built closes pass), and the flip to status:qa while a touched
# test file is red (checks/qa-tests.sh). The read runs from the session's
# directory, so any of them behind a cd bounces; it fails open, out loud.
# Detail: docs/hooks.md § safety:proof-guard.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"
# shellcheck source=checks/qa-tests.sh
. "$(dirname "${BASH_SOURCE[0]}")/checks/qa-tests.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# Cheap exits first, on the raw text above any splitting, since every Bash
# command in the session pays for whatever sits here.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+issue[[:space:]]+(edit|close)([[:space:]]|$)' || exit 0
# Only three commands can reach the guard, and each leaves a literal behind: a
# flip has to spell `status:complete` or `status:qa` for the label to apply, and
# the close has to spell `gh issue close`. None can hide in a variable and still
# do its work, so this hides nothing from the walk.
if ! printf '%s' "$cmd" | grep -q 'status:complete' \
  && ! printf '%s' "$cmd" | grep -q 'status:qa' \
  && ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+issue[[:space:]]+close([[:space:]]|$)'; then
  exit 0
fi

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# Shared text handling (heredoc-body strip, redirect fold, quote strip, the proof read):
# hooks/lib/commit.sh and hooks/lib/proof.sh, the same preparation the commit hooks and tree-guard do before
# walking clauses. A heredoc BODY is file content, not a command.
src=$(hook_strip_heredocs "$cmd")
# A redirect's `&` is folded before either split below, so `2>&1` never cuts a clause.
# The fold is quote blind and safe on raw text: it never moves a quote or a real separator.
src=$(hook_fold_redirect_amp "$src")

skipped() {
  echo "proof-guard: could not read issue #$1 ($2), so the proof gate did not run on this command." >&2
}

block() {
  {
    echo "proof-guard: BLOCKED this command. Issue #$1 carries no comment whose line starts with \"Proof:\", so it cannot $2 (docs/project-state.md, \"The proof\": the proof is a hard gate)."
    echo "The proof is written at the PARK by the agent that built the item, from the layers it actually ran (skills/feature/SKILL.md section 6): comment the Proof: line on the issue first, one entry per layer with the command or the reason that layer was skipped, then run this again. It is never invented at ship time and never written on the owner's behalf."
  } >&2
  exit 2
}

# The command read (clause split, flag values, repo, issue numbers, the cd
# bounce) is spec-guard's too: hooks/lib/gh-edit.sh.
clauses_text=$(hook_gh_clauses "$src")

# pg_repo_is_here <repo>: whether the repo value names the origin of the
# session's tree, owner/name in any letter case. No origin is never here.
pg_repo_is_here() {
  local want here
  here=$(wk_repo_slug "$cwd" | tr '[:upper:]' '[:lower:]')
  want=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  [ -n "$here" ] && [ "$want" = "$here" ]
}

# The qa flips seen, here, in another repo, or behind a repo value that could
# not be read: the touched-test run happens once per command, after the walk,
# and only for this tree. A repo flag that names this tree's origin is a flip here.
qa_here=0
qa_elsewhere=0
qa_unread=0
# A cd, pushd or popd clause seen before the one being judged.
saw_cd=0

while IFS= read -r clause; do

  [ -n "$clause" ] || continue
  detect=$(hook_strip_quotes "$clause")
  # shellcheck disable=SC2086  # the stripped clause's words; globbing is off
  if hook_clause_changes_dir $detect; then saw_cd=1; continue; fi
  sub=$(printf '%s' "$detect" \
    | grep -Eo '(^|[^[:alnum:]_./-])gh[[:space:]]+issue[[:space:]]+(edit|close)([[:space:]]|$)' \
    | head -n 1 | grep -Eo '(edit|close)$|(edit|close)[[:space:]]' | tr -d '[:space:]' || true)
  [ -n "$sub" ] || continue

  if [ "$sub" = close ]; then
    # Nothing was built, so nothing is proved: the two closes this gate ignores.
    # `--reason` and its short `-r` take "not planned" in any quoting;
    # `--duplicate-of <M>` says the same thing about a duplicate.
    if printf '%s' "$clause" | grep -Eqi -- '(^|[[:space:]])(--reason|-r)[=[:space:]]+["'"'"']?not[[:space:]\\]+planned'; then
      continue
    fi
    if printf '%s' "$clause" | grep -Eq -- '(^|[[:space:]])--duplicate-of[=[:space:]]'; then
      continue
    fi
  else
    # An edit only matters when it ADDS status:complete. The value is read whole
    # (quoted or bare) so a `--remove-label status:complete` never reads as one.
    labels=$(hook_gh_flag_values "$clause" --add-label)
    if printf '%s' "$labels" | grep -q 'status:qa'; then
      [ "$saw_cd" -eq 0 ] || hook_gh_block_cd proof-guard
      if ! qa_repo=$(hook_gh_repo "$clause"); then
        qa_unread=1
      elif [ -z "$qa_repo" ] || pg_repo_is_here "$qa_repo"; then
        qa_here=1
      else
        qa_elsewhere=1
      fi
    fi
    printf '%s' "$labels" | grep -q 'status:complete' || continue
  fi

  issues=$(hook_gh_issue_numbers "$detect" "$sub")
  [ -n "$issues" ] || continue
  [ "$saw_cd" -eq 0 ] || hook_gh_block_cd proof-guard

  # The repo, in every spelling gh takes. A value this cannot resolve (a
  # variable, a command substitution) makes the whole clause unreadable rather
  # than answered from the local repo.
  repo_unreadable=0
  repo=$(hook_gh_repo "$clause") || repo_unreadable=1

  for n in $issues; do
    if [ "$repo_unreadable" -eq 1 ]; then
      skipped "$n" "the --repo value could not be read"
      continue
    fi
    # The read runs where the gated command would run; a cwd that does not
    # resolve is unreadable, never a read of wherever this hook happens to sit.
    status=0
    (cd "$cwd" 2>/dev/null || exit 2; hook_issue_has_proof "$n" "$repo") || status=$?
    case "$status" in
      0) continue ;;
      1) ;;
      *) skipped "$n" "gh could not answer"; continue ;;
    esac
    if [ "$sub" = close ]; then
      block "$n" "be closed"
    else
      block "$n" "move to status:complete"
    fi
  done
done <<EOF
$clauses_text
EOF

if [ "$qa_here" -eq 1 ]; then
  check_qa_tests
elif [ "$qa_unread" -eq 1 ]; then
  hook_pretool_notice "proof-guard: could not read the repo value, so the touched-test run did not run."
elif [ "$qa_elsewhere" -eq 1 ]; then
  hook_pretool_notice "proof-guard: the flip names another repo, so the touched-test run did not run here."
fi

exit 0
