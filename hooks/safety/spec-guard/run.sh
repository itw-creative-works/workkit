#!/bin/bash
# safety/spec-guard: PreToolUse hook (Bash), the mechanical half of the spec's
# Contract rule (docs/project-state.md § Specs). Blocks the flip to
# status:specced while the issue's `## Spec` is written but carries no
# `### Contract` (the `None needed: small item.` spec passes). A flip behind a
# cd bounces; it fails open, out loud. Detail: docs/hooks.md § safety:spec-guard.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# Cheap exits first, on the raw text: a flip has to spell `gh issue edit` and
# `status:specced` for the label to apply, so nothing else pays for the walk.
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+issue[[:space:]]+edit([[:space:]]|$)' || exit 0
printf '%s' "$cmd" | grep -q 'status:specced' || exit 0

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# The same preparation proof-guard does: a heredoc BODY is file content, and a
# redirect's `&` is folded so `2>&1` never cuts a clause.
src=$(hook_strip_heredocs "$cmd")
src=$(hook_fold_redirect_amp "$src")

skipped() {
  echo "spec-guard: could not read issue #$1 ($2), so the spec gate did not run on this command." >&2
}

block() {
  echo "spec-guard: BLOCKED this flip: #$1 has a written Spec with no ### Contract (docs/project-state.md § Specs): add Files, Names and Cases, or the small-item line None needed: small item., then flip." >&2
  exit 2
}

block_body_edit() {
  echo "spec-guard: BLOCKED this flip: #$1 edits its body and flips in one command, so the read would judge the old body. Edit the body in its own command, then flip." >&2
  exit 2
}

# The command read (clause split, flag values, repo, issue numbers, the cd
# bounce) is proof-guard's too: hooks/lib/gh-edit.sh.
clauses_text=$(hook_gh_clauses "$src")

# sg_spec_ok: is the issue body on stdin's `## Spec` the small-item line or
# holding a `### Contract` heading? No Spec section at all is not ok. A `## `
# line inside a code fence is an example, never the next section.
sg_spec_ok() {
  local spec
  spec=$(tr -d '\r' | awk '
    /^```/ { fence = !fence }
    /^## / && !fence { if (in_spec) done = 1; else if ($0 ~ /^## Spec[[:space:]]*$/) { in_spec = 1; next } }
    in_spec && !done { print }
  ')
  grep -Eq '^### Contract[[:space:]]*$' <<<"$spec" && return 0
  [ "$(grep -v '^[[:space:]]*$' <<<"$spec" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')" = 'None needed: small item.' ]
}

# A cd, pushd or popd clause seen before the one being judged.
saw_cd=0

while IFS= read -r clause; do

  [ -n "$clause" ] || continue
  detect=$(hook_strip_quotes "$clause")
  # shellcheck disable=SC2086  # the stripped clause's words; globbing is off
  if hook_clause_changes_dir $detect; then saw_cd=1; continue; fi
  printf '%s' "$detect" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+issue[[:space:]]+edit([[:space:]]|$)' || continue

  # The value is read whole (quoted or bare), so a `--remove-label
  # status:specced` or a body naming the label never reads as the flip.
  labels=$(hook_gh_flag_values "$clause" --add-label)
  grep -q 'status:specced' <<<"$labels" || continue

  issues=$(hook_gh_issue_numbers "$detect" edit)
  [ -n "$issues" ] || continue
  [ "$saw_cd" -eq 0 ] || hook_gh_block_cd spec-guard
  # Read off the quote-stripped clause, so a body naming the flag is not one.
  if printf '%s' "$detect" | grep -Eq -- '(^|[[:space:]])(--body(-file)?([=[:space:]]|$)|-[bF])'; then
    for n in $issues; do block_body_edit "$n"; done
  fi

  # A repo value this cannot resolve (a variable, a substitution) makes the
  # clause unreadable rather than answered from the local repo.
  repo_unreadable=0
  repo=$(hook_gh_repo "$clause") || repo_unreadable=1

  for n in $issues; do
    if [ "$repo_unreadable" -eq 1 ]; then
      skipped "$n" "the --repo value could not be read"
      continue
    fi
    # The read runs where the flip would run; a cwd that does not resolve is
    # unreadable, never a read of wherever this hook happens to sit.
    view=$(cd "$cwd" 2>/dev/null && hook_issue_view "$n" body "$repo") || {
      skipped "$n" "gh could not answer"
      continue
    }
    body=$(hook_jq -r '.body // ""' <<<"$view" 2>/dev/null) || {
      skipped "$n" "the body did not parse"
      continue
    }
    sg_spec_ok <<<"$body" || block "$n"
  done
done <<EOF
$clauses_text
EOF

exit 0
