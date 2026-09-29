#!/bin/bash
# docs:state-check: SessionStart hook. Announces the upkeep a repo owes: open
# status:inbox issues, a non-empty .workkit/capture.md, a repo CLAUDE.md, an
# AGENTS.md over its budget. Detection is automatic, the fix stays the agent's;
# silent when all is current. The issue count is the one network call, bounded,
# and any failure is a silent skip. Detail: docs/hooks.md.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Sourced for hook_sha1 (the cache key is a digest, spelled per platform) and
# for the AGENTS.md budget.
. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

cwd=$(hook_jq -r '.cwd // ""' <<<"$input")

# Bounded run for the one command that touches the network. macOS ships no
# `timeout`; perl's alarm is the portable stand-in.
run_bounded() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$secs" "$@"
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' "$secs" "$@"
  else
    "$@"
  fi
}

# Count entry lines: non-blank, not headings, not blockquote header notes.
# (grep -c prints its count even when exiting 1 on zero matches. Don't add
# a fallback echo or the count doubles.)
count_entries() {
  local file c
  file="$1"
  [ -f "$file" ] || { echo 0; return; }
  c=$(grep -cvE '^[[:space:]]*$|^#|^>' "$file" 2>/dev/null) || true
  echo "${c:-0}"
}

msg=""

# Captured-but-unrouted issues; only a silent count is cached, about 30
# minutes per repo (docs/hooks.md § docs:state-check).
if [ -n "$cwd" ] && command -v gh >/dev/null 2>&1 \
  && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  cache_dir="${STATE_CHECK_CACHE:-$HOME/.claude/logs/state-check}"
  mkdir -p "$cache_dir" 2>/dev/null || true
  repo_key=$(printf '%s' "$cwd" | hook_sha1 2>/dev/null || true)
  cache_file="$cache_dir/${repo_key:-nokey}"
  n=""
  if [ -n "$repo_key" ] && [ -f "$cache_file" ] \
    && [ -n "$(find "$cache_file" -mmin -30 2>/dev/null)" ]; then
    n=$(cat "$cache_file" 2>/dev/null)
  fi
  if [ -z "$n" ]; then
    issues=$(cd "$cwd" && run_bounded 5 gh issue list --state open --label status:inbox --json number --limit 1000 2>/dev/null) || issues=""
    if [ -n "$issues" ]; then
      n=$(hook_jq_default '0' -r 'length' <<<"$issues")
      case "$n" in ''|*[!0-9]*) n=0 ;; esac
      # `|| true`: this is the last command of the block, and an empty repo_key
      # would make the block return 1. set -e would end the hook right here,
      # before the CLAUDE.md and AGENTS.md checks below ever run.
      if [ -n "$repo_key" ]; then
        if [ "$n" -eq 0 ]; then
          printf '%s' "$n" >"$cache_file" 2>/dev/null || true
        else
          # A count worth announcing is never held: the queue it describes can
          # be drained at any moment, and a stale alarm outlives its truth.
          rm -f "$cache_file" 2>/dev/null || true
        fi
      fi
    fi
  fi
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  if [ "$n" -gt 0 ]; then
    msg="ISSUES: $n open status:inbox issue$([ "$n" -eq 1 ] && echo '' || echo s). Run triage (workkit:triage) to route them."
  fi
fi

# Local capture file: the offline/free-form half of the same intake.
# The directory name is spelled out even though _lib.sh is sourced above; its
# SSOT is WORKKIT_DIR there. Change both together.
if [ -n "$cwd" ] && [ -f "$cwd/.workkit/capture.md" ]; then
  sn=$(count_entries "$cwd/.workkit/capture.md")
  if [ "$sn" -gt 0 ]; then
    [ -n "$msg" ] && msg="$msg "
    msg="${msg}SCRATCH: the local capture file has entries ($cwd/.workkit/capture.md): triage drains it."
  fi
fi

# A repo CLAUDE.md (docs/project-state.md § Repo docs): Claude Code reads
# AGENTS.md itself, and a project CLAUDE.md stops that read. Its shape picks the fix.
# The user-level ~/.claude/CLAUDE.md is no repo file and has no AGENTS.md to yield to.
user_claude=$(cd "$HOME/.claude" 2>/dev/null && pwd -P) || user_claude=""
if [ -n "$cwd" ] && [ -f "$cwd/CLAUDE.md" ] \
  && [ "$(cd "$cwd" 2>/dev/null && pwd -P)" != "$user_claude" ]; then
  [ -n "$msg" ] && msg="$msg "
  if ! grep -qv -e '^[[:space:]]*$' -e '^[[:space:]]*@AGENTS\.md[[:space:]]*$' "$cwd/CLAUDE.md" 2>/dev/null; then
    msg="${msg}CLAUDE.md is only the @AGENTS.md pointer, and Claude Code reads AGENTS.md itself. Delete it: git rm CLAUDE.md."
  elif [ ! -e "$cwd/AGENTS.md" ]; then
    msg="${msg}CLAUDE.md holds content and no AGENTS.md sits beside it; a project CLAUDE.md stops Claude Code reading AGENTS.md. Rename it: git mv CLAUDE.md AGENTS.md (the rename keeps its history)."
  else
    msg="${msg}CLAUDE.md holds content beside an AGENTS.md; a project CLAUDE.md stops Claude Code reading AGENTS.md. Merge it into AGENTS.md by hand, then git rm CLAUDE.md."
  fi
fi

if [ -n "$cwd" ] && [ -f "$cwd/AGENTS.md" ]; then
  read -r al ad _ <<<"$(hook_agents_budget "$cwd/AGENTS.md")"
  if [ "$al" -gt "$HOOK_AGENTS_MAX_LINES" ]; then
    [ -n "$msg" ] && msg="$msg "
    msg="${msg}AGENTS.md is $al lines (budget $HOOK_AGENTS_MAX_LINES). Move deep references to docs/<topic>.md and keep pointer lines; the board-guard hook bounces writes until it fits."
  fi
  # The density half of the same budget: a file well inside the line count
  # still carries a book when its paragraphs are single source lines.
  if [ "$ad" -gt 0 ]; then
    [ -n "$msg" ] && msg="$msg "
    msg="${msg}AGENTS.md has $ad line$([ "$ad" -eq 1 ] && echo '' || echo s) over $HOOK_AGENTS_MAX_BYTES bytes (density rule). Bulletize them or move the detail to docs/<topic>.md; the board-guard hook bounces writes until it fits."
  fi
fi

[ -n "$msg" ] || exit 0

hook_jq -n --arg ctx "$msg" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
exit 0
