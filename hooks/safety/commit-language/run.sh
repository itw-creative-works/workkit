#!/bin/bash
# safety/commit-language: PreToolUse hook (Bash), the mechanical half of two
# commit rules: no kill/destroy/dead wording in a message, and a Conventional
# Commits subject (<=72 characters) carrying no version outside
# `chore(release)`. Only the quoted message-flag spans of a real commit are
# read. Scope and accepted misses: docs/hooks.md § safety:commit-language.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1 || ! command -v perl >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# --- Is this a real `git ... commit` COMMAND, not a mention? ---
# Detection reads the stripped command (hooks/lib/commit.sh); the span
# extraction below reads the original, so a quoted heredoc message stays scanned.
hook_find_git_commit "$cmd"
# A wrapped commit (`sh -c "git commit …"`) has no visible clause but is
# still a commit: scan it rather than stay silent.
[ -n "$HOOK_COMMIT_CLAUSE" ] || [ "$HOOK_WRAPPED_COMMIT" -eq 1 ] || exit 0

# --- Pull the MESSAGE spans: quoted values of -m/--message/-F/--file. ---
# With nothing extracted, every quoted span, toward gating. PERL_FLAG_RE carries
# the one regex into perl so the two passes never drift.
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
    echo "commit-language: BLOCKED this commit: the message uses non-neutral vocabulary: ${found}"
    echo "Reword per the AGENTS.md neutral-language rule (terminate not kill, remove not destroy, stale not dead) and commit again. If a listed word is a literal file/identifier name, keep it unquoted in the command or rephrase around it."
  } >&2
  exit 2
fi

# --- Subject-line FORMAT, only when a message flag gave us a real span. ---
# Re-extract from each `commit` word, first to last, and take the first suffix
# yielding a flag span: an earlier flag-shaped span is never the subject, and
# every -m keeps its order. Nothing extracted means no verdict (fail open).
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
# the hook cannot expand: judging it as a subject would bounce a message we
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
    echo "commit-language: BLOCKED this commit: the subject line is not Conventional Commits: ${subject}"
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
    echo "commit-language: BLOCKED this commit: the subject line is ${len} characters, over the 72-character limit."
    echo "Shorten the subject and move the detail into the commit body."
  } >&2
  exit 2
fi

if printf '%s' "$subject" | grep -Eqw 'v?[0-9]+\.[0-9]+\.[0-9]+' \
  && ! printf '%s' "$subject" | grep -Eq '^chore\(release\): '"$HOOK_VERSION_RE"'$'; then
  {
    echo "commit-language: BLOCKED this commit: the subject line carries a version number: ${subject}"
    echo "Only the release commit names a version, as chore(release): <x.y.z>. Describe the change instead; the version bump is its own commit."
  } >&2
  exit 2
fi

exit 0
