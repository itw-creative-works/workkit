#!/usr/bin/env bash
# workflow/lib/state.sh: the safe JSON edit, the state mutex and the one-value
# read. Sourced by lib.sh, functions only. Reads lib.sh's WK_STATE_LOCK; calls
# wk_jq (platform.sh) and wk_warn (lib/voice.sh).

# ── JSON ──────────────────────────────────────────────────────────────────────
# Symlinks resolve first, or the temp file would replace the link; the write
# goes through wk_jq too, so a committed file stays LF on every platform.
# Usage: wk_json_edit <file> <jq args...>
wk_json_edit() {
  local file="$1"; shift
  local target tmp rc=0
  command -v jq >/dev/null 2>&1 || return 1
  target=$(readlink -f "$file" 2>/dev/null || printf '%s' "$file")
  if ! wk_jq empty "$target" 2>/dev/null; then
    wk_warn "settings: $target is not valid JSON; fix or remove it, then try again"
    return 1
  fi
  tmp="$target.tmp.$$"
  # shellcheck disable=SC2064  # expand $tmp now: it is what this call must clean up
  trap "rm -f '$tmp'" RETURN
  wk_jq "$@" "$target" >"$tmp" || rc=$?
  if [[ "$rc" -ne 0 ]] || [[ ! -s "$tmp" ]]; then
    wk_warn "settings: could not write $target (left unchanged)"
    return 1
  fi
  mv "$tmp" "$target" || { wk_warn "settings: could not replace $target"; return 1; }
  return 0
}

# ── The state mutex ───────────────────────────────────────────────────────────
# Returns 0 holding the lock, 1 after a 5s wait. Callers proceed either way,
# and only a caller that took it releases it, or a third writer races the
# holder.
wk_take_state_lock() {
  local waited=0
  mkdir -p "$(dirname "$WK_STATE_LOCK")" 2>/dev/null || return 1
  while [ "$waited" -lt 50 ]; do
    if mkdir "$WK_STATE_LOCK" 2>/dev/null; then return 0; fi
    sleep 0.1
    # Never `(( waited++ ))`: its first pass evaluates to 0, a non-zero status
    # that errexit ends the run on under bash 4.1 and later.
    waited=$(( waited + 1 ))
  done
  return 1
}

wk_drop_state_lock() {
  rmdir "$WK_STATE_LOCK" 2>/dev/null || true
}

# One value out of a JSON file, or empty for an absent key, an unreadable file
# or a machine without jq.
wk_json_get() {
  local file="$1" filter="$2"
  [[ -f "$file" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  wk_jq -r "$filter // empty" "$file" 2>/dev/null || true
}
