#!/usr/bin/env bash
# workflow/lib/state.sh: the safe JSON edit and the state mutex. Sourced by
# lib.sh, functions only. Reads lib.sh's WK_STATE_LOCK; calls
# wk_jq, wk_take_lock and wk_drop_lock (platform.sh) and wk_warn (lib/voice.sh).

# ── JSON ──────────────────────────────────────────────────────────────────────
# Symlinks resolve first, or the temp file would replace the link; the write
# goes through wk_jq too, so a committed file stays LF on every platform.
# Usage: wk_json_edit <file> <jq args...>
wk_json_edit() {
  local file="$1"; shift
  local target tmp mode m rc=0
  command -v jq >/dev/null 2>&1 || return 1
  target=$(readlink -f "$file" 2>/dev/null || printf '%s' "$file")
  if ! wk_jq empty "$target" 2>/dev/null; then
    wk_warn "settings: $(wk_native_path "$target") cannot be read as JSON (unreadable or not valid JSON); fix or remove it, then try again"
    return 1
  fi
  tmp="$target.tmp.$$"
  # shellcheck disable=SC2064  # expand $tmp now: it is what this call must clean up
  trap "rm -f '$tmp'" RETURN
  # The file can hold secrets: the temp file is owner-only while written and
  # takes the target's mode before the mv. GNU `stat -f` prints junk and exits
  # 0, so each spelling counts only when it prints digits.
  for m in "$(stat -c %a "$target" 2>/dev/null)" "$(stat -f %Lp "$target" 2>/dev/null)"; do
    case "$m" in ''|*[!0-9]*) ;; *) mode="$m"; break ;; esac
  done
  ( umask 077; wk_jq "$@" "$target" >"$tmp" ) || rc=$?
  if [[ "$rc" -ne 0 ]] || [[ ! -s "$tmp" ]]; then
    wk_warn "settings: could not write $(wk_native_path "$target") (left unchanged)"
    return 1
  fi
  [[ -z "$mode" ]] || chmod "$mode" "$tmp" 2>/dev/null || true
  mv "$tmp" "$target" || { wk_warn "settings: could not replace $(wk_native_path "$target")"; return 1; }
  return 0
}

# wk_json_edit, but a missing file is first made as {}, so the filter builds it
# whole; a failed edit takes it away again. The {} is written through the path,
# so a link with a missing target gets its target made, never replaced.
# Usage: wk_json_edit_or_create <file> <jq args...>
wk_json_edit_or_create() {
  local file="$1" target
  [[ -e "$file" ]] && { wk_json_edit "$@"; return; }
  command -v jq >/dev/null 2>&1 || return 1
  { printf '{}\n' >"$file"; } 2>/dev/null || { wk_warn "settings: could not create $(wk_native_path "$file")"; return 1; }
  wk_json_edit "$@" && return 0
  target=$(readlink -f "$file" 2>/dev/null) || target="$file"
  rm -f "$target"
  return 1
}

# ── The state mutex ───────────────────────────────────────────────────────────
# The lock on $WK_STATE_LOCK, wk_take_lock's (platform.sh) contract.
wk_take_state_lock() { wk_take_lock "$WK_STATE_LOCK"; }

wk_drop_state_lock() { wk_drop_lock "$WK_STATE_LOCK"; }
