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
# The user's workflow folder, which issue #27 turns into a clone of the home
# repo. WORKFLOW_HOME is the same override the rest of the engine honors — the
# suite points it at a fixture, so nothing here ever reaches the real one.
WK_HOME_DIR="${WORKFLOW_HOME:-${HOME:-}/.workkit}"
# Machine-local: paths, declines, the roster, the home slug, the id cache. Named
# settings.json still (issue #27 Spec, deviation 2) and gitignored in the clone.
WK_HOME_SETTINGS="$WK_HOME_DIR/settings.json"
# Committed: the opted-in project slugs, the site settings, the preferences.
WK_HOME_CONFIG="$WK_HOME_DIR/workkit.json"
# The built site the home repo publishes, and the folder Pages serves. `docs/`
# rather than `site/`: the Pages API's `source.path` takes exactly two values,
# `/` and `/docs` (probed against the live schema 2026-07-28, `"enum":["/",
# "/docs"]`), so a subdirectory named anything else cannot be served from the
# branch at all.
WK_HOME_SITE="$WK_HOME_DIR/docs"

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

# ── The settings mutex ────────────────────────────────────────────────────────
# The machine-local settings file is edited by a whole-file read-modify-write,
# and two runs doing that at once keep only the last writer's change — a
# decline, a roster registration, the cached node ids, the home slug: whichever
# lost is simply gone. mkdir is the atomic mutex, and EVERY writer takes this
# one, which is why it lives here rather than in any of them.
#
# Returns 0 holding the lock, 1 when another run held it for the whole 5s wait.
# Every caller proceeds either way — a rare lost edit costs less than a run that
# stops — and only the caller that took it releases it: the mutex belongs to
# whichever run holds it, and removing it on the way out of a run that never had
# it would let a third writer race the current holder.
WK_SETTINGS_LOCK="$WK_HOME_SETTINGS.lock"

wk_take_settings_lock() {
  local waited=0
  mkdir -p "$(dirname "$WK_SETTINGS_LOCK")" 2>/dev/null || return 1
  while [ "$waited" -lt 50 ]; do
    if mkdir "$WK_SETTINGS_LOCK" 2>/dev/null; then return 0; fi
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

wk_drop_settings_lock() {
  rmdir "$WK_SETTINGS_LOCK" 2>/dev/null || true
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
