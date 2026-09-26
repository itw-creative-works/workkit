#!/usr/bin/env bash
# workflow/home/options.sh: the site options and the clone's state. The
# remote URL and its offline seam, the home slug, the site host, the clone's
# branch, recording the slug, and what `~/.workkit/tower` is in one word.
# SOURCED by home.sh, never executed, and it runs nothing at load: it defines
# functions and sets nothing. It reads lib.sh's WK_HOME_DIR, WK_HOME_SETTINGS
# and WK_USER_DIR.

# The remote, and the one seam the suite needs: pointed at a local bare repo,
# every clone, fetch and push under home/ runs fully offline. Unset on a real
# machine, where the remote is the ordinary GitHub HTTPS URL.
wk_home_remote_url() {
  if [[ -n "${WORKKIT_HOME_REMOTE:-}" ]]; then printf '%s' "$WORKKIT_HOME_REMOTE"; return 0; fi
  printf 'https://github.com/%s.git' "$1"
}

# The home slug this machine is configured for, or empty. It is a SITE option:
# the hand-edited file names the repo the site publishes from (issue #80).
wk_home_slug() { wk_json_get "$WK_HOME_SETTINGS" '.site.repo'; }

# The site's own HOST, or empty when this machine has no custom domain: the
# recorded `site.url` with any scheme and any trailing slash taken off. One home
# for that shape because three callers need it and none of them wants a
# different answer (issue #230): publish.sh decides the build's path prefix on
# whether it is set at all and writes it as the CNAME, and workkit.sh composes
# the published site's base URL out of it. The trailing slash comes off HERE
# rather than at one caller, since a CNAME carries a host and never a path, and
# `ask_site_url` takes whatever was typed at its word.
wk_site_host() {
  local url
  url="$(wk_json_get "$WK_HOME_SETTINGS" '.site.url')"
  [[ -n "$url" ]] || return 0
  url="${url#*://}"
  printf '%s' "${url%/}"
}

# The branch the clone is on: the one `wk_home_commit_push` pushes to, and the
# one the published home pointer names so that every reader of the roster asks
# for the branch the writer actually wrote (issue #112). `main` is the answer
# when there is no clone to ask, since that is what the engine creates.
# symbolic-ref, not rev-parse: on an unborn HEAD rev-parse prints `HEAD` AND
# fails, so the fallback would append a second line into a JSON string.
wk_home_branch() {
  git -C "$WK_HOME_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'main'
}

# Record the home slug in the hand-edited settings: the one key setup writes
# there, and the key everything else reads to decide whether there is a home at
# all. Nothing else in that file is ever written by a machine.
wk_home_set_slug() {
  local locked=0 rc=0
  # The engine seeds this file on every run, so it is normally already here;
  # this covers the one order where it is not: a machine whose first workkit
  # command is `setup`, before any heal has written the user folder.
  if [[ ! -f "$WK_HOME_SETTINGS" ]]; then
    mkdir -p "$WK_USER_DIR" 2>/dev/null || return 1
    printf '{\n  "version": 1,\n  "site": {\n    "repo": null,\n    "publish": null,\n    "url": null\n  }\n}\n' \
      >"$WK_HOME_SETTINGS" 2>/dev/null || return 1
  fi
  # The shared mutex, for the same reason every other writer of the machine's
  # state files takes it: a whole-file read-modify-write, and a heal registering
  # a repo at the same moment would otherwise keep only one of the two edits.
  if wk_take_state_lock; then locked=1; fi
  wk_json_edit "$WK_HOME_SETTINGS" --arg s "$1" '.site = ((.site // {}) + { repo: $s })' || rc=$?
  if [[ "$locked" -eq 1 ]]; then wk_drop_state_lock; fi
  return "$rc"
}

# The origin slug of the folder, or empty when it is not a git repo.
wk_home_clone_slug() { wk_repo_slug "$WK_HOME_DIR"; }

# Whether the folder's origin IS the given repo. Asked of the URL as well as of
# the slug, because the two are the same question on a real machine and only the
# URL can answer it under the suite's local-remote seam.
wk_home_matches() {
  local slug="$1" actual
  actual="$(git -C "$WK_HOME_DIR" remote get-url origin 2>/dev/null || true)"
  [[ -n "$actual" ]] || return 1
  [[ "$actual" == "$(wk_home_remote_url "$slug")" ]] && return 0
  [[ "$(wk_slug_from_remote "$actual")" == "$slug" ]]
}

# What `~/.workkit/tower` IS, in one word: the answer doctor, publish and the
# summaries step all branch on.
#
#   unset    no home slug configured; nothing has been decided
#   absent   a slug is configured and there is no tower folder: setup clones it
#   clone    the folder is the home repo's clone
#   other    something else is at that path: never adopted, never converted
wk_home_state() {
  local slug
  slug="$(wk_home_slug)"
  [[ -n "$slug" ]] || { printf 'unset'; return 0; }
  if [[ ! -e "$WK_HOME_DIR" ]]; then printf 'absent'; return 0; fi
  if wk_home_matches "$slug"; then printf 'clone'; else printf 'other'; fi
}

# True when there is a home clone to read, write or push: the one guard the
# daily path uses before it touches anything.
wk_home_ready() { [[ "$(wk_home_state)" == "clone" ]]; }
