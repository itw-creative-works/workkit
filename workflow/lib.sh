#!/usr/bin/env bash
# workflow/lib.sh — the engine's shared helpers. SOURCED, never executed.
#
# Three things every part of the home-repo machinery needs and none of them owns:
# where the user's workflow folder is, how to edit a JSON file without losing it,
# and how to say something in whatever voice the caller already speaks.
#
# It sets no shell options and runs nothing at load: a sourced file that turned
# on `set -e` would change the behavior of the script that sourced it.

# ── The addresses ─────────────────────────────────────────────────────────────
# The user's workflow folder — a PLAIN folder and never a git repo (issue #77).
# It holds this machine's own state and nothing versioned: the site options, the
# roster, the declines, the id cache, and the job state under jobs/.
# WORKFLOW_HOME is the same override the rest of the engine honors — the suite
# points it at a fixture, so nothing here ever reaches the real one.
WK_USER_DIR="${WORKFLOW_HOME:-${HOME:-}/.workkit}"

# Three files, split by WHO WRITES THEM (issue #80).
#
# settings.json is HAND-EDITED: `version` and one nested `site` key — the home
# repo's slug (`site.repo`), the all-or-nothing publish switch (`site.publish`)
# and the custom domain (`site.url`). The site options live here rather than in
# the clone because the clone is engine territory and is never hand-edited
# (issue #79); setup writes `site.repo` once and nothing else in this file is
# ever written by a machine.
WK_HOME_SETTINGS="$WK_USER_DIR/settings.json"
# .repos.json is MACHINE-MAINTAINED: the roster the heal registers and the
# declines the CLI records, under one `repos` map. Dot-named because it is not
# the owner's to edit — the engine rewrites it on contact.
WK_HOME_REPOS="$WK_USER_DIR/.repos.json"
# .cache.json is DISPOSABLE: the Discussions GraphQL ids, and since issue #86
# nothing else — the upstream-news cursor moved onto the board, where a job that
# runs from anywhere can read it. Deleting the file costs one round trip; every
# reader rebuilds what it does not find.
WK_HOME_CACHE="$WK_USER_DIR/.cache.json"

# The ONE git repo in the global layer: the clone of `<login>/workkit`, seeded
# from this checkout's tower/app and shaped like every other omega site project.
# Everything versioned lives inside it, so the folder above stays a plain one.
WK_HOME_DIR="$WK_USER_DIR/tower"
# The one app in the brand root, and the build output it leaves. Proved against
# the real tower/app 2026-07-29: `omega build` is a command of @omega.js/web and
# resolves only inside the APP (at the brand root the `omega` bin dispatches to
# @omega.js/manager, which has no build), and it writes `dist/` beside src/.
WK_HOME_APP="$WK_HOME_DIR/apps/web"
WK_HOME_DIST="$WK_HOME_APP/dist"

# ── Style ─────────────────────────────────────────────────────────────────────
# One palette for every part of the engine that speaks to a person, so a color
# is chosen once rather than per command (issue #90). Color is a TERMINAL's
# affordance and nothing else's: a log file, a captured hook payload and a piped
# run all get the plain glyph lines, byte for byte what they got before there
# was any color at all — the glyphs (✓ · ℹ ⚠) carry the meaning either way.
#
# Three ways to say no, every one of them final: WORKKIT_COLOR=0, NO_COLOR set
# (https://no-color.org), or a TERM that cannot render any of it. WORKKIT_COLOR=1
# stands in for the ONE yes — a terminal on stdout — and for nothing else, so a
# machine that asked for no color never gets some anyway; it is also what lets
# the suite read the styled shape out of a pipe. (A shell with no TERM at all
# reports `dumb`, which is why that check sits above the seam rather than under
# it: the answer must not depend on whether a caller cleared the environment.)
wk_color_on() {
  [[ "${WORKKIT_COLOR:-}" != '0' ]] || return 1
  [[ -z "${NO_COLOR:-}" ]] || return 1
  [[ "${TERM:-}" != 'dumb' ]] || return 1
  [[ "${WORKKIT_COLOR:-}" == '1' || -t 1 ]] || return 1
  return 0
}

# Set the palette every say_* below interpolates. The codes stay BACKSLASH
# literals rather than real escapes: each is used inside a printf FORMAT string,
# which is what expands them, and the empty string is what a no-color run
# interpolates instead.
wk_set_palette() {
  if wk_color_on; then
    _G='\033[0;32m' _Y='\033[0;33m' _C='\033[0;36m' _D='\033[0;90m' _B='\033[1m' _N='\033[0m'
  else
    _G='' _Y='' _C='' _D='' _B='' _N=''
  fi
}

# ── Voice ─────────────────────────────────────────────────────────────────────
# Each caller already has one — workkit.sh's say_* on stdout, standards.sh's
# log_* on stderr — and a library that printed in its own would make the same
# run speak two ways. Delegate where there is something to delegate to, print
# plainly where there is not (publish.sh, run from launchd).
wk_say_ok() {
  if declare -f say_ok >/dev/null 2>&1; then say_ok "$1"
  elif declare -f log_ok >/dev/null 2>&1; then log_ok "$1"
  else printf '✓ %s\n' "$1"; fi
}
wk_say_warn() {
  if declare -f say_warn >/dev/null 2>&1; then say_warn "$1"
  elif declare -f log_warn >/dev/null 2>&1; then log_warn "$1"
  else printf '⚠ %s\n' "$1"; fi
}
wk_say_info() {
  if declare -f say_info >/dev/null 2>&1; then say_info "$1"
  elif declare -f log_info >/dev/null 2>&1; then log_info "$1"
  else printf 'ℹ %s\n' "$1"; fi
}
wk_say_skip() {
  if declare -f say_skip >/dev/null 2>&1; then say_skip "$1"
  elif declare -f log_skip >/dev/null 2>&1; then log_skip "$1"
  else printf '· %s\n' "$1"; fi
}

# ── JSON ──────────────────────────────────────────────────────────────────────
# Write a jq edit back to a file safely: resolve symlinks first (this system's
# whole model is symlinking config out of ~, and writing the temp file over the
# LINK would replace it with a regular file and orphan the real one), refuse to
# touch a file jq cannot parse, and never leave a .tmp behind.
#
# Usage: wk_json_edit <file> <jq args...>
wk_json_edit() {
  local file="$1"; shift
  local target tmp rc=0
  command -v jq >/dev/null 2>&1 || return 1
  target=$(readlink -f "$file" 2>/dev/null || printf '%s' "$file")
  if ! jq empty "$target" 2>/dev/null; then
    wk_say_warn "settings: $target is not valid JSON — fix or remove it, then try again"
    return 1
  fi
  tmp="$target.tmp.$$"
  # shellcheck disable=SC2064  # expand $tmp now: it is what this call must clean up
  trap "rm -f '$tmp'" RETURN
  jq "$@" "$target" >"$tmp" || rc=$?
  if [[ "$rc" -ne 0 ]] || [[ ! -s "$tmp" ]]; then
    wk_say_warn "settings: could not write $target (left unchanged)"
    return 1
  fi
  mv "$tmp" "$target" || { wk_say_warn "settings: could not replace $target"; return 1; }
  return 0
}

# ── The state mutex ───────────────────────────────────────────────────────────
# Every machine-written file here is edited by a whole-file read-modify-write,
# and two runs doing that at once keep only the last writer's change — a
# decline, a roster registration, the cached node ids, the home slug: whichever
# lost is simply gone. mkdir is the atomic mutex, and EVERY writer takes this
# one, which is why it lives here rather than in any of them. ONE lock covers
# all three files: the writers are the same handful of runs, and a lock per file
# would only trade a rare wait for three ways to get the pairing wrong.
#
# Returns 0 holding the lock, 1 when another run held it for the whole 5s wait.
# Every caller proceeds either way — a rare lost edit costs less than a run that
# stops — and only the caller that took it releases it: the mutex belongs to
# whichever run holds it, and removing it on the way out of a run that never had
# it would let a third writer race the current holder.
WK_STATE_LOCK="$WK_USER_DIR/.state.lock"

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
# or a machine without jq — the three ways an answer can be missing, all of
# which mean the caller has no answer to act on.
wk_json_get() {
  local file="$1" filter="$2"
  [[ -f "$file" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  jq -r "$filter // empty" "$file" 2>/dev/null || true
}

# ── Slugs ─────────────────────────────────────────────────────────────────────
# `owner/repo` from a git remote URL, in either form git writes it. The same
# three shapes tower/api/lib/repos.js parses, so the roster and the home repo's
# project list can never disagree about what a repo is called.
wk_slug_from_remote() {
  local url="${1:-}" trimmed
  [[ -n "$url" ]] || return 0
  trimmed="${url%.git}"
  trimmed="${trimmed%/}"
  [[ "$trimmed" =~ [:/]([^:/]+)/([^/]+)$ ]] || return 0
  printf '%s/%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
}

# The origin slug of a git working tree, or empty when it has none.
wk_repo_slug() {
  local dir="${1:-.}" url
  url="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  wk_slug_from_remote "$url"
}
