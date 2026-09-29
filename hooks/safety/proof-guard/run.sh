#!/bin/bash
# safety/proof-guard: PreToolUse hook (Bash), the mechanical half of the spec's
# proof rule (docs/project-state.md § The proof). Blocks the flip to
# status:complete and `gh issue close <N>` while the issue carries no `Proof:`
# line (the never-built closes pass), and the flip to status:qa while a touched
# test file is red (checks/qa-tests.sh). The read runs from the session's
# directory; it fails open, out loud. Detail: docs/hooks.md § safety:proof-guard.

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

# The clauses, raw and quote aware, in one awk pass whose cost grows once with
# the command: a separator inside a quoted span is data, and a line break there
# becomes a space. With no awk the split is quote blind and may cut a body, the
# fallback's alone.
pg_split='
  BEGIN { st = "" }
  {
    out = ""; n = length($0)
    for (i = 1; i <= n; i++) {
      c = substr($0, i, 1)
      if (st == "") {
        if (c == DQ || c == SQ) { st = c; out = out c }
        else if (c == BS) { out = out c; i++; if (i <= n) out = out substr($0, i, 1) }
        else if (c == ";" || c == "|" || c == "&") { out = out "\n" }
        else out = out c
      } else if (st == DQ) {
        if (c == DQ) { st = "" ; out = out c }
        else if (c == BS) { out = out c; i++; if (i <= n) out = out substr($0, i, 1) }
        else out = out c
      } else {
        if (c == SQ) st = ""
        out = out c
      }
    }
    printf "%s", out
    printf "%s", (st == "" ? "\n" : " ")
  }
'
if command -v awk >/dev/null 2>&1; then
  clauses_text=$(printf '%s' "$src" | awk -v DQ='"' -v SQ="'" -v BS='\\' "$pg_split" 2>/dev/null) \
    || clauses_text=$(printf '%s' "$src" | tr ';|&' '\n')
else
  clauses_text=$(printf '%s' "$src" | tr ';|&' '\n')
fi

# The shell words of one clause, one a line, in ONE awk pass that keeps a quoted
# span inside its word: a flag named in a body is part of the body's word.
pg_words='
  {
    n = length($0); w = ""; st = ""; inw = 0
    for (i = 1; i <= n; i++) {
      c = substr($0, i, 1)
      if (st == "") {
        if (c == " " || c == "\t") { if (inw) { print w; w = ""; inw = 0 }; continue }
        inw = 1; w = w c
        if (c == DQ || c == SQ) st = c
        else if (c == BS && i < n) { i++; w = w substr($0, i, 1) }
      } else {
        w = w c
        if (st == DQ && c == BS && i < n) { i++; w = w substr($0, i, 1) }
        else if (c == st) st = ""
      }
    }
    if (inw) print w
  }
'

# pg_flag_values <clause> <long> [<short>]: every value the clause hands the
# flag, raw, one a line (`--flag v`, `--flag=v`, `-Sv`), a redirect before a
# separate value skipped. Without awk the words split on blanks, quote blind.
pg_flag_values() {
  local w words want=0 skip_next=0 span
  words=$(printf '%s\n' "$1" | awk -v DQ='"' -v SQ="'" -v BS='\\' "$pg_words" 2>/dev/null) \
    || words=$(printf '%s\n' "$1" | tr ' \t' '\n\n')
  while IFS= read -r w; do
    [ -n "$w" ] || continue
    if [ "$skip_next" -gt 0 ]; then skip_next=$((skip_next - 1)); continue; fi
    if [ "$want" -eq 1 ]; then
      span=$(hook_redirect_span "$w")
      if [ "$span" -gt 0 ]; then skip_next=$((span - 1)); continue; fi
      want=0; printf '%s\n' "$w"; continue
    fi
    case "$w" in
      "$2") want=1 ;;
      "$2"=*) printf '%s\n' "${w#"$2"=}" ;;
      *)
        if [ -n "${3:-}" ]; then
          case "$w" in "$3") want=1 ;; "$3"?*) printf '%s\n' "${w#"$3"}" ;; esac
        fi
        ;;
    esac
  done <<EOF
$words
EOF
  return 0
}

# pg_repo_value <clause>: the first `--repo`/`-R` value the clause hands gh,
# in any spelling it takes, with its quotes off.
pg_repo_value() {
  pg_flag_values "$1" --repo -R | sed -n 1p | tr -d "\"'"
}

# pg_repo_is_here <clause>: whether the clause's repo value names the origin of
# the session's tree, owner/name in any letter case. No origin is never here.
pg_repo_is_here() {
  local want here
  here=$(wk_repo_slug "$cwd" | tr '[:upper:]' '[:lower:]')
  want=$(pg_repo_value "$1" | tr '[:upper:]' '[:lower:]')
  [ -n "$here" ] && [ "$want" = "$here" ]
}

# A `--repo`/`-R` in any spelling gh takes, attached or not. Its presence is
# read off the quote-stripped clause, so a body that mentions it is not one.
repo_flag_re='(^|[[:space:]])(--repo([=[:space:]]|$)|-R)'

# The qa flips seen, here and in another repo: the touched-test run happens
# once per command, after the walk, and only for this tree. A repo flag that
# names this tree's origin is a flip here.
qa_here=0
qa_elsewhere=0

while IFS= read -r clause; do

  [ -n "$clause" ] || continue
  detect=$(hook_strip_quotes "$clause")
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
    labels=$(pg_flag_values "$clause" --add-label)
    if printf '%s' "$labels" | grep -q 'status:qa'; then
      if printf '%s' "$detect" | grep -Eq -- "$repo_flag_re" && ! pg_repo_is_here "$clause"; then
        qa_elsewhere=1
      else
        qa_here=1
      fi
    fi
    printf '%s' "$labels" | grep -q 'status:complete' || continue
  fi

  after=$(printf '%s' "$detect" | sed -E "s/^.*gh[[:space:]]+issue[[:space:]]+$sub[[:space:]]+//")
  issues=""
  skip_next=0
  for tok in $after; do
    if [ "$skip_next" -eq 1 ]; then skip_next=0; continue; fi
    # A redirect is shell syntax, never the positional: a bare operator hands
    # its target to the next word, an attached one carries it.
    case "$tok" in
      -*) break ;;
      *'>'*|*'<'*)
        span=$(hook_redirect_span "$tok")
        if [ "$span" -gt 0 ]; then skip_next=$((span - 1)); continue; fi
        ;;
    esac
    n="${tok#\#}"
    case "$n" in
      ''|*[!0-9]*) break ;;
    esac
    case " $issues " in
      *" $n "*) continue ;;
    esac
    issues="$issues $n"
  done
  [ -n "$issues" ] || continue

  # The repo, in every spelling gh takes: `--repo owner/name`,
  # `--repo=owner/name`, `-R owner/name`, `-Rowner/name`, quoted or bare. A
  # value this cannot resolve (a variable, a command substitution) makes the
  # whole clause unreadable rather than answered from the local repo.
  repo=""
  repo_unreadable=0
  if printf '%s' "$detect" | grep -Eq -- "$repo_flag_re"; then
    repo=$(pg_repo_value "$clause")
    case "$repo" in
      ''|*'$'*|*'`'*|*_hookq_*) repo_unreadable=1 ;;
    esac
  fi

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
elif [ "$qa_elsewhere" -eq 1 ]; then
  hook_pretool_notice "proof-guard: the flip names another repo, so the touched-test run did not run here."
fi

exit 0
