#!/bin/bash
# safety/proof-guard: PreToolUse hook (Bash), the mechanical half of the spec's
# proof rule (docs/project-state.md § The proof). Blocks the flip to
# status:complete and `gh issue close <N>` while the issue carries no `Proof:`
# line (the never-built closes pass), and the flip to status:qa while a touched
# test file is red (checks/qa-tests.sh), in the roster folder of the repo the
# flip names. Any of them behind a cd, or naming a repo it cannot read, bounces;
# a failed read fails open, out loud.
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
hook_gh_names "$cmd" 'edit|close' || exit 0
# Only three commands can reach the guard, and each leaves a literal behind: a
# flip has to spell `status:complete` or `status:qa` for the label to apply, and
# the close has to spell `gh issue close`. None can hide in a variable and still
# do its work, so this hides nothing from the walk.
if ! printf '%s' "$cmd" | grep -q 'status:complete' \
  && ! printf '%s' "$cmd" | grep -q 'status:qa' \
  && ! hook_gh_names "$cmd" close; then
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

# A repo value written as a variable, substitution or quoted span names no
# repo the gate can place, so the command bounces instead of being guessed at.
block_unread() {
  echo "proof-guard: BLOCKED this command. Its --repo value could not be read (a variable, a command substitution, a backtick or a quoted span), so the gate cannot tell which repo the flip or close acts on. Write the repo out as owner/name, then run it again." >&2
  exit 2
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

# The qa flips seen, here or in other repos (each once, lower case): the
# touched-test run happens once per command, after the walk, in its one repo.
# A repo flag that names this tree's origin is a flip here.
qa_here=0
qa_others=""
# A cd, pushd or popd clause seen before the one being judged.
saw_cd=0

while IFS= read -r clause; do

  [ -n "$clause" ] || continue
  detect=$(hook_strip_quotes "$clause")
  # shellcheck disable=SC2086  # the stripped clause's words; globbing is off
  if hook_clause_changes_dir $detect; then saw_cd=1; continue; fi
  sub=$(hook_gh_clause_sub "$detect")
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
      qa_repo=$(hook_gh_repo "$clause") || block_unread
      if [ -z "$qa_repo" ] || hook_gh_repo_is_here "$qa_repo" "$cwd"; then
        qa_here=1
      else
        qa_repo=$(printf '%s' "$qa_repo" | tr '[:upper:]' '[:lower:]')
        case " $qa_others " in *" $qa_repo "*) ;; *) qa_others="${qa_others:+$qa_others }$qa_repo" ;; esac
      fi
    fi
    printf '%s' "$labels" | grep -q 'status:complete' || continue
  fi

  issues=$(hook_gh_issue_numbers "$detect" "$sub")
  [ -n "$issues" ] || continue
  [ "$saw_cd" -eq 0 ] || hook_gh_block_cd proof-guard

  # The repo, in every spelling gh takes. A value this cannot resolve (a
  # variable, a command substitution) bounces rather than being answered from
  # the local repo.
  repo=$(hook_gh_repo "$clause") || block_unread

  for n in $issues; do
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

# Flips in more than one repo bounce, since one run proves one repo. Another
# repo's flip runs in its roster folder; one absent or declined there is not
# opted in, so the run steps aside.
# shellcheck disable=SC2086  # the space-separated slugs; globbing is off
set -- $qa_others
if [ $((qa_here + $#)) -gt 1 ]; then
  qa_names="$*"
  qa_names="${qa_names// /, }"
  if [ "$qa_here" -eq 1 ]; then
    qa_here_name=$(wk_repo_slug "$cwd")
    [ -n "$qa_here_name" ] || qa_here_name="the session's repo"
    qa_names="$qa_here_name, $qa_names"
  fi
  echo "proof-guard: BLOCKED this command. Its flips to status:qa span more than one repo ($qa_names), and the touched-test run proves one repo per command. Run one command per repo, then each flip is proved in its own repo." >&2
  exit 2
fi
if [ "$qa_here" -eq 1 ]; then
  check_qa_tests "$cwd"
elif [ "$#" -eq 1 ]; then
  if qa_folder=$(wk_roster_path "$1"); then
    check_qa_tests "$qa_folder"
  else
    hook_pretool_notice "proof-guard: $1 is not opted in on this machine's workkit roster (absent or declined), so the touched-test run did not run."
  fi
fi

exit 0
