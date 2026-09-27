#!/usr/bin/env bash
# workflow/lib/discussions.sh: the one place that speaks GitHub's Discussions
# GraphQL for the home repo, sourced and never executed. Best effort: no `gh`,
# no network or a refusing token is an empty answer and a non-zero status.
# Categories cannot be created over the API (README § The home repo's lifecycle).
# Needs: lib.sh sourced first (WK_HOME_CACHE, wk_json_edit, the wk_ok family).

# The brief's category and the four setup checks for, one per summary cadence
# plus the brief's. A repo without them still gets its posts, in a fallback.
WK_DISC_BRIEF_CATEGORY='Brief'
WK_DISC_CATEGORIES=('Daily' 'Weekly' 'Monthly' "$WK_DISC_BRIEF_CATEGORY")
WK_DISC_FALLBACKS=('General' 'Announcements')

# What the last category resolution landed on: globals, since a `$(…)` capture
# would carry back only one of the id and the name.
WK_DISC_CATEGORY_ID=''
WK_DISC_CATEGORY_NAME=''

wk_disc_ready() {
  command -v gh >/dev/null 2>&1 && command -v jq >/dev/null 2>&1
}

# One GraphQL round trip for everything about the home repo that is worth
# caching: its node id, whether Discussions are on, and every category by name.
# Prints the compact JSON; non-zero and silent when the API could not answer.
wk_disc_fetch_meta() {
  local slug="$1" owner="${1%%/*}" name="${1##*/}" out
  out="$(wk_spin "reading $slug on GitHub" gh api graphql \
    -f owner="$owner" -f name="$name" \
    -f query='query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        id
        hasDiscussionsEnabled
        discussionCategories(first:25){ nodes { id name } }
      }
    }' 2>/dev/null)" || return 1
  printf '%s' "$out" | wk_jq -ce '
    .data.repository
    | select(. != null)
    | { repositoryId: .id,
        discussionsEnabled: .hasDiscussionsEnabled,
        categories: (.discussionCategories.nodes | map({ (.name): .id }) | add // {}) }
  ' 2>/dev/null || return 1
  return 0
}

# The cached meta for the home repo, fetched on a miss or a refresh into the
# disposable cache file, created here on demand.
# Usage: wk_disc_meta <slug> [--refresh]
wk_disc_meta() {
  local slug="$1" refresh="${2:-}" cached fresh locked=0
  wk_disc_ready || return 1

  if [[ "$refresh" != "--refresh" ]]; then
    cached="$(wk_jq -ce --arg s "$slug" '.homeCache[$s] // empty' "$WK_HOME_CACHE" 2>/dev/null || true)"
    if [[ -n "$cached" ]]; then printf '%s' "$cached"; return 0; fi
  fi

  fresh="$(wk_disc_fetch_meta "$slug")" || return 1
  [[ -n "$fresh" ]] || return 1
  # Under the shared mutex, best effort: a cache that lost a race is re-fetched,
  # never wrong.
  if [[ -d "$WK_USER_DIR" ]] || mkdir -p "$WK_USER_DIR" 2>/dev/null; then
    if wk_take_state_lock; then locked=1; fi
    [[ -f "$WK_HOME_CACHE" ]] || printf '{}\n' >"$WK_HOME_CACHE" 2>/dev/null || true
    wk_json_edit "$WK_HOME_CACHE" --arg s "$slug" --argjson m "$fresh" \
      '.homeCache = ((.homeCache // {}) + { ($s): $m })' >/dev/null 2>&1 || true
    if [[ "$locked" -eq 1 ]]; then wk_drop_state_lock; fi
  fi
  printf '%s' "$fresh"
}

# The repo's node id: what every mutation takes.
wk_disc_repo_id() {
  local meta
  meta="$(wk_disc_meta "$1" "${2:-}")" || return 1
  printf '%s' "$meta" | wk_jq -r '.repositoryId // empty' 2>/dev/null
}

# Resolve the category into WK_DISC_CATEGORY_ID and WK_DISC_CATEGORY_NAME; call
# it directly, never inside `$(…)`. A miss is refreshed once (a category made by
# hand since), then falls back to the repo's default.
wk_disc_resolve_category() {
  local slug="$1" want="$2" meta id candidate
  WK_DISC_CATEGORY_ID=''
  WK_DISC_CATEGORY_NAME=''

  meta="$(wk_disc_meta "$slug")" || return 1
  id="$(printf '%s' "$meta" | wk_jq -r --arg c "$want" '.categories[$c] // empty' 2>/dev/null)"
  if [[ -z "$id" ]]; then
    meta="$(wk_disc_meta "$slug" --refresh)" || return 1
    id="$(printf '%s' "$meta" | wk_jq -r --arg c "$want" '.categories[$c] // empty' 2>/dev/null)"
  fi
  if [[ -n "$id" ]]; then
    WK_DISC_CATEGORY_ID="$id"
    WK_DISC_CATEGORY_NAME="$want"
    return 0
  fi

  for candidate in "${WK_DISC_FALLBACKS[@]}"; do
    id="$(printf '%s' "$meta" | wk_jq -r --arg c "$candidate" '.categories[$c] // empty' 2>/dev/null)"
    if [[ -n "$id" ]]; then
      WK_DISC_CATEGORY_ID="$id"
      WK_DISC_CATEGORY_NAME="$candidate"
      return 0
    fi
  done

  # Whatever the repo does have, so a repo whose categories were renamed still
  # has somewhere to publish.
  WK_DISC_CATEGORY_NAME="$(printf '%s' "$meta" | wk_jq -r '.categories | keys | first // empty' 2>/dev/null)"
  WK_DISC_CATEGORY_ID="$(printf '%s' "$meta" | wk_jq -r '.categories | to_entries | first | .value // empty' 2>/dev/null)"
  [[ -n "$WK_DISC_CATEGORY_ID" ]] || return 1
  return 0
}

# The same answer for a caller that only wants the id and can live with a
# capture: wk_disc_list, which is itself always captured.
wk_disc_category_id() {
  wk_disc_resolve_category "$1" "$2" || return 1
  printf '%s' "$WK_DISC_CATEGORY_ID"
}

# Turn Discussions on. Idempotent by nature (the mutation sets a flag), but the
# read comes first so an already-enabled repo is not written to at all.
wk_disc_enable() {
  local slug="$1" meta repo_id
  wk_disc_ready || return 1
  meta="$(wk_disc_meta "$slug" --refresh)" || return 1
  if [[ "$(printf '%s' "$meta" | wk_jq -r '.discussionsEnabled')" == "true" ]]; then
    return 2   # already on; the caller says "current" rather than "enabled"
  fi
  repo_id="$(printf '%s' "$meta" | wk_jq -r '.repositoryId // empty')"
  [[ -n "$repo_id" ]] || return 1
  wk_spin 'turning Discussions on' gh api graphql -f repoId="$repo_id" -f query='mutation($repoId:ID!){
    updateRepository(input:{repositoryId:$repoId, hasDiscussionsEnabled:true}){
      repository { hasDiscussionsEnabled }
    }
  }' >/dev/null 2>&1 || return 1
  # The cache carries the old answer; the next reader must not see it.
  wk_disc_meta "$slug" --refresh >/dev/null 2>&1 || true
  return 0
}

# Post one summary or brief and print its URL. The body is a file, sent
# verbatim by `gh`'s `@file` form; the category is an id the caller resolved,
# so it can report a fallback.
# Usage: wk_disc_create <slug> <category-id> <title> <body-file>
wk_disc_create() {
  local slug="$1" cat_id="$2" title="$3" body_file="$4" repo_id out
  wk_disc_ready || return 1
  [[ -f "$body_file" ]] || return 1
  [[ -n "$cat_id" ]] || return 1

  repo_id="$(wk_disc_repo_id "$slug")" || return 1
  [[ -n "$repo_id" ]] || return 1

  out="$(wk_spin "posting $title" gh api graphql \
    -f repoId="$repo_id" -f catId="$cat_id" -f title="$title" -F body="@$body_file" \
    -f query='mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){
      createDiscussion(input:{repositoryId:$repoId, categoryId:$catId, title:$title, body:$body}){
        discussion { url }
      }
    }' 2>/dev/null)" || return 1
  printf '%s' "$out" | wk_jq -r '.data.createDiscussion.discussion.url // empty' 2>/dev/null
}

# The posts in a category since a moment, newest first, as a JSON array of
# { title, createdAt, body }. The API takes no date argument, so the window is
# applied here.
# Usage: wk_disc_list <slug> <category> <since-iso8601> [limit]
wk_disc_list() {
  local slug="$1" category="$2" since="$3" limit="${4:-50}" owner="${1%%/*}" name="${1##*/}" cat_id out
  wk_disc_ready || return 1
  cat_id="$(wk_disc_category_id "$slug" "$category")" || return 1
  [[ -n "$cat_id" ]] || return 1

  out="$(wk_spin "reading what $slug already carries" gh api graphql \
    -f owner="$owner" -f name="$name" -f catId="$cat_id" -F limit="$limit" \
    -f query='query($owner:String!,$name:String!,$catId:ID!,$limit:Int!){
      repository(owner:$owner,name:$name){
        discussions(first:$limit, categoryId:$catId, orderBy:{field:CREATED_AT, direction:DESC}){
          nodes { title createdAt body }
        }
      }
    }' 2>/dev/null)" || return 1
  printf '%s' "$out" | wk_jq -c --arg since "$since" '
    [ .data.repository.discussions.nodes[]? | select(.createdAt >= $since) ]
  ' 2>/dev/null || return 1
}
