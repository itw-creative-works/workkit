#!/usr/bin/env bash
# workflow/home/services.sh: the home repo's Discussions and Pages. Sourced by
# home.sh, functions only. WK_HOME_PAGES_BRANCH and WK_HOME_MISSING_CATEGORIES
# are the entry's; WK_DISC_CATEGORIES is discussions.sh's.

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

# Discussions on, and the four categories checked, never created (no API does):
# README § The home repo's lifecycle, step 7.
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

  # A piped run prints the pointer instead. The posts match on the name, so any
  # format will do.
  if declare -f interactive >/dev/null 2>&1 && interactive; then
    wk_enter_to_open "$page" 'the categories page' \
      "Make the $missing categories on this page, each with that exact name (any format)."
    if wk_poll 'Waiting for the categories' 5 wk_home_categories_present "$slug"; then
      wk_ok "home: the Daily, Weekly, Monthly and Brief categories are there"
      return 0
    fi
    # A read that failed during the poll leaves the global empty.
    missing="${WK_HOME_MISSING_CATEGORIES:-$missing}"
  fi
  wk_info "home: the $missing categories do not exist yet; GitHub has no API that creates one, so make them once at $page. Until then the summaries and the brief publish in the repo's default category"
  return 0
}

# Pages from the root of the `gh-pages` branch, which need not exist yet: the
# first publish makes it. README § The home repo's lifecycle, step 8.
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
