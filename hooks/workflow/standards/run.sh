#!/usr/bin/env bash
# workflow:standards: SessionStart hook. Delivers the engine's idempotent heal
# (workflow/standards.sh) to the session's repo, at most once per repo per day,
# since the label step talks to GitHub; the marker lives under
# ~/.claude/logs/workflow-standards because TMPDIR is wiped too often. Silent
# unless something was created or corrected. Detail: docs/hooks.md.

set -euo pipefail

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

# Sourced for hook_sha1 (the daily marker below is keyed by a digest whose
# spelling differs across platforms) and for wk_in_plugin_cache.
. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

# The engine is this kit's own workflow/, resolved from this script's physical
# location so no symlink has to exist first; WORKFLOW_DIR overrides it for tests.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
ENGINE_DIR="${WORKFLOW_DIR:-$SCRIPT_DIR/../../../workflow}"
STANDARDS="$ENGINE_DIR/standards.sh"
MANIFEST="$ENGINE_DIR/labels.json"

# Setup pester, every session with no cache and no repo gate: a machine that
# never ran `workkit setup` lacks it everywhere. The probe is the CLI setup
# installs, one stat; a `~/.workkit` without it still pesters. The hook only
# informs, the human runs the wizard.
pester=""
cli_link="$HOME/.local/bin/workkit"
if [ ! -x "$cli_link" ]; then
  # The command the user is told to paste resolves the ../.. climb first: the
  # raw ENGINE_DIR string executes fine but reads like a bug.
  engine_shown="$(cd "$ENGINE_DIR" 2>/dev/null && pwd -P || printf '%s' "$ENGINE_DIR")"
  where=""
  wk_in_plugin_cache "$ENGINE_DIR/.." && where=" (the engine in the plugin cache)"
  pester="SETUP: workkit is not set up on this machine ($cli_link is missing). The daily brief, the home repo, and the workkit command are all absent until it is. Tell the user to run \`bash $engine_shown/workkit.sh setup\`$where before continuing with other work."
fi

# Every exit from here down goes through emit, so the pester rides along with
# whatever else this hook has to say and is still heard on the sessions where
# the hook would otherwise be silent. It leads: it is the instruction, and the
# heal report is news.
emit() {
  local msg="${1:-}"
  local ctx="$msg"
  if [ -n "$pester" ]; then
    if [ -n "$msg" ]; then
      ctx="$pester

$msg"
    else
      ctx="$pester"
    fi
  fi
  if [ -n "$ctx" ]; then
    hook_jq -n --arg ctx "$ctx" '{
      "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": $ctx
      }
    }'
  fi
  exit 0
}

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || emit

root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || emit

# A missing engine or labels.json is a broken install, and it speaks once, only
# for a repo that opted in; everyone else stays silent. Still exit 0.
broken=""
if [ ! -f "$STANDARDS" ]; then
  broken="workflow engine not found at $STANDARDS. Reinstall the workkit plugin."
elif [ ! -r "$MANIFEST" ]; then
  broken="workflow manifest missing or unreadable at $MANIFEST. Reinstall the workkit plugin."
fi
if [ -n "$broken" ]; then
  # Without the engine, undecided and declined cannot be told apart (both need
  # the user file), so the committed answer is the only signal left. Speak only
  # for a repo that said YES: an explicit `"enabled": false` is a deliberate no
  # and stays silent here too, the same way the engine honors it.
  [ -f "$root/$WORKKIT_DIR/settings.json" ] || emit
  wk_settings_declined "$root/$WORKKIT_DIR/settings.json" && emit
  emit "$broken"
fi

# Participation gate: the engine owns the states and this hook routes them. An
# undecided repo hears one offer line per session and is never written to. The
# state is stdout's last line, so a malformed answer cannot silently skip.
state=$(bash "$STANDARDS" --state "$root" 2>/dev/null | tail -1 || printf 'nogit')

case "$state" in
  enabled) ;;
  undecided)
    offer=$(bash "$STANDARDS" --announce "$root" 2>/dev/null || true)
    emit "$offer"
    ;;
  *) emit ;;
esac

# Daily cache marker, keyed by repo root.
cache_dir="${WORKFLOW_STANDARDS_CACHE:-$HOME/.claude/logs/workflow-standards}"
mkdir -p "$cache_dir" 2>/dev/null || true
repo_key=$(printf '%s' "$root" | hook_sha1 2>/dev/null || true)
[ -n "$repo_key" ] || repo_key="${root//[^a-zA-Z0-9]/_}"
marker="$cache_dir/$repo_key"
today=$(date +%Y-%m-%d)

if [ -f "$marker" ] && [ "$(cat "$marker" 2>/dev/null)" = "$today" ]; then
  emit
fi

# A failing heal never wedges the session start, and never reads as a heal:
# both streams are captured and only a clean run caches the day, so a partial
# heal retries next session. QUIET=1 leaves only the actions and the warnings.
rc=0
out=$(QUIET=1 bash "$STANDARDS" "$root" 2>&1) || rc=$?
if [ "$rc" -eq 0 ]; then
  printf '%s' "$today" >"$marker" 2>/dev/null || true
fi

# Machine-side upkeep on the same daily schedule, since Claude Code has no
# plugin-install hook: `workkit update --auto`, resolved beside the engine, only
# updates a schedule a human installed. Its two read-only gh calls are bounded
# by the CLI; it prints nothing when nothing drifted.
upkeep=""
CLI="$ENGINE_DIR/workkit.sh"
if [ -f "$CLI" ]; then
  # Both streams: an upkeep warning arrives on stderr, and carrying warnings is
  # this relay's whole job.
  upkeep=$(bash "$CLI" update --auto 2>&1 || true)
fi

# One shape for everything injected: strip the colors, keep only lines opening
# with the engine's ✓ or ⚠ (a child tool's stderr must never read as an action),
# and drop the indent and glyph. Alternation, not a bracket class: in the C
# locale a class of multibyte glyphs matches bytes.
engine_lines() {
  sed $'s/\033\\[[0-9;]*m//g' \
    | grep -E '^[[:space:]]*(✓|⚠) ' \
    | sed -E 's/^ *(✓|·|›|⚠|✖|⏳) //' || true
}

actions=$(printf '%s\n' "$out" | engine_lines)
upkeep=$(printf '%s\n' "$upkeep" | engine_lines)

if [ "$rc" -ne 0 ]; then
  # A non-zero engine exit is worth a session's attention even when it printed
  # no ✓ or ⚠ line of its own: that is exactly the half-finished case.
  msg="workflow standards did not finish in $root (exit $rc). It will retry next session:
${actions:-$(printf '%s\n' "$out" | sed $'s/\033\\[[0-9;]*m//g' | tail -3)}"
elif [ -n "$actions" ]; then
  msg="workflow standards healed $root:
$actions"
else
  msg=""
fi

# The upkeep speaks only when it did something, and it says so even on a session
# where the repo itself needed no heal.
if [ -n "$upkeep" ]; then
  if [ -n "$msg" ]; then
    msg="$msg

$upkeep"
  else
    msg="workkit upkeep:
$upkeep"
  fi
fi

emit "$msg"
