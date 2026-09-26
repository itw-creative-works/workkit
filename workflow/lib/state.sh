#!/usr/bin/env bash
# workflow/lib/state.sh: the engine's JSON edit and its state mutex. The safe
# jq write, the lock every writer of the machine's files takes and drops, and
# the one-value read. SOURCED by lib.sh, never executed, and it runs nothing at
# load: it defines functions and sets nothing. It reads lib.sh's WK_STATE_LOCK,
# whose comment there is the mutex's contract, and calls wk_jq (platform.sh) and
# wk_warn (lib/voice.sh).

# ── JSON ──────────────────────────────────────────────────────────────────────
# Write a jq edit back to a file safely: resolve symlinks first (this system's
# whole model is symlinking config out of ~, and writing the temp file over the
# LINK would replace it with a regular file and orphan the real one), refuse to
# touch a file jq cannot parse, and never leave a .tmp behind.
#
# The WRITE goes through wk_jq too, which is not about a poisoned read: a file
# these edits land in is committed (.workkit/settings.json), and a text-mode jq
# would rewrite every line of it with a CRLF on a Windows run, so the file's
# shape would flip with whichever machine touched it last. One shape, every
# platform. A `\r` INSIDE a string is a two-character escape in JSON and is
# never a raw byte, so nothing a value holds is touched.
#
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
# The mutex at WK_STATE_LOCK. Why there is one is written above that address
# in lib.sh; what each answer means is here, with the function.
#
# Returns 0 holding the lock, 1 when another run held it for the whole 5s wait.
# Every caller proceeds either way (a rare lost edit costs less than a run that
# stops) and only the caller that took it releases it: the mutex belongs to
# whichever run holds it, and removing it on the way out of a run that never had
# it would let a third writer race the current holder.
wk_take_state_lock() {
  local waited=0
  mkdir -p "$(dirname "$WK_STATE_LOCK")" 2>/dev/null || return 1
  while [ "$waited" -lt 50 ]; do
    if mkdir "$WK_STATE_LOCK" 2>/dev/null; then return 0; fi
    sleep 0.1
    # An assignment, never `(( waited++ ))`: that form yields the value BEFORE
    # the increment, so the first pass evaluates to 0, which is a non-zero exit
    # status. Bash 4.1 and later apply errexit to it and the whole run ends
    # silently mid-wait; bash 3.2 (stock macOS) does not, so the defect only
    # ever surfaced off this machine.
    waited=$(( waited + 1 ))
  done
  return 1
}

wk_drop_state_lock() {
  rmdir "$WK_STATE_LOCK" 2>/dev/null || true
}

# One value out of a JSON file, or empty for an absent key, an unreadable file,
# or a machine without jq, the three ways an answer can be missing, all of
# which mean the caller has no answer to act on.
wk_json_get() {
  local file="$1" filter="$2"
  [[ -f "$file" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  wk_jq -r "$filter // empty" "$file" 2>/dev/null || true
}
