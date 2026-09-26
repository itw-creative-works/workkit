#!/usr/bin/env bash
# workflow/home/services.sh: the repo's GitHub services. The Discussions
# categories checked and walked through, and Pages switched on. SOURCED by
# home.sh, never executed, and it runs nothing at load: it defines functions and
# sets nothing. WK_HOME_PAGES_BRANCH and WK_HOME_MISSING_CATEGORIES are the
# entry's; WK_DISC_CATEGORIES is discussions.sh's.

# The categories of WK_DISC_CATEGORIES the repo does not have, comma-joined,
# from one wk_disc_meta answer. Empty means all four are there.
wk_home_missing_categories() {
  local meta="$1" name missing=''
  for name in "${WK_DISC_CATEGORIES[@]}"; do
    printf '%s' "$meta" | wk_jq -e --arg c "$name" '.categories | has($c)' >/dev/null 2>&1 || missing="$missing, $name"
  done
  printf '%s' "${missing#, }"
}

# The poll's check (wk_poll runs it in this shell): a fresh read of the
# categories, the missing ones left in WK_HOME_MISSING_CATEGORIES for the
# caller's pointer, and 0 only when all four are there.
wk_home_categories_present() {
  local meta
  meta="$(wk_disc_meta "$1" --refresh)" || return 1
  WK_HOME_MISSING_CATEGORIES="$(wk_home_missing_categories "$meta")"
  [[ -z "$WK_HOME_MISSING_CATEGORIES" ]]
}

# Discussions on, and the four categories checked. Categories CANNOT be created
# over the API (no createDiscussionCategory mutation exists, probed 2026-07-28),
# so setup does the next best thing (issue #244), in omega's walkthrough shape
# (wk_enter_to_open and wk_poll in lib/flows.sh): at a terminal it names the missing
# ones, opens the page that makes them on Enter, and polls every five seconds
# until they are there, Enter checking now and `s` skipping. Anywhere else, or
# after a skip, it is the one-time pointer at the page, and the summaries and
# the brief publish into the repo's default category until they exist.
wk_home_discussions() {
  local slug="$1" rc=0 meta missing=''
  local page="https://github.com/$slug/discussions/categories"
  wk_disc_ready || { wk_skip "home: Discussions need gh and jq; skipped"; return 0; }

  wk_disc_enable "$slug" || rc=$?
  case "$rc" in
    0) wk_ok "home: Discussions enabled on $slug" ;;
    2) wk_skip "home: Discussions are on for $slug" ;;
    *) wk_warn "home: could not enable Discussions on $slug; turn them on at https://github.com/$slug/settings"; return 0 ;;
  esac

  meta="$(wk_disc_meta "$slug" --refresh)" || return 0
  missing="$(wk_home_missing_categories "$meta")"
  if [[ -z "$missing" ]]; then
    wk_skip "home: the Daily, Weekly, Monthly and Brief categories are there"
    return 0
  fi

  # Only where there is someone at the keyboard: the piped run (the ship's
  # setup, a morning job) prints the pointer instead. The name is what the
  # posts match on, so any format will do.
  if declare -f interactive >/dev/null 2>&1 && interactive; then
    wk_enter_to_open "$page" 'the categories page' \
      "Make the $missing categories on this page, each with that exact name (any format)."
    if wk_poll 'Waiting for the categories' 5 wk_home_categories_present "$slug"; then
      wk_ok "home: the Daily, Weekly, Monthly and Brief categories are there"
      return 0
    fi
    # A read that failed during the poll leaves the global empty: the pointer
    # then names what the step's own read found missing.
    missing="${WK_HOME_MISSING_CATEGORIES:-$missing}"
  fi
  wk_info "home: the $missing categories do not exist yet; GitHub has no API that creates one, so make them once at $page. Until then the summaries and the brief publish in the repo's default category"
  return 0
}

# Pages, serving the built dashboard from the ROOT of the `gh-pages` branch.
#
# The API's `source.path` takes exactly two values, `/` and `/docs` (probed
# against the live schema 2026-07-28, `"enum":["/","/docs"]`), and a branch
# that carries nothing but the build has no reason to bury it in a folder, so
# the path is `/` and the branch carries the whole answer.
#
# The branch need not exist yet: Pages accepts a source pointing at one that
# does not, and simply serves nothing until the first publish pushes it. That
# order is what keeps setup out of the branch-creating business (issue #71):
# the publish makes the branch, because pushing output is its job.
#
# A refusal is the ordinary case on a plan without private Pages: it warns with
# the fix and setup carries on.
wk_home_pages() {
  local slug="$1" out
  command -v gh >/dev/null 2>&1 || return 0

  if wk_spin 'reading the Pages settings' gh api "repos/$slug/pages" >/dev/null 2>&1; then
    wk_skip "home: GitHub Pages is on for $slug"
    return 0
  fi
  out="$(wk_spin 'turning GitHub Pages on' gh api -X POST "repos/$slug/pages" \
    -f "source[branch]=$WK_HOME_PAGES_BRANCH" -f 'source[path]=/' 2>&1)" || {
    wk_warn "home: could not enable GitHub Pages on $slug; a private repo needs a paid plan for Pages; make the repo public or enable it at https://github.com/$slug/settings/pages"
    return 0
  }
  wk_ok "home: GitHub Pages serves $slug from $WK_HOME_PAGES_BRANCH /"
  return 0
}
