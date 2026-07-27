#!/bin/bash
# safety/commit-language — PreToolUse hook (Bash)
# The mechanical half of the AGENTS.md neutral-language rule (plan guard 5):
# commit MESSAGES must not carry kill/destroy/dead vocabulary — safety
# classifiers judge wording without task context. The judgment half (tone,
# register) stays prose.
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
# mid-word.

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
quoted=$(printf '%s' "$cmd" | perl -0777 -ne 'while (/(?:^|[\s;&|({])(?:-[a-zA-Z]*[mF]|--message|--file)[=\s]*("(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27)/gs) { print substr($1, 1, -1), "\n" }' 2>/dev/null || true)
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

exit 0
