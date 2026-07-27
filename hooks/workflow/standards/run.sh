#!/usr/bin/env bash
# workflow:standards — SessionStart hook.
# Brings the session's repo to the issue-workflow standard by running
# ~/.claude/workflow/standards.sh (labels from labels.json, .github issue templates,
# .workkit/ in .gitignore). The script is idempotent; this hook is its delivery
# — Ian never runs a command.
#
# Runs at most once per repo per DAY: the label step talks to GitHub, and a
# session-start network call on every new panel is not worth the latency. The
# marker lives under ~/.claude/logs/workflow-standards (TMPDIR is wiped far too
# often to hold a daily cache).
#
# Silent unless something was actually created or corrected — an all-skip run
# (already standardized, or offline with nothing to do) says nothing.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

cwd=$(jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || exit 0

root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0

# The workflow engine is this kit's workflow/ folder, symlinked to
# ~/.claude/workflow at install — so resolve it by that path, not relative to
# this hook.
# WORKFLOW_DIR overrides it (the tests point at the repo's own workflow/).
ENGINE_DIR="${WORKFLOW_DIR:-$HOME/.claude/workflow}"
STANDARDS="$ENGINE_DIR/standards.sh"
MANIFEST="$ENGINE_DIR/labels.json"

# A missing engine is a real state, not a no-op: ~/.claude/hooks is a directory
# symlink, so a machine that pulls a new kit version has this hook live
# immediately while ~/.claude/workflow does not exist until it is linked. The
# manifest is half the engine — the label heals cannot run without it, so a
# missing or unreadable labels.json is the same broken install and must speak,
# not go quiet. Say so once, and only for a repo that already opted in —
# everyone else stays silent. Still exit 0; a broken install never wedges a
# session start.
broken=""
if [ ! -f "$STANDARDS" ]; then
  broken="workflow engine not found at $STANDARDS — run setup.sh to install the symlink."
elif [ ! -r "$MANIFEST" ]; then
  broken="workflow manifest missing or unreadable at $MANIFEST — run setup.sh to reinstall the workflow core."
fi
if [ -n "$broken" ]; then
  # Without the engine, undecided and declined cannot be told apart (both need
  # the user file), so the committed answer is the only signal left. Speak only
  # for a repo that said YES: an explicit `"enabled": false` is a deliberate no
  # and stays silent here too, the same way the engine honors it.
  # This hook sources nothing, so the directory name is spelled out; its SSOT is
  # WORKKIT_DIR in hooks/_lib.sh — change both together.
  [ -f "$root/.workkit/settings.json" ] || exit 0
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$root/.workkit/settings.json" && exit 0
  jq -n --arg ctx "$broken" '{
    "hookSpecificOutput": {
      "hookEventName": "SessionStart",
      "additionalContext": $ctx
    }
  }'
  exit 0
fi

# Participation gate — the engine owns the four states (enabled · disabled ·
# declined · undecided); this hook only routes them. A repo that has not said
# yes is never written to, and an undecided one hears a single offer line every
# session (no daily cache: the offer costs nothing and reaches no network).
# The engine prints its answer on stdout and every diagnostic on stderr, so this
# capture is the state and nothing else. Take the last line defensively: a state
# that arrived malformed must not silently match nothing and skip the repo.
state=$(bash "$STANDARDS" --state "$root" 2>/dev/null | tail -1 || printf 'nogit')

case "$state" in
  enabled) ;;
  undecided)
    offer=$(bash "$STANDARDS" --announce "$root" 2>/dev/null || true)
    [ -n "$offer" ] || exit 0
    jq -n --arg ctx "$offer" '{
      "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": $ctx
      }
    }'
    exit 0
    ;;
  *) exit 0 ;;
esac

# Daily cache marker, keyed by repo root.
cache_dir="${WORKFLOW_STANDARDS_CACHE:-$HOME/.claude/logs/workflow-standards}"
mkdir -p "$cache_dir" 2>/dev/null || true
repo_key=$(printf '%s' "$root" | shasum 2>/dev/null | cut -d' ' -f1 || true)
[ -n "$repo_key" ] || repo_key="${root//[^a-zA-Z0-9]/_}"
marker="$cache_dir/$repo_key"
today=$(date +%Y-%m-%d)

if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$today" ]; then
  exit 0
fi

# Never let a failing standards run wedge the session start — but never call a
# failure a heal either. Diagnostics arrive on stderr, so capture both streams
# for the report and keep the exit status: only a CLEAN run caches the day, so a
# partial heal retries next session instead of going quiet until tomorrow
# (review finding, 2026-07-24).
rc=0
out=$(bash "$STANDARDS" "$root" 2>&1) || rc=$?
if [ "$rc" -eq 0 ]; then
  printf '%s' "$today" >"$marker" 2>/dev/null || true
fi

# Strip the script's ANSI colors, then keep only the lines that report an
# action (created/corrected = ✓, needs judgment = ⚠). Skips stay silent.
# (Alternation, not a bracket class: in the C locale a class of multibyte
# characters matches their shared leading byte, which also matches ℹ and ·.)
actions=$(printf '%s\n' "$out" | sed $'s/\033\\[[0-9;]*m//g' | grep -E '^[[:space:]]*(✓|⚠)' || true)

if [ "$rc" -ne 0 ]; then
  # A non-zero engine exit is worth a session's attention even when it printed
  # no ✓/⚠ line of its own — that is exactly the half-finished case.
  msg="workflow standards did not finish in $root (exit $rc) — it will retry next session:
${actions:-$(printf '%s\n' "$out" | sed $'s/\033\\[[0-9;]*m//g' | tail -3)}"
else
  [ -n "$actions" ] || exit 0
  msg="workflow standards healed $root:
$actions"
fi

jq -n --arg ctx "$msg" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
exit 0
