#!/usr/bin/env bash
# jobs/morning/summaries.sh: the morning's first step, the day that just ended
# written up by claude-nightly.sh. SOURCED by morning.sh, never executed, and it
# runs nothing at load: it defines functions and sets nothing. Every name it
# reads (CLOUD, SCRIPT_DIR, LOG_FILE, LOG_STAMP, TIMEOUT, the note helpers and
# have_history) is the entry's.

# ── 1. The summaries ──────────────────────────────────────────────────────────

# Yesterday is written up before the brief is composed, so the morning reads a
# record that already includes the day behind it. claude-nightly.sh stays the one
# home of that logic: its own guards (a day already written up is skipped, a
# quiet day sends nothing) and its own log; calling it is all the wiring there is.
#
# A summaries failure is NOT the brief's failure. It is logged here and the
# morning carries on: the job exists to make sure nine o'clock says something.
summaries() {
  if (( CLOUD )); then
    note_skip 'summaries: a GitHub Actions runner has no session transcripts and no git history to write up; skipped'
    return 0
  fi
  if ! have_history; then
    note_skip 'summaries: this machine has no session transcripts to read; skipped'
    return 0
  fi

  local status=0 output
  output="$(${TIMEOUT[@]+"${TIMEOUT[@]}"} bash "$SCRIPT_DIR/claude-nightly.sh" 2>&1)" || status=$?
  if (( status != 0 )); then
    {
      printf '%s\n' "--- $LOG_STAMP ---"
      printf '[summaries exit %d; the brief continues]\n' "$status"
      printf '%s\n\n' "$output"
    } >> "$LOG_FILE"
  fi
  return 0
}
