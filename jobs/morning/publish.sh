#!/usr/bin/env bash
# jobs/morning/publish.sh: the morning's fourth step, the tower site rebuilt and
# pushed by the engine's publish. SOURCED by morning.sh, never executed, and it
# runs nothing at load: it defines functions and sets nothing. Every name it
# reads (CLOUD, ENGINE, LOG_FILE, LOG_STAMP, TIMEOUT, note_skip and
# have_publish) is the entry's.

# ── 4. The publish ────────────────────────────────────────────────────────────

# The published dashboard: the tower project in ~/.workkit/tower, rebuilt and
# pushed to the home repo's gh-pages branch. It runs after the brief and only for
# the morning, for the same reason the summaries run first and are allowed to fail:
# the job exists to make sure nine o'clock says something, and a build is the
# slowest thing here. Its every reason not to publish (`site.publish` off (the
# default), no home repo, no build tooling, a diverged clone, nothing changed)
# is a skip it logs and exits 0 on, so only a real failure appears in this block.
#
# It runs whether or not the day was handed over: the site is this machine's to
# build either way.
publish_site() {
  if (( CLOUD )); then
    note_skip 'publish: the site is built from the home clone on a machine; a runner has neither, skipped'
    return 0
  fi
  have_publish || return 0
  local status=0 output
  output="$(${TIMEOUT[@]+"${TIMEOUT[@]}"} bash "$ENGINE/publish.sh" --quiet 2>&1)" || status=$?
  if (( status != 0 )); then
    {
      printf '%s\n' "--- $LOG_STAMP ---"
      printf '[publish exit %d; the brief was already sent]\n' "$status"
      printf '%s\n\n' "$output"
    } >> "$LOG_FILE"
  elif [[ -n "$output" ]]; then
    printf '%s\n%s\n\n' "--- $LOG_STAMP ---" "$output" >> "$LOG_FILE"
  fi
  return 0
}
