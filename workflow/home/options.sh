#!/usr/bin/env bash
# workflow/home/options.sh: the site options and the clone's state. Sourced by
# home.sh, functions only. Reads lib.sh's WK_HOME_DIR, WK_HOME_SETTINGS and
# WK_USER_DIR.

# WORKKIT_HOME_REMOTE is the suite's seam: a local bare repo keeps every clone,
# fetch and push under home/ offline.
wk_home_remote_url() {
  if [[ -n "${WORKKIT_HOME_REMOTE:-}" ]]; then printf '%s' "$WORKKIT_HOME_REMOTE"; return 0; fi
  printf 'https://github.com/%s.git' "$1"
}

# The home slug this machine is configured for, or empty.
wk_home_slug() { wk_json_get "$WK_HOME_SETTINGS" '.site.repo'; }

# The site's host, or empty with no custom domain: `site.url` with any scheme
# and trailing slash taken off here, since a CNAME carries a host and never a
# path, and `ask_site_url` takes what was typed at its word.
wk_site_host() {
  local url
  url="$(wk_json_get "$WK_HOME_SETTINGS" '.site.url')"
  [[ -n "$url" ]] || return 0
  url="${url#*://}"
  printf '%s' "${url%/}"
}

# The branch the clone is on, `main` with no clone to ask. symbolic-ref, not
# rev-parse: on an unborn HEAD rev-parse prints `HEAD` and fails, so the
# fallback would append a second line into a JSON string.
wk_home_branch() {
  git -C "$WK_HOME_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'main'
}

# The one key a machine writes in the hand-edited settings.
wk_home_set_slug() {
  local locked=0 rc=0
  # Absent only when `setup` runs before any heal has seeded the user folder.
  if [[ ! -f "$WK_HOME_SETTINGS" ]]; then
    mkdir -p "$WK_USER_DIR" 2>/dev/null || return 1
    printf '{\n  "version": 1,\n  "site": {\n    "repo": null,\n    "publish": null,\n    "url": null\n  }\n}\n' \
      >"$WK_HOME_SETTINGS" 2>/dev/null || return 1
  fi
  # The shared mutex, like every writer of the machine's state files.
  if wk_take_state_lock; then locked=1; fi
  wk_json_edit "$WK_HOME_SETTINGS" --arg s "$1" '.site = ((.site // {}) + { repo: $s })' || rc=$?
  if [[ "$locked" -eq 1 ]]; then wk_drop_state_lock; fi
  return "$rc"
}

# The origin slug of the folder, or empty when it is not a git repo.
wk_home_clone_slug() { wk_repo_slug "$WK_HOME_DIR"; }

# Whether the folder's origin is the given repo. The URL is asked too, since
# only it can answer under the suite's local-remote seam.
wk_home_matches() {
  local slug="$1" actual
  actual="$(git -C "$WK_HOME_DIR" remote get-url origin 2>/dev/null || true)"
  [[ -n "$actual" ]] || return 1
  [[ "$actual" == "$(wk_home_remote_url "$slug")" ]] && return 0
  [[ "$(wk_slug_from_remote "$actual")" == "$slug" ]]
}

# What `~/.workkit/tower` is, in one word: unset (no slug), absent (setup clones
# it), clone, or other (something else, never adopted).
wk_home_state() {
  local slug
  slug="$(wk_home_slug)"
  [[ -n "$slug" ]] || { printf 'unset'; return 0; }
  if [[ ! -e "$WK_HOME_DIR" ]]; then printf 'absent'; return 0; fi
  if wk_home_matches "$slug"; then printf 'clone'; else printf 'other'; fi
}

# The one guard the daily path takes before it touches the clone.
wk_home_ready() { [[ "$(wk_home_state)" == "clone" ]]; }
