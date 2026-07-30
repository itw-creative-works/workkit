#!/usr/bin/env bash
# jobs/brief-publish.sh — publishing the morning brief. SOURCED, never executed.
#
# The one home of "post today's digest as a Discussion on the home repo". Two
# runners call it — claude-daily.sh on the laptop and claude-cloud.sh on a
# GitHub Actions runner (issue #82) — and they differ only in what they do with
# the answer: the laptop logs every outcome and carries on, the cloud exits
# non-zero on a post that did not land. So this prints ONE line saying what
# happened and returns a status, and decides nothing about the run.
#
# It sets no shell options and runs nothing at load. The engine libraries it
# needs are sourced inside the function, which is normally called inside a
# `$(…)` capture — nothing it sources leaks into the caller's shell.
#
# The CATEGORY is asked for by name and answered by the fallback: categories
# cannot be created over the API, so `Brief` resolves to the repo's default
# unless someone made one by hand. The read-back in cc-news.js filters on the
# TITLE for the same reason — it cannot know which category a repo landed in.
#
# Usage: wk_brief_publish <engine-dir> <response> <mark-file> <body-file>
# Prints one line. Returns:
#   0  posted — the line carries the discussion URL
#   2  there was nothing to post: no engine, no home repo, no gh/jq, or today's
#      brief is already on the board (a second run, or the other runner's)
#   1  a post was attempted and did not land
wk_brief_publish() {
  local engine="$1" response="$2" mark_file="$3" body_file="$4"
  local slug date title posted url

  if [[ ! -f "$engine/lib.sh" || ! -f "$engine/discussions.sh" || ! -f "$engine/home.sh" ]]; then
    printf "brief: the engine's home-repo library is missing at %s — nothing published" "$engine"
    return 2
  fi
  # shellcheck source=../workflow/lib.sh
  . "$engine/lib.sh"
  # shellcheck source=../workflow/discussions.sh
  . "$engine/discussions.sh"
  # shellcheck source=../workflow/home.sh
  . "$engine/home.sh"

  slug="$(wk_home_slug)" || slug=''
  if [[ -z "$slug" ]]; then
    printf 'brief: no home repo configured — nothing published'
    return 2
  fi
  if ! wk_disc_ready; then
    printf 'brief: %s is the home repo, but gh and jq are what reach it — nothing published' "$slug"
    return 2
  fi

  date="$(date '+%Y-%m-%d')"
  # The prefix cc-news.js reads back by. Kept in step with BRIEF_TITLE_PREFIX
  # there — the one literal this shell and that module both know.
  title="brief: $date"

  # Check before post: the local job, the cloud dispatch and the cron backup can
  # all fire on one morning, and the answer is the same for each. It costs one
  # call, and it is what makes the overlap harmless.
  posted="$(wk_disc_list "$slug" 'Brief' "${date}T00:00:00Z")" || posted=''
  if [[ -n "$posted" ]] \
    && printf '%s' "$posted" | jq -e --arg t "$title" 'any(.[]; .title == $t)' >/dev/null 2>&1; then
    printf 'brief: %s already carries %s — nothing posted' "$slug" "$title"
    return 2
  fi

  printf '%s\n' "$response" >"$body_file"
  # The version line, verbatim from the module that owns its shape. An empty
  # file is a run that had no version to carry, and it publishes no line.
  if [[ -s "$mark_file" ]]; then
    printf '\n' >>"$body_file"
    cat "$mark_file" >>"$body_file"
  fi

  # One return covers two causes — the category read itself failed, or the repo
  # answered with no categories at all — and this caller cannot tell them apart.
  # Naming one of them would be a guess in the log, so it names neither.
  if ! wk_disc_resolve_category "$slug" 'Brief'; then
    printf 'brief: could not resolve a discussion category on %s — nothing posted' "$slug"
    return 1
  fi
  url="$(wk_disc_create "$slug" "$WK_DISC_CATEGORY_ID" "$title" "$body_file")" || url=''
  if [[ -z "$url" ]]; then
    printf 'brief: %s could not be posted to %s — nothing posted' "$title" "$slug"
    return 1
  fi
  printf 'brief: posted %s → %s' "$title" "$url"
  return 0
}
