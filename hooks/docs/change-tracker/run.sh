#!/bin/bash
# docs:change-tracker — Stop hook
# Nudges Claude to keep the work item (a GitHub issue) true, promote durable
# findings out of .workkit/, and check doc-parity.
# Prompt content lives in prompt.md (same directory).
# Reads files and writes one state file — never calls gh. A network round trip
# on every Stop is latency nobody agreed to pay.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

stop_hook_active=$(jq -r '.stop_hook_active // false' <<<"$input" || true)
cwd=$(jq -r '.cwd // ""' <<<"$input" || true)

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
if [ -f ".workkit/capture.md" ]; then
  scratch_count=$(grep -cv -e '^#' -e '^>' -e '^[[:space:]]*$' .workkit/capture.md 2>/dev/null || true)
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

  # Code-vs-docs classification matches the safety/commit-gate hook (same
  # definition in both — a docs PATH, then a code extension winning over it,
  # then the docs basenames — kept in sync by hand; the .workkit arm is this
  # hook's alone).
  is_doc=0
  case "$path" in
    docs/*|*/docs/*) is_doc=1 ;;
  esac
  # A code EXTENSION wins over the docs path: this repo keeps hooks/docs/*/run.sh,
  # executable bash sitting under a docs directory, and an edit to one of those
  # is exactly the uncommitted code this hook watches for.
  case "$base" in
    *.js|*.cjs|*.mjs|*.ts|*.jsx|*.tsx|*.sh|*.zsh|*.py|*.rb) is_doc=0 ;;
  esac
  case "$path" in
    # Session state, never committed — it has its own nudge below, and it is
    # never the "uncommitted code" this hook is watching for. After the
    # extension arm, so a script parked there stays out of it too.
    .workkit|.workkit/*) is_doc=1 ;;
  esac
  # Docs basenames are docs wherever they live, extension arm included.
  case "$base" in
    *.md|CHANGELOG|CHANGELOG.*|LICENSE|LICENSE.*) is_doc=1 ;;
  esac

  if [ "$is_doc" -eq 0 ]; then
    has_code_change=1
    break
  fi
done <<<"$status"

[ "$has_code_change" -eq 1 ] || [ "$inbox_count" -gt 0 ] || [ "$scratch_count" -gt 0 ] || exit 0

# Repeat only when something changed (issue #132). The fingerprint covers what
# the nudge is ABOUT — the porcelain status, the diff behind it, the content of
# the untracked files, and the capture surfaces' content — and the one last
# nudged on is remembered in .workkit/agents/, the agents' own state. Same fingerprint means the
# obligations were already stated for this exact state, so the Stop is silent; a
# new edit (which the diff catches even when the status line is identical), a
# new file, or a new capture makes a new fingerprint and one more nudge. No
# clock: two identical trees fingerprint identically.
fingerprint() {
  printf '%s\n' "$status"
  git diff HEAD 2>/dev/null || git diff 2>/dev/null || true
  # An untracked file is a NAME in the status and nothing in the diff, so a file
  # built up across turns would go silent after the first nudge. One pipeline,
  # each file read once, empty list = empty contribution.
  git ls-files --others --exclude-standard -z 2>/dev/null | sort -z | xargs -0 -r cat 2>/dev/null || true
  # The two capture surfaces whose entries are counted above: one is gitignored
  # by design, the other may be ignored too, so neither is reliably in the
  # streams above — without this, an edit to an existing entry never re-fires.
  cat "INBOX.md" ".workkit/capture.md" 2>/dev/null || true
}

# Whatever digest this machine has — the input is a local listing, not an
# adversarial one, so the point is only that equal states digest equally.
digest() {
  if command -v shasum >/dev/null 2>&1; then
    shasum
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  else
    cksum
  fi | awk '{print $1}'
}

# A repo with no .workkit/ is UNDECIDED — never written to, so it has no memory
# and hears the nudge every Stop, exactly as before. Same for a repo whose
# .workkit/ is not gitignored: the memory is session state, never a file the
# repo would be asked to commit, so an unignored path keeps the old behavior.
state_file=".workkit/agents/.change-tracker"
if [ -d ".workkit" ] && git check-ignore -q "$state_file" 2>/dev/null; then
  current=$(fingerprint | digest || true)
  if [ -n "$current" ]; then
    if [ "$(cat "$state_file" 2>/dev/null || true)" = "$current" ]; then
      exit 0
    fi
    # The block carries the redirection error too — 2>/dev/null on the printf
    # alone is set up after the failing redirect, so an unwritable .workkit/
    # would spill the shell's own message onto the transcript.
    { mkdir -p ".workkit/agents" && printf '%s\n' "$current" >"$state_file"; } 2>/dev/null || true
  fi
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

SCRATCH: $scratch_count unfiled entries in $cwd/.workkit/capture.md — surface the count and offer the workkit:triage skill. Filing stays deliberate: never drain the local capture file as a side effect."
fi

reason="Change tracker: uncommitted code changes detected."
if [ "$has_code_change" -eq 0 ]; then
  reason="Change tracker: unfiled entries detected."
elif [ "$inbox_count" -gt 0 ] || [ "$scratch_count" -gt 0 ]; then
  reason="Change tracker: uncommitted code changes + unfiled entries detected."
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
