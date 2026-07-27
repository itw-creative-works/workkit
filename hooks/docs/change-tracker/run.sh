#!/bin/bash
# docs:change-tracker — Stop hook
# Nudges Claude to keep the work item (a GitHub issue) true, promote durable
# findings out of .workkit/, and check doc-parity.
# Prompt content lives in prompt.md (same directory).
# Reads files only — never calls gh. A network round trip on every Stop is
# latency nobody agreed to pay.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

stop_hook_active=$(jq -r '.stop_hook_active // false' <<<"$input" || true)
cwd=$(jq -r '.cwd // ""' <<<"$input" || true)
session_id=$(jq -r '.session_id // ""' <<<"$input" || true)

if [ "$stop_hook_active" = "true" ]; then
  exit 0
fi

[ -n "$cwd" ] || exit 0
cd "$cwd" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

status=$(git status --porcelain 2>/dev/null || true)

# Unfiled inbox entries (non-header, non-quote, non-blank lines). Mid-session
# additions are otherwise invisible until the next session's state-check.
inbox_count=0
if [ -f "INBOX.md" ]; then
  inbox_count=$(grep -cv -e '^#' -e '^>' -e '^[[:space:]]*$' INBOX.md 2>/dev/null || true)
  case "$inbox_count" in ''|*[!0-9]*) inbox_count=0 ;; esac
fi

# Local capture file — same entry rule, deliberate drain (never auto-emptied).
# This hook sources nothing, so the directory name is spelled out; its SSOT is
# WORKKIT_DIR in hooks/_lib.sh — change both together.
scratch_count=0
if [ -f ".workkit/inbox.md" ]; then
  scratch_count=$(grep -cv -e '^#' -e '^>' -e '^[[:space:]]*$' .workkit/inbox.md 2>/dev/null || true)
  case "$scratch_count" in ''|*[!0-9]*) scratch_count=0 ;; esac
fi

[ -n "$status" ] || [ "$inbox_count" -gt 0 ] || [ "$scratch_count" -gt 0 ] || exit 0

has_code_change=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  path="${line:3}"
  case "$path" in
    *" -> "*) path="${path##* -> }" ;;
  esac
  path="${path%\"}"; path="${path#\"}"
  base="$(basename "$path")"

  is_doc=0
  case "$path" in
    docs/*|*/docs/*) is_doc=1 ;;
    # Session state, never committed — it has its own nudge below, and it is
    # never the "uncommitted code" this hook is watching for.
    .workkit|.workkit/*) is_doc=1 ;;
  esac
  case "$base" in
    *.md|CHANGELOG|CHANGELOG.*|LICENSE|LICENSE.*) is_doc=1 ;;
  esac

  if [ "$is_doc" -eq 0 ]; then
    has_code_change=1
    break
  fi
done <<<"$status"

[ "$has_code_change" -eq 1 ] || [ "$inbox_count" -gt 0 ] || [ "$scratch_count" -gt 0 ] || exit 0

# Dedupe: nudge once per unique dirty state per session. If the tree hasn't
# changed since the last nudge, stay silent — a turn that touched nothing
# (pure Q&A over a pre-existing dirty tree) shouldn't re-block every Stop.
if [ -n "$session_id" ]; then
  marker_dir="${TMPDIR:-/tmp}/claude-change-tracker"
  mkdir -p "$marker_dir" 2>/dev/null || true
  safe_session="${session_id//[^a-zA-Z0-9]/_}"
  marker="$marker_dir/${safe_session}.last"
  status_hash=$(printf '%s|inbox=%s|scratch=%s' "$status" "$inbox_count" "$scratch_count" | shasum 2>/dev/null | cut -d' ' -f1 || true)
  if [ -n "$status_hash" ] && [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$status_hash" ]; then
    exit 0
  fi
  [ -n "$status_hash" ] && printf '%s' "$status_hash" >"$marker" 2>/dev/null || true
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPT_FILE="$SCRIPT_DIR/prompt.md"

if [ -f "$PROMPT_FILE" ]; then
  CONTEXT=$(cat "$PROMPT_FILE")
else
  CONTEXT="The working tree has uncommitted code/config changes. Keep the work item's issue true, promote durable findings out of .workkit/, and check doc-parity per AGENTS.md rules."
fi

# Transition guard: this repo's board is deleted in the migration, but until it
# is, the old rules still bind the turn that touches it.
if [ -f "PROGRESS.md" ]; then
  CONTEXT="$CONTEXT

BOARD: PROGRESS.md still exists in this repo — migrate it to issues (recipe: the workkit plugin's docs/project-state.md § Migration), then delete the file. Until that happens, keep it true this turn."
fi

if [ "$inbox_count" -gt 0 ]; then
  CONTEXT="$CONTEXT

INBOX: $inbox_count unfiled entries in $cwd/INBOX.md — surface the count to the user and offer the workkit:triage skill. Filing stays deliberate: never empty the inbox as a side effect."
fi

if [ "$scratch_count" -gt 0 ]; then
  CONTEXT="$CONTEXT

SCRATCH: $scratch_count unfiled entries in $cwd/.workkit/inbox.md — surface the count and offer the workkit:triage skill. Filing stays deliberate: never drain the local inbox as a side effect."
fi

reason="Change tracker: uncommitted code changes detected."
if [ "$has_code_change" -eq 0 ]; then
  reason="Change tracker: unfiled inbox entries detected."
elif [ "$inbox_count" -gt 0 ] || [ "$scratch_count" -gt 0 ]; then
  reason="Change tracker: uncommitted code changes + unfiled inbox entries detected."
fi

jq -n --arg ctx "$CONTEXT" --arg reason "$reason" '{
  "decision": "block",
  "reason": $reason,
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": $ctx
  }
}'
exit 0
