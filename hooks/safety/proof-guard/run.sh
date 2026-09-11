#!/bin/bash
# safety/proof-guard: PreToolUse hook (Bash)
# The mechanical half of the spec's proof rule (docs/project-state.md, "The
# proof"): a `Proof:` line is a HARD GATE (owner ruling, 2026-09-10, issue
# #233), so no item reaches `status:complete` or closes without one. This guard
# blocks the two commands that make that move:
#   gh issue edit <N> ... --add-label ...status:complete...
#   gh issue close <N>
# when the issue's comments carry no line that starts `Proof:` (the read is
# hook_issue_has_proof in hooks/_lib.sh, shared with safety/commit-gate check
# 6, which holds the same gate on the `Fixes #N` trailer). Two closes pass
# untouched, because nothing was built to prove: `--reason "not planned"` (`-r`
# is the same flag) and `--duplicate-of <M>`.
#
# The read runs from the SESSION'S directory (the payload's `cwd`), which is
# where the gated command itself would run: an issue number with no `--repo`
# resolves against that directory's repo, so asking from anywhere else could
# judge an issue of the same number in another repo.
#
# Scope: the command text, one clause at a time. Clause boundaries are quote
# AWARE (verifier finding, 2026-09-10): a `;` inside `--body "a; b"` is data,
# and splitting on it cut the clause in half, which hid the `--add-label` that
# followed. Detection (the subcommand, the issue numbers) reads the quote
# STRIPPED copy of each clause, where a quoted span can never look like a flag
# or a number; the flag VALUES are read from the raw clause, since the strip is
# what removes them. A separator inside a quoted span is rejoined as a space,
# which no value this reads can care about.
#
# The issue is read as a plain number standing before the first flag, which is
# the shape the skills write. Two spellings gh also accepts pass unrecognised,
# on purpose: an issue URL or an `owner/repo#N` argument (judging one means
# guessing which repo to ask), and a number sitting after a flag (a flag value
# that is itself a number would read as an issue).
#
# Fail open, out loud: no jq, no gh, a view that exits non-zero, or a
# `--repo`/`-R` whose value cannot be read (a variable, a substitution) leaves
# the command alone and says on stderr that the gate did not run. A guard that
# cannot reach GitHub must never wedge a session, and an unreadable `--repo` is
# never answered by reading the LOCAL repo instead.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

cmd=$(jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# Cheap exits first, both on the RAW text and both above any splitting, since
# every Bash command in the session pays for whatever sits here (verifier
# finding, 2026-09-10: the walk below used to run for every `gh issue edit`,
# whatever its body).
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+issue[[:space:]]+(edit|close)([[:space:]]|$)' || exit 0
# Only two commands can reach the gate, and each leaves a literal string behind:
# the flip has to spell `status:complete` for the label to be applied at all,
# and the close has to spell `gh issue close`. Neither can hide in a variable
# and still do what it does, so this hides nothing from the walk.
if ! printf '%s' "$cmd" | grep -q 'status:complete' \
  && ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+issue[[:space:]]+close([[:space:]]|$)'; then
  exit 0
fi

cwd=$(jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# Shared text handling (heredoc-body strip, quote strip, the proof read):
# hooks/_lib.sh, the same preparation the commit hooks and tree-guard do before
# walking clauses. A heredoc BODY is file content, not a command.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"
src=$(hook_strip_heredocs "$cmd")

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

# The clauses, raw and quote aware, in ONE pass over the command: the shell's
# separators become line breaks, except inside a quoted span, where they are
# data (a `;` in `--body "a; b"` used to cut the clause in half and hide the
# `--add-label` behind it). A line break that itself falls inside a quoted span
# becomes a space, so one clause is always one line.
# The pass is awk's, and deliberately not a bash character loop: the loop this
# replaced re-scanned everything it had accumulated once per fragment, so a
# command whose body was a long markdown table took seconds (verifier finding,
# 2026-09-10). Cost now grows with the length of the command, once.
# With no awk at all the split degrades to the quote-blind one, which can cut a
# clause at a separator inside a body, in either direction: a flip may pass
# ungated, and a never-built close whose comment carries a separator may
# bounce. Both are the fallback's only; the awk path does neither.
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
    labels=$(printf '%s' "$clause" \
      | grep -Eo -- '--add-label[=[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)' || true)
    printf '%s' "$labels" | grep -q 'status:complete' || continue
  fi

  after=$(printf '%s' "$detect" | sed -E "s/^.*gh[[:space:]]+issue[[:space:]]+$sub[[:space:]]+//")
  issues=""
  for tok in $after; do
    case "$tok" in
      -*) break ;;
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
  if printf '%s' "$clause" | grep -Eq -- '(^|[[:space:]])(--repo([=[:space:]]|$)|-R)'; then
    repo=$(printf '%s' "$clause" \
      | grep -Eo -- '(^|[[:space:]])(--repo[=[:space:]]+|-R[[:space:]]*)("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+)' \
      | head -n 1 | sed -E 's/^[[:space:]]*(--repo[=[:space:]]+|-R[[:space:]]*)//' | tr -d "\"'" || true)
    case "$repo" in
      ''|*'$'*|*'`'*|*_hookq_*) repo_unreadable=1 ;;
    esac
  fi

  for n in $issues; do
    if [ "$repo_unreadable" -eq 1 ]; then
      skipped "$n" "the --repo value could not be read"
      continue
    fi
    # The read runs where the gated command would run; a cwd that no longer
    # resolves is unreadable, never a read of wherever this hook happens to sit.
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

exit 0
