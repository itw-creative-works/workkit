#!/usr/bin/env bash
# workflow/home/stamp.sh: the clone's version stamp and the compare that refuses
# a downgrade. Sourced by home.sh, functions only. WK_HOME_STAMP and WK_KIT_DIR
# are the entry's; WK_HOME_DIR is lib.sh's; the kit's manifest is read through
# seed.sh's wk_home_file.

# ── The version stamp ─────────────────────────────────────────────────────────

# This checkout's kit version, or empty for "do not know", which nothing here
# ever refuses on. The committed manifest's, so it agrees with the bytes the
# writers copy.
wk_kit_version() {
  local manifest
  command -v jq >/dev/null 2>&1 || return 0
  manifest="$(wk_home_file "$WK_KIT_DIR" .claude-plugin/plugin.json)" || return 0
  printf '%s' "$manifest" | wk_jq -r '.version // empty' 2>/dev/null || true
}

# The clone's stamp, or empty; an unstamped clone is written as usual.
wk_home_stamp_read() {
  [[ -f "$WK_HOME_DIR/$WK_HOME_STAMP" ]] || return 0
  tr -d '[:space:]' <"$WK_HOME_DIR/$WK_HOME_STAMP" 2>/dev/null || true
}

# Is a newer than b, on major.minor.patch only? Hand-rolled: BSD userland has
# no `sort -V`, and a text compare calls 0.9.0 newer than 0.48.1.
wk_semver_gt() {
  local a="${1:-}" b="${2:-}" i x y
  local -a af bf
  a="${a%%-*}"; a="${a%%+*}"
  b="${b%%-*}"; b="${b%%+*}"
  IFS=. read -r -a af <<<"$a"
  IFS=. read -r -a bf <<<"$b"
  for i in 0 1 2; do
    # A non-digit reads as 0 rather than dying in the arithmetic.
    x="${af[$i]:-0}"; x="${x//[!0-9]/}"; [[ -n "$x" ]] || x=0
    y="${bf[$i]:-0}"; y="${y//[!0-9]/}"; [[ -n "$y" ]] || y=0
    [[ "$((10#$x))" -gt "$((10#$y))" ]] && return 0
    [[ "$((10#$x))" -lt "$((10#$y))" ]] && return 1
  done
  return 1
}

# Would writing from this checkout downgrade the clone? Reads the working copy's
# stamp and never fetches. Returns 0 when this checkout is older (write
# nothing), 1 otherwise, an unreadable version included.
wk_home_downgrades() {
  local stamp mine
  stamp="$(wk_home_stamp_read)"
  [[ -n "$stamp" ]] || return 1
  mine="$(wk_kit_version)"
  [[ -n "$mine" ]] || return 1
  wk_semver_gt "$stamp" "$mine" || return 1
  wk_warn "home: the clone carries workkit $stamp and this kit is $mine; not downgrading; run \`workkit update\` here"
  return 0
}

# Written by content beside the caller's write, so it rides the same commit.
# Returns 0 when it wrote (the caller counts a change), 2 when there was
# nothing to write.
wk_home_stamp_write() {
  local mine
  mine="$(wk_kit_version)"
  [[ -n "$mine" ]] || return 2
  [[ "$(wk_home_stamp_read)" != "$mine" ]] || return 2
  printf '%s\n' "$mine" >"$WK_HOME_DIR/$WK_HOME_STAMP" 2>/dev/null || {
    wk_warn "home: could not write $WK_HOME_STAMP into $WK_HOME_DIR; the next machine to seed this clone cannot tell which kit wrote what is in it"
    return 2
  }
  return 0
}
