#!/usr/bin/env bash
# jobs/morning/brief-publish.sh: posts today's digest as a Discussion on the home
# repo, for morning.sh's cloud path. Sourced; it prints one line and returns a
# status, and the caller decides what a failure costs (jobs/README.md § The brief
# is published). Its libraries are sourced inside the function, which runs in a
# `$(…)` capture, so nothing leaks into the caller's shell.
#
# Usage: wk_brief_publish <engine-dir> <response> <mark-file> <body-file>
# Returns 0 posted (the line carries the URL), 2 nothing to post, 1 not landed.
wk_brief_publish() {
  local engine="$1" response="$2" mark_file="$3" body_file="$4"
  local slug date title posted url

  if [[ ! -f "$engine/lib.sh" || ! -f "$engine/lib/discussions.sh" || ! -f "$engine/home.sh" ]]; then
    printf "brief: the engine's home-repo library is missing at %s; nothing published" "$engine"
    return 2
  fi
  # shellcheck source=../workflow/lib.sh
  . "$engine/lib.sh"
  # shellcheck source=../workflow/lib/discussions.sh
  . "$engine/lib/discussions.sh"
  # shellcheck source=../workflow/home.sh
  . "$engine/home.sh"

  slug="$(wk_home_slug)" || slug=''
  if [[ -z "$slug" ]]; then
    printf 'brief: no home repo configured; nothing published'
    return 2
  fi
  if ! wk_disc_ready; then
    printf 'brief: %s is the home repo, but gh and jq are what reach it; nothing published' "$slug"
    return 2
  fi

  date="$(date '+%Y-%m-%d')"
  # The prefix cc-news.js reads back by. Kept in step with BRIEF_TITLE_PREFIX
  # there: the one literal this shell and that module both know.
  title="brief: $date"

  # Check before post: the dispatched run and its cron backup can both fire on
  # one morning, and this one call makes the overlap harmless.
  posted="$(wk_disc_list "$slug" "$WK_DISC_BRIEF_CATEGORY" "${date}T00:00:00Z")" || posted=''
  if [[ -n "$posted" ]] \
    && printf '%s' "$posted" | wk_jq -e --arg t "$title" 'any(.[]; .title == $t)' >/dev/null 2>&1; then
    printf 'brief: %s already carries %s; nothing posted' "$slug" "$title"
    return 2
  fi

  printf '%s\n' "$response" >"$body_file"
  # The version line, verbatim from the module that owns its shape. An empty
  # file is a run that had no version to carry, and it publishes no line.
  if [[ -s "$mark_file" ]]; then
    printf '\n' >>"$body_file"
    cat "$mark_file" >>"$body_file"
  fi

  # One return covers two causes: the category read itself failed, or the repo
  # answered with no categories at all, and this caller cannot tell them apart.
  # Naming one of them would be a guess in the log, so it names neither.
  if ! wk_disc_resolve_category "$slug" "$WK_DISC_BRIEF_CATEGORY"; then
    printf 'brief: could not resolve a discussion category on %s; nothing posted' "$slug"
    return 1
  fi
  url="$(wk_disc_create "$slug" "$WK_DISC_CATEGORY_ID" "$title" "$body_file")" || url=''
  if [[ -z "$url" ]]; then
    printf 'brief: %s could not be posted to %s; nothing posted' "$title" "$slug"
    return 1
  fi
  printf 'brief: posted %s → %s' "$title" "$url"
  return 0
}
