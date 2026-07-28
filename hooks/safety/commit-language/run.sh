#!/bin/bash
# safety/commit-language — PreToolUse hook (Bash)
# The mechanical half of two AGENTS.md commit rules.
#   1. Vocabulary (plan guard 5): commit MESSAGES must not carry kill/destroy/
#      dead wording — safety classifiers judge wording without task context.
#      The judgment half (tone, register) stays prose.
#   2. Format: the SUBJECT line must be Conventional Commits
#      (`<type>(<scope>)?: <subject>`, lowercase subject start, <=72 chars),
#      and must not carry a version number unless the commit is the release
#      commit `chore(release): <x.y.z>`. Merge/revert/fixup/squash subjects
#      pass unexamined.
#
# Scope: only real `git ... commit` commands, and only the QUOTED spans of
# their message flags (-m/--message/-F/--file) — that is where message text
# lives (-m "...", including the usual -m "$(cat <<'EOF' ...)" idiom, whose
# body sits inside the outer quotes). Unquoted words (file paths, flags) are
# never scanned, so committing a file named kill-switch.md cannot bounce.
# When no message span extracts (unquoted message, unusual spelling) the scan
# falls back to EVERY quoted span — toward gating, never toward silence. A
# flag-adjacent quoted span elsewhere on the line (`grep -F "..."`) is the
# accepted residual false positive: reword, or HOOK_DISABLE=1. Known accepted
# misses (fail-open by design): a bare `git commit -F - <<EOF` body is
# unquoted and not scanned; the '\'' apostrophe-escape idiom splits a span
# mid-word. The FORMAT checks run only on flag-extracted spans, never on the
# fallback: an arbitrary quoted span (`echo "done"`) is not a subject line.
# They also read only the part of the command FROM the commit token onward,
# so an earlier flag-shaped span (`grep -F "Some Thing" && git commit …`) is
# never judged as a subject; the vocabulary scan keeps its whole-command
# reach, and its flag-adjacent false positive above stands.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1 || ! command -v perl >/dev/null 2>&1; then
  exit 0
fi

cmd=$(jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# --- Is this a real `git ... commit` COMMAND, not a mention? ---
# Shared detection (heredoc-body strip, multiline quote strip, clause scan):
# hooks/_lib.sh, used identically by the safety/commit-gate hook. Detection
# reads the STRIPPED command; the span extraction below still reads the
# ORIGINAL command, so the quoted `-m "$(cat <<EOF ...)"` message body stays
# scanned (a bare `-F - <<EOF` body is unquoted — the accepted miss above).
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"
hook_find_git_commit "$cmd"
# A wrapped commit (`sh -c "git commit …"`) has no visible clause but is
# still a commit — scan it rather than stay silent.
[ -n "$HOOK_COMMIT_CLAUSE" ] || [ "$HOOK_WRAPPED_COMMIT" -eq 1 ] || exit 0

# --- Pull the MESSAGE spans: quoted values of -m/--message/-F/--file. ---
# Scoped so quoted text elsewhere on the line (`… && echo "…"`) is not judged
# as commit-message vocabulary (hardening 2026-07-25). When nothing extracts,
# fall back to every quoted span (multiline-safe) — toward gating.
# One regex for both passes; PERL_FLAG_RE carries it into perl so the two
# extractions can never drift apart.
export PERL_FLAG_RE='(?:^|[\s;&|({])(?:-[a-zA-Z]*[mF]|--message|--file)[=\s]*("(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27)'
quoted=$(printf '%s' "$cmd" | perl -0777 -ne 'my $re = qr/$ENV{PERL_FLAG_RE}/s; while (/$re/g) { print substr($1, 1, -1), "\n" }' 2>/dev/null || true)
if [ -z "$quoted" ]; then
  quoted=$(printf '%s' "$cmd" | perl -0777 -ne 'while (/"((?:[^"\\]|\\.)*)"|\x27([^\x27]*)\x27/gs) { print defined $1 ? $1 : $2, "\n" }' 2>/dev/null || true)
fi
[ -n "$quoted" ] || exit 0

# Whole words, case-insensitive. Pairs from AGENTS.md: terminate not kill,
# remove not destroy, stale not dead.
found=$(printf '%s' "$quoted" | grep -Eiow 'kill(s|ed|ing)?|destroy(s|ed|ing)?|dead' | sort -fu | tr '\n' ' ' || true)
if [ -n "$found" ]; then
  {
    echo "commit-language: BLOCKED this commit — the message uses non-neutral vocabulary: ${found}"
    echo "Reword per the AGENTS.md neutral-language rule (terminate not kill, remove not destroy, stale not dead) and commit again. If a listed word is a literal file/identifier name, keep it unquoted in the command or rephrase around it."
  } >&2
  exit 2
fi

# --- Subject-line FORMAT, only when a message flag gave us a real span. ---
# Re-extract from the command text starting AT the commit token, so a
# flag-shaped span earlier on the line is not mistaken for the subject.
# HOOK_COMMIT_CLAUSE is quote-stripped and cannot be searched for verbatim,
# so we walk the `commit` word offsets FIRST to last and take the first
# suffix that yields a message-flag span. Forward is the safe direction: the
# earliest `commit` word already sits after any pre-commit flag span (the
# case this scoping exists for), and starting early keeps every -m of a
# multi-flag commit in order, so `-m "…the commit message" -m "Body."` still
# reads the first flag as the subject. A `commit` word that is only prose
# earlier on the line costs nothing — the scan from it finds the same real
# spans. Nothing extracted → no format verdict (fail open).
fmt_spans=$(printf '%s' "$cmd" | perl -0777 -ne '
  my $re = qr/$ENV{PERL_FLAG_RE}/s;
  my @off; while (/\bcommit\b/g) { push @off, $-[0] }
  for my $o (@off) {
    my $tail = substr($_, $o);
    my @spans; while ($tail =~ /$re/g) { push @spans, substr($1, 1, -1) }
    if (@spans) { print map { "$_\n" } @spans; last }
  }' 2>/dev/null || true)
[ -n "$fmt_spans" ] || exit 0

subject=$(printf '%s' "$fmt_spans" | head -n 1)
# The `-m "$(cat <<'EOF' … )"` idiom opens with the substitution itself; the
# subject is the first line of the heredoc body underneath it.
case "$subject" in
  *'$('*'<<'*) subject=$(printf '%s' "$fmt_spans" | sed -n '2p') ;;
esac
# Any OTHER command substitution (`-m "$(cat /tmp/msg.txt)"`) is shell text
# the hook cannot expand — judging it as a subject would bounce a message we
# never actually read. Fail open.
case "$subject" in
  *'$('*) exit 0 ;;
esac
subject=${subject#"${subject%%[![:space:]]*}"}
subject=${subject%"${subject##*[![:space:]]}"}
[ -n "$subject" ] || exit 0

# Subjects git or a rebase writes for you are never judged.
case "$subject" in
  'Merge '*|'Revert '*|'fixup! '*|'squash! '*) exit 0 ;;
esac

if ! printf '%s' "$subject" | grep -Eq '^(feat|fix|docs|chore|refactor|test)(\([^)]+\))?!?: [^A-Z]'; then
  {
    echo "commit-language: BLOCKED this commit — the subject line is not Conventional Commits: ${subject}"
    echo "Write it as <type>(<scope>): <subject> with type one of feat/fix/docs/chore/refactor/test and a lowercase first word, e.g. fix(hooks): bounce the empty span."
  } >&2
  exit 2
fi

# CHARACTERS, not bytes: `${#subject}` counts bytes under LC_ALL=C, so an em
# dash would spend 3 of the 72. perl -CS decodes stdin as UTF-8 whatever the
# locale is; a failed count falls back to the byte length.
len=$(printf '%s' "$subject" | perl -CS -ne 'chomp; print length' 2>/dev/null || true)
[ -n "$len" ] || len=${#subject}
if [ "$len" -gt 72 ]; then
  {
    echo "commit-language: BLOCKED this commit — the subject line is ${len} characters, over the 72-character limit."
    echo "Shorten the subject and move the detail into the commit body."
  } >&2
  exit 2
fi

if printf '%s' "$subject" | grep -Eqw 'v?[0-9]+\.[0-9]+\.[0-9]+' \
  && ! printf '%s' "$subject" | grep -Eq '^chore\(release\): v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$'; then
  {
    echo "commit-language: BLOCKED this commit — the subject line carries a version number: ${subject}"
    echo "Only the release commit names a version, as chore(release): <x.y.z>. Describe the change instead; the version bump is its own commit."
  } >&2
  exit 2
fi

exit 0
