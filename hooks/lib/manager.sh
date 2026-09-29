#!/bin/bash
# hooks/lib/manager.sh: the manager system's reads: the session's live model,
# the family a model id belongs to, and the effective three-layer config.
# Sourced by hooks/_lib.sh; defines functions and sets nothing. It reads
# WORKKIT_DIR, hook_jq, hook_jq_default and wk_user_dir from the entry, and
# hook_session_marker from lib/markers.sh.

# hook_session_model <session_id> <transcript_path>: the CURRENT model into
# HOOK_SESSION_MODEL (empty when unknowable) and HOOK_SESSION_MODEL_SRC (live |
# transcript | none), from the statusline cache then the transcript, never the
# launch-frozen env vars. The personal hooks carry a twin: change both together.
hook_session_model() {
  HOOK_SESSION_MODEL=""
  HOOK_SESSION_MODEL_SRC="none"
  local session_id="$1" transcript_path="${2:-}" state_file
  [ -n "$session_id" ] || return 1
  state_file="$(hook_session_marker claude-session-state "$session_id").json"
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

# hook_model_tier <model_id>: the family (fable|opus|sonnet|haiku) into
# HOOK_MODEL_TIER, a context suffix like [1m] ignored; an unknown id returns
# non-zero with it empty, and the caller decides what unknown means.
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

# _hook_manager_layer <settings_file>: the overridable slice of a file's
# `manager` block as compact JSON, {} when unreadable. Internal to
# hook_manager_config.
_hook_manager_layer() {
  [ -f "$1" ] || { printf '{}'; return 0; }
  # Nothing is appended to what jq wrote: the merge below reads exactly three
  # layers, and an empty object stuck onto a partial answer would be a fourth.
  hook_jq_default '{}' -c '(.manager // {})
    | {mode: .mode, enabled: .enabled,
       tiers: ((.tiers // {}) | {frontier, workhorse, fast} | with_entries(select(.value != null)))}
    | with_entries(select(.value != null and .value != {}))' "$1"
}

# hook_manager_config <ladder_path> <cwd>: the effective config, three layers
# deep-merged, into HOOK_MANAGER_CONFIG (docs/hooks.md § manager:resolver).
# Returns non-zero on `enabled: false`; an unreadable layer adds nothing, since
# a config read must never break a session.
hook_manager_config() {
  local ladder="$1" cwd="${2:-}" global="{}" user repo="{}" repo_root off
  HOOK_MANAGER_CONFIG="{}"
  command -v jq >/dev/null 2>&1 || return 0
  if [ -f "$ladder" ]; then
    global=$(hook_jq_default '{}' -c 'if type == "object" then . else {} end' "$ladder")
  fi
  user=$(_hook_manager_layer "${MANAGER_USER_SETTINGS:-$(wk_user_dir)/settings.json}")
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
