#!/usr/bin/env bash
# workflow/home/stamp.sh: the version stamp. This checkout's kit version, the
# clone's stamp read and written, and the semver comparison that refuses a
# downgrade. SOURCED by home.sh, never executed, and it runs nothing at load:
# it defines functions and sets nothing. The stamp's file name and why there is
# one (WK_HOME_STAMP) and WK_KIT_DIR are the entry's; WK_HOME_DIR is lib.sh's.

# ── The version stamp ─────────────────────────────────────────────────────────

# This checkout's kit version, or empty when it cannot be read: a partial
# checkout, or a machine without jq. Empty means "do not know", and nothing here
# ever refuses on what it does not know.
wk_kit_version() {
  wk_json_get "$WK_KIT_DIR/.claude-plugin/plugin.json" '.version'
}

# The clone's stamp, or empty when it carries none. Every clone made before
# issue #200 is one, and an unstamped clone is written exactly as it always was.
wk_home_stamp_read() {
  [[ -f "$WK_HOME_DIR/$WK_HOME_STAMP" ]] || return 0
  tr -d '[:space:]' <"$WK_HOME_DIR/$WK_HOME_STAMP" 2>/dev/null || true
}

# Is a NEWER than b? Compared on major.minor.patch and nothing else: a
# prerelease or build suffix is dropped rather than ordered, since the only
# question here is which of two checkouts is further along.
#
# Hand-rolled, because this has to hold on the stock macOS bash 3.2 and BSD
# userland the morning runs under, where `sort -V` does not exist, and a TEXT
# compare gets it exactly backwards on the versions this kit ships (it would
# call 0.9.0 newer than 0.48.1).
wk_semver_gt() {
  local a="${1:-}" b="${2:-}" i x y
  local -a af bf
  a="${a%%-*}"; a="${a%%+*}"
  b="${b%%-*}"; b="${b%%+*}"
  IFS=. read -r -a af <<<"$a"
  IFS=. read -r -a bf <<<"$b"
  for i in 0 1 2; do
    # Anything that is not a digit is not a version number, and reads as 0
    # rather than dying in the arithmetic and taking the caller's run with it.
    x="${af[$i]:-0}"; x="${x//[!0-9]/}"; [[ -n "$x" ]] || x=0
    y="${bf[$i]:-0}"; y="${y//[!0-9]/}"; [[ -n "$y" ]] || y=0
    [[ "$((10#$x))" -gt "$((10#$y))" ]] && return 0
    [[ "$((10#$x))" -lt "$((10#$y))" ]] && return 1
  done
  return 1
}

# Would writing from THIS checkout downgrade the clone? Says so once when it
# would, and the caller then writes nothing, commits nothing and pushes nothing.
#
# The stamp it reads is the WORKING COPY's: the clone as it stands after
# whatever catch-up the caller already made. publish.sh rebases onto origin
# before it syncs, and the morning's runner reconcile answers for the clone it
# has; neither fetches on this function's behalf.
#
# Returns 0 when this checkout is older (do not write), 1 otherwise, which
# covers an unstamped clone and a version neither side can read.
wk_home_downgrades() {
  local stamp mine
  stamp="$(wk_home_stamp_read)"
  [[ -n "$stamp" ]] || return 1
  mine="$(wk_kit_version)"
  [[ -n "$mine" ]] || return 1
  wk_semver_gt "$stamp" "$mine" || return 1
  wk_warn "home: the clone carries workkit $stamp and this checkout is $mine; not downgrading; run \`workkit update\` here"
  return 0
}

# The stamp, written beside what the caller just wrote so it rides the same
# commit. By CONTENT like every other write here: a stamp already saying this
# version is not rewritten, so a second run leaves nothing to commit.
#
# Returns 0 when it wrote (the caller counts that as a change: a kit that moved
# on has to reach the remote for the other machine's guard to see it), 2 when
# there was nothing to write.
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
