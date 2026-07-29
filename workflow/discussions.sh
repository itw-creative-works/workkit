#!/usr/bin/env bash
# workflow/discussions.sh — the home repo's Discussions API. SOURCED, never executed.
#
# Summaries are published, never filed (owner ruling, 2026-07-28: generated
# records are never files). The destination is a Discussion on the home repo, so
# this is the one place that speaks GitHub's Discussions GraphQL — the setup
# wizard uses it to turn Discussions on, the summaries step to post and to read
# prior posts back.
#
# WHAT THE API ACTUALLY OFFERS, probed against the live schema 2026-07-28:
#   · `updateRepository(hasDiscussionsEnabled:)` — Discussions can be ENABLED.
#   · `createDiscussion(repositoryId, categoryId, title, body)` — posts exist.
#   · `repository.discussions(categoryId:, orderBy:)` — prior posts read back;
#     there is no date argument, so the window is applied here.
#   · there is NO createDiscussionCategory mutation. Categories cannot be made
#     over the API at all, which is why `wk_disc_category_id` falls back to the
#     repo's default category and the wizard prints a one-time manual pointer.
#
# Every call is best effort: a machine with no `gh`, no network, or a token that
# refuses gets an empty answer and a non-zero status, never an abort. The
# summaries step exits 0 either way — the same doctrine the brief runs under.
#
# Needs: lib.sh sourced first (WK_HOME_CACHE, wk_json_edit, wk_say_*).

# The categories a summary looks for, one per cadence. A repo that has them gets
# a tidy archive; a repo that does not still gets its summaries (see the
# fallback below), because a post nobody can file is worse than a post in
# General.
WK_DISC_FALLBACKS=('General' 'Announcements')

# What the last category resolution landed on. GLOBALS rather than a printed
# pair, because the caller needs BOTH the id and the name and a `$(…)` capture
# would only carry one of them back — a fallback learned inside a subshell is a
# fallback nobody can report.
WK_DISC_CATEGORY_ID=''
WK_DISC_CATEGORY_NAME=''

# The tools this file needs. `gh` carries the auth, `jq` reads the answers.
wk_disc_ready() {
  command -v gh >/dev/null 2>&1 && command -v jq >/dev/null 2>&1
}

# One GraphQL round trip for everything about the home repo that is worth
# caching: its node id, whether Discussions are on, and every category by name.
# Prints the compact JSON; non-zero and silent when the API could not answer.
wk_disc_fetch_meta() {
  local slug="$1" owner="${1%%/*}" name="${1##*/}" out
  out="$(gh api graphql \
    -f owner="$owner" -f name="$name" \
    -f query='query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        id
        hasDiscussionsEnabled
        discussionCategories(first:25){ nodes { id name } }
      }
    }' 2>/dev/null)" || return 1
  printf '%s' "$out" | jq -ce '
    .data.repository
    | select(. != null)
    | { repositoryId: .id,
        discussionsEnabled: .hasDiscussionsEnabled,
        categories: (.discussionCategories.nodes | map({ (.name): .id }) | add // {}) }
  ' 2>/dev/null || return 1
  return 0
}

# The cached meta for the home repo, fetching and caching when it is absent or
# when the caller asks for a refresh. The cache lives in the machine's DISPOSABLE
# file (`~/.workkit/.cache.json`, issue #80): node ids are GitHub's, not the
# project's, they are never hand-edited, and deleting the file costs one round
# trip — which is why it is created here on demand rather than seeded anywhere.
#
# Usage: wk_disc_meta <slug> [--refresh]
wk_disc_meta() {
  local slug="$1" refresh="${2:-}" cached fresh locked=0
  wk_disc_ready || return 1

  if [[ "$refresh" != "--refresh" ]]; then
    cached="$(jq -ce --arg s "$slug" '.homeCache[$s] // empty' "$WK_HOME_CACHE" 2>/dev/null || true)"
    if [[ -n "$cached" ]]; then printf '%s' "$cached"; return 0; fi
  fi

  fresh="$(wk_disc_fetch_meta "$slug")" || return 1
  [[ -n "$fresh" ]] || return 1
  # Under the shared mutex: this is a whole-file read-modify-write, and the
  # cc-news cursor writes the same file in the same minute of a morning. Taking
  # the lock is best effort like every other writer's — a cache that lost a race
  # is re-fetched, never wrong.
  if [[ -d "$WK_USER_DIR" ]] || mkdir -p "$WK_USER_DIR" 2>/dev/null; then
    if wk_take_state_lock; then locked=1; fi
    [[ -f "$WK_HOME_CACHE" ]] || printf '{}\n' >"$WK_HOME_CACHE" 2>/dev/null || true
    wk_json_edit "$WK_HOME_CACHE" --arg s "$slug" --argjson m "$fresh" \
      '.homeCache = ((.homeCache // {}) + { ($s): $m })' >/dev/null 2>&1 || true
    if [[ "$locked" -eq 1 ]]; then wk_drop_state_lock; fi
  fi
  printf '%s' "$fresh"
}

# The repo's node id — what every mutation takes.
wk_disc_repo_id() {
  local meta
  meta="$(wk_disc_meta "$1" "${2:-}")" || return 1
  printf '%s' "$meta" | jq -r '.repositoryId // empty' 2>/dev/null
}

# Resolve the category to post in, into WK_DISC_CATEGORY_ID and
# WK_DISC_CATEGORY_NAME. Call it DIRECTLY (never inside `$(…)`) — that is the
# whole point of it setting globals.
#
# A cache miss is refreshed ONCE — a category created by hand after the cache
# was written is the ordinary reason for a miss — and a name that still is not
# there falls back to the repo's default, because categories cannot be created
# over the API (see the header).
wk_disc_resolve_category() {
  local slug="$1" want="$2" meta id candidate
  WK_DISC_CATEGORY_ID=''
  WK_DISC_CATEGORY_NAME=''

  meta="$(wk_disc_meta "$slug")" || return 1
  id="$(printf '%s' "$meta" | jq -r --arg c "$want" '.categories[$c] // empty' 2>/dev/null)"
  if [[ -z "$id" ]]; then
    meta="$(wk_disc_meta "$slug" --refresh)" || return 1
    id="$(printf '%s' "$meta" | jq -r --arg c "$want" '.categories[$c] // empty' 2>/dev/null)"
  fi
  if [[ -n "$id" ]]; then
    WK_DISC_CATEGORY_ID="$id"
    WK_DISC_CATEGORY_NAME="$want"
    return 0
  fi

  for candidate in "${WK_DISC_FALLBACKS[@]}"; do
    id="$(printf '%s' "$meta" | jq -r --arg c "$candidate" '.categories[$c] // empty' 2>/dev/null)"
    if [[ -n "$id" ]]; then
      WK_DISC_CATEGORY_ID="$id"
      WK_DISC_CATEGORY_NAME="$candidate"
      return 0
    fi
  done

  # Whatever the repo does have, so a repo whose categories were renamed still
  # has somewhere to publish.
  WK_DISC_CATEGORY_NAME="$(printf '%s' "$meta" | jq -r '.categories | keys | first // empty' 2>/dev/null)"
  WK_DISC_CATEGORY_ID="$(printf '%s' "$meta" | jq -r '.categories | to_entries | first | .value // empty' 2>/dev/null)"
  [[ -n "$WK_DISC_CATEGORY_ID" ]] || return 1
  return 0
}

# The same answer for a caller that only wants the id and can live with a
# capture — wk_disc_list, which is itself always captured.
wk_disc_category_id() {
  wk_disc_resolve_category "$1" "$2" || return 1
  printf '%s' "$WK_DISC_CATEGORY_ID"
}

# Turn Discussions on. Idempotent by nature — the mutation sets a flag — but the
# read comes first so an already-enabled repo is not written to at all.
wk_disc_enable() {
  local slug="$1" meta repo_id
  wk_disc_ready || return 1
  meta="$(wk_disc_meta "$slug" --refresh)" || return 1
  if [[ "$(printf '%s' "$meta" | jq -r '.discussionsEnabled')" == "true" ]]; then
    return 2   # already on — the caller says "current" rather than "enabled"
  fi
  repo_id="$(printf '%s' "$meta" | jq -r '.repositoryId // empty')"
  [[ -n "$repo_id" ]] || return 1
  gh api graphql -f repoId="$repo_id" -f query='mutation($repoId:ID!){
    updateRepository(input:{repositoryId:$repoId, hasDiscussionsEnabled:true}){
      repository { hasDiscussionsEnabled }
    }
  }' >/dev/null 2>&1 || return 1
  # The cache carries the old answer; the next reader must not see it.
  wk_disc_meta "$slug" --refresh >/dev/null 2>&1 || true
  return 0
}

# Post one summary. The body comes from a FILE — a day's reflection is far past
# what an argument list should carry, and `gh`'s `@file` form sends it verbatim.
# Prints the discussion URL.
#
# The category is an ID, not a name: the caller resolves it with
# wk_disc_resolve_category first, which is what lets it report a fallback.
#
# Usage: wk_disc_create <slug> <category-id> <title> <body-file>
wk_disc_create() {
  local slug="$1" cat_id="$2" title="$3" body_file="$4" repo_id out
  wk_disc_ready || return 1
  [[ -f "$body_file" ]] || return 1
  [[ -n "$cat_id" ]] || return 1

  repo_id="$(wk_disc_repo_id "$slug")" || return 1
  [[ -n "$repo_id" ]] || return 1

  out="$(gh api graphql \
    -f repoId="$repo_id" -f catId="$cat_id" -f title="$title" -F body="@$body_file" \
    -f query='mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!){
      createDiscussion(input:{repositoryId:$repoId, categoryId:$catId, title:$title, body:$body}){
        discussion { url }
      }
    }' 2>/dev/null)" || return 1
  printf '%s' "$out" | jq -r '.data.createDiscussion.discussion.url // empty' 2>/dev/null
}

# The summaries already published in a category since a moment, newest first, as
# a JSON array of { title, createdAt, body } — what a weekly or monthly rollup
# reads instead of a folder of files. The window is applied here: the API takes
# no date argument (probed 2026-07-28), only an order.
#
# Usage: wk_disc_list <slug> <category> <since-iso8601> [limit]
wk_disc_list() {
  local slug="$1" category="$2" since="$3" limit="${4:-50}" owner="${1%%/*}" name="${1##*/}" cat_id out
  wk_disc_ready || return 1
  cat_id="$(wk_disc_category_id "$slug" "$category")" || return 1
  [[ -n "$cat_id" ]] || return 1

  out="$(gh api graphql \
    -f owner="$owner" -f name="$name" -f catId="$cat_id" -F limit="$limit" \
    -f query='query($owner:String!,$name:String!,$catId:ID!,$limit:Int!){
      repository(owner:$owner,name:$name){
        discussions(first:$limit, categoryId:$catId, orderBy:{field:CREATED_AT, direction:DESC}){
          nodes { title createdAt body }
        }
      }
    }' 2>/dev/null)" || return 1
  printf '%s' "$out" | jq -c --arg since "$since" '
    [ .data.repository.discussions.nodes[]? | select(.createdAt >= $since) ]
  ' 2>/dev/null || return 1
}
