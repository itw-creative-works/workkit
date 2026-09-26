#!/bin/bash
# hooks/lib/manager.sh: the manager system's reads: the session's live model,
# the family a model id belongs to, and the effective three-layer config.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads WORKKIT_DIR, hook_jq and
# hook_jq_default from the entry, whose header carries hook_session_model's
# duplication note (the personal hooks hold its twin).

# hook_session_model <session_id> <transcript_path>: the session's CURRENT
# model, resolved the only honest way (the accuracy contract lives in
# claude/session/context/README.md: the model/effort env vars are settings
# defaults frozen at launch and are NEVER read). Sets:
#   HOOK_SESSION_MODEL:      raw model id (e.g. claude-fable-5[1m]); empty when
#                            unknowable (first prompt of a fresh VS Code session)
#   HOOK_SESSION_MODEL_SRC:  live | transcript | none
# Tiers: the statusline cache written per-session by claude/session/statusline
# (live, terminal sessions only; trusted only when statusline-shaped: model or
# thinking present), then the transcript's last assistant entry (exact, lags
# one response). Callers treat empty as "unknown", never as an error.
# Consumers: manager/resolver, manager/profile (and, in a user's personal
# hooks, claude/session/context: see the duplication note at the top).
hook_session_model() {
  HOOK_SESSION_MODEL=""
  HOOK_SESSION_MODEL_SRC="none"
  local session_id="$1" transcript_path="${2:-}" safe state_file
  [ -n "$session_id" ] || return 1
  safe="${session_id//[^a-zA-Z0-9]/_}"
  state_file="${TMPDIR:-/tmp}/claude-session-state/${safe}.json"
  if [ -f "$state_file" ]; then
    # The statusline-shape trust gate (model/thinking present) exists for the
    # cache's EFFORT fields; for the model itself, present is trustworthy and
    # absent is absent: no gate needed here.
    HOOK_SESSION_MODEL=$(hook_jq -r '.model.id // empty' "$state_file" 2>/dev/null || true)
    [ -n "$HOOK_SESSION_MODEL" ] && HOOK_SESSION_MODEL_SRC="live"
  fi
  if [ -z "$HOOK_SESSION_MODEL" ] && [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    # Last assistant entry's message.model: grep narrows, jq validates real
    # entries so quoted transcript content can never poison the value.
    HOOK_SESSION_MODEL=$(grep '"type":"assistant"' "$transcript_path" 2>/dev/null | tail -20 \
      | hook_jq -R -r 'fromjson? | select(.type == "assistant") | .message.model // empty' 2>/dev/null \
      | tail -1 || true)
    [ -n "$HOOK_SESSION_MODEL" ] && HOOK_SESSION_MODEL_SRC="transcript"
  fi
  [ -n "$HOOK_SESSION_MODEL" ]
}

# hook_model_tier <model_id>: the model family a raw id belongs to. Sets
# HOOK_MODEL_TIER to fable|opus|sonnet|haiku (empty + non-zero return for an
# unrecognized id: callers decide their own "unknown" behavior). Pure string
# logic: strips context-window suffixes like [1m] and matches the family word,
# so claude-opus-5[1m], claude-opus-4-5, and a bare "opus" all read as opus.
# Consumers: manager/resolver, manager/profile.
hook_model_tier() {
  HOOK_MODEL_TIER=""
  local id="${1%%[*}"
  case "$id" in
    *fable*)  HOOK_MODEL_TIER="fable" ;;
    *opus*)   HOOK_MODEL_TIER="opus" ;;
    *sonnet*) HOOK_MODEL_TIER="sonnet" ;;
    *haiku*)  HOOK_MODEL_TIER="haiku" ;;
    *) return 1 ;;
  esac
}

# _hook_manager_layer <settings_file>: the OVERRIDABLE slice of a settings
# file's `manager` block, as a compact JSON object ({} for a missing file, one
# without the block, or anything jq cannot read). Only `mode`, `enabled`, and
# the three `tiers` keys are overridable. `classes` and `ladder` stay global,
# so a repo can move a class onto a cheaper rung but never redefine the rungs
# themselves. Internal to hook_manager_config.
_hook_manager_layer() {
  [ -f "$1" ] || { printf '{}'; return 0; }
  # Nothing is appended to what jq wrote: the merge below reads exactly three
  # layers, and an empty object stuck onto a partial answer would be a fourth.
  hook_jq_default '{}' -c '(.manager // {})
    | {mode: .mode, enabled: .enabled,
       tiers: ((.tiers // {}) | {frontier, workhorse, fast} | with_entries(select(.value != null)))}
    | with_entries(select(.value != null and .value != {}))' "$1"
}

# hook_manager_config <ladder_path> <cwd>: the manager system's EFFECTIVE
# config for this session, as a compact JSON object in HOOK_MANAGER_CONFIG.
# Three layers, deep-merged, each beating the one before it:
#   GLOBAL  the ladder manifest (the SSOT; MANAGER_LADDER overrides the path)
#   USER    the `manager` block of ~/.workkit/settings.json
#           (MANAGER_USER_SETTINGS overrides the path)
#   REPO    the `manager` block of <repo root>/.workkit/settings.json, the
#           repo root resolved from <cwd> by GIT; skipped entirely when <cwd>
#           is empty and when git names no toplevel, since no git root means no
#           repo layer: that settings file is a REPO's, and the one a non-repo
#           cwd carries is the MACHINE's own state (the user profile holds it
#           on Windows, where every temp directory sits under that profile), so
#           reading it here would let the machine layer override itself
# The settings files' own top-level keys belong to the ISSUE-WORKFLOW system
# and are never read here. The manager's config is the separate `manager` key.
# Returns non-zero when the merged config carries `enabled: false`: the repo
# has opted out of the crew, and both consumers do nothing at all. Every other
# failure (no jq, missing or unparseable file, no git) contributes nothing and
# falls through to the layer below. A config read must never break a session.
# Consumers: manager/resolver, manager/profile.
hook_manager_config() {
  local ladder="$1" cwd="${2:-}" global="{}" user repo="{}" repo_root off
  HOOK_MANAGER_CONFIG="{}"
  command -v jq >/dev/null 2>&1 || return 0
  if [ -f "$ladder" ]; then
    global=$(hook_jq_default '{}' -c 'if type == "object" then . else {} end' "$ladder")
  fi
  user=$(_hook_manager_layer "${MANAGER_USER_SETTINGS:-$HOME/$WORKKIT_DIR/settings.json}")
  if [ -n "$cwd" ]; then
    repo_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)
    if [ -n "$repo_root" ]; then
      repo=$(_hook_manager_layer "$repo_root/$WORKKIT_DIR/settings.json")
    fi
  fi
  HOOK_MANAGER_CONFIG=$(printf '%s\n%s\n%s\n' "$global" "$user" "$repo" \
    | hook_jq -c -s '.[0] * .[1] * .[2]' 2>/dev/null || printf '%s' "$global")
  # `.enabled // true` would read FALSE as absent, so the test is explicit.
  off=$(printf '%s' "$HOOK_MANAGER_CONFIG" | hook_jq -r 'if .enabled == false then "1" else "" end' 2>/dev/null || true)
  [ -z "$off" ]
}
