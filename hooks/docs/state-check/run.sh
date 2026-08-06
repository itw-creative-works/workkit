#!/bin/bash
# docs:state-check — SessionStart hook
# Announces project-state upkeep so nothing rots silently:
#   1. open status:inbox issues on the cwd repo (the captured-but-unrouted
#      queue — triage is the action that drains it)
#   2. a non-empty .workkit/capture.md (the local capture file)
#   3. a content-bearing CLAUDE.md (doctrine: content lives in AGENTS.md;
#      CLAUDE.md is a one-line @AGENTS.md pointer)
#   4. an oversized AGENTS.md (>250 lines — deep references belong in docs/)
# This is the auto-heal trigger: every session that opens in a repo learns
# immediately what needs attention — no manual sweeps. Detection is automatic;
# the fixing stays agent-executed. Silent when everything is current.
#
# The issue count is the only network call: read-only, short timeout, and any
# failure (offline, no gh, not a repo, unauthenticated) is a silent skip.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

cwd=$(jq -r '.cwd // ""' <<<"$input")

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
# (grep -c prints its count even when exiting 1 on zero matches — don't add
# a fallback echo or the count doubles.)
count_entries() {
  local file c
  file="$1"
  [ -f "$file" ] || { echo 0; return; }
  c=$(grep -cvE '^[[:space:]]*$|^#|^>' "$file" 2>/dev/null) || true
  echo "${c:-0}"
}

msg=""

# Captured-but-unrouted work items (GitHub Issues are the SSOT).
# The count is cached ~30 min per repo — a network call on EVERY new panel is
# the latency the standards hook's daily marker exists to avoid (review
# finding 2026-07-24). Stale or missing cache = refresh.
#
# ONLY SILENCE IS CACHED (issue #1). Triage drains status:inbox by editing
# labels on GitHub, which leaves no local trace this hook could fingerprint,
# and a skill cannot be relied on to run an invalidate command — so the cache
# has to invalidate itself. It does, by never holding an announcement: an empty
# queue is written to the cache, a non-empty one is re-queried every session and
# the old entry removed. The moment triage empties the queue, the next session
# asks GitHub and goes quiet, with no cooperation from the skill at all.
# The trade is one bounded query per session while the inbox is non-empty —
# paid only in the state the announcement is telling you to clear.
if [ -n "$cwd" ] && command -v gh >/dev/null 2>&1 \
  && git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  cache_dir="${STATE_CHECK_CACHE:-$HOME/.claude/logs/state-check}"
  mkdir -p "$cache_dir" 2>/dev/null || true
  repo_key=$(printf '%s' "$cwd" | shasum 2>/dev/null | cut -d' ' -f1 || true)
  cache_file="$cache_dir/${repo_key:-nokey}"
  n=""
  if [ -n "$repo_key" ] && [ -f "$cache_file" ] \
    && [ -n "$(find "$cache_file" -mmin -30 2>/dev/null)" ]; then
    n=$(cat "$cache_file" 2>/dev/null)
  fi
  if [ -z "$n" ]; then
    issues=$(cd "$cwd" && run_bounded 5 gh issue list --state open --label status:inbox --json number --limit 100 2>/dev/null) || issues=""
    if [ -n "$issues" ]; then
      n=$(jq -r 'length' <<<"$issues" 2>/dev/null) || n=0
      case "$n" in ''|*[!0-9]*) n=0 ;; esac
      # `|| true`: this is the last command of the block, and an empty repo_key
      # would make the block return 1 — set -e would end the hook right here,
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
    msg="ISSUES: $n open status:inbox issue$([ "$n" -eq 1 ] && echo '' || echo s) — run triage (workkit:triage) to route them."
  fi
fi

# Local capture file — the offline/free-form half of the same intake.
# This hook sources nothing, so the directory name is spelled out; its SSOT is
# WORKKIT_DIR in hooks/_lib.sh — change both together.
if [ -n "$cwd" ] && [ -f "$cwd/.workkit/capture.md" ]; then
  sn=$(count_entries "$cwd/.workkit/capture.md")
  if [ "$sn" -gt 0 ]; then
    [ -n "$msg" ] && msg="$msg "
    msg="${msg}SCRATCH: the local capture file has entries ($cwd/.workkit/capture.md) — triage drains it."
  fi
fi

# Content-bearing CLAUDE.md detection (pointer doctrine). A compliant file is
# essentially just the @AGENTS.md import — >3 non-blank lines means content.
if [ -n "$cwd" ] && [ -f "$cwd/CLAUDE.md" ]; then
  cl=$(grep -cv '^[[:space:]]*$' "$cwd/CLAUDE.md" 2>/dev/null) || true
  if [ "${cl:-0}" -gt 3 ] || ! grep -q '@AGENTS.md' "$cwd/CLAUDE.md" 2>/dev/null; then
    [ -n "$msg" ] && msg="$msg "
    msg="${msg}CLAUDE.md holds content — convert BEFORE other work: git mv CLAUDE.md AGENTS.md (own commit), THEN add a one-line @AGENTS.md-pointer CLAUDE.md in a SEPARATE commit (same commit breaks rename history)."
  fi
fi

# Oversized AGENTS.md detection (doc-parity doctrine: ≤250 lines, meat in docs/)
if [ -n "$cwd" ] && [ -f "$cwd/AGENTS.md" ]; then
  al=$(wc -l <"$cwd/AGENTS.md" | tr -d ' ')
  if [ "${al:-0}" -gt 250 ]; then
    [ -n "$msg" ] && msg="$msg "
    msg="${msg}AGENTS.md is $al lines (budget 250) — move deep references to docs/<topic>.md and keep pointer lines; the board-guard hook bounces writes until it fits."
  fi
fi

[ -n "$msg" ] || exit 0

jq -n --arg ctx "$msg" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
exit 0
