#!/usr/bin/env bash
# jobs/morning/marker.sh: the morning's fifth step, the date of the newest brief
# on the board recorded for the session hook. SOURCED by morning.sh, never
# executed, and it runs nothing at load: it defines functions and sets nothing.
# Every name it reads (CLOUD, SCRIPT_DIR and the note helpers) is the entry's;
# wk_jq and wk_spin are lib.sh's, which the entry sources.

# ── 5. The marker ─────────────────────────────────────────────────────────────

# What the board actually carries, written down where a chat session can see it
# (issue #173). The brief is composed and published in the CLOUD, so its failures
# happen where nobody is looking: a runner whose token expired posted nothing for
# ten mornings and no session knew. A session start may reach no network at all,
# so the reading happens HERE and the answer is left in one file:
# `~/.workkit/brief-status.json`, which the `docs:session` hook reads at every
# session start and names when the date has gone stale.
#
# It runs LAST, which also buys the run this morning's dispatch started the
# longest chance to have posted before the board is read. A brief posted after
# this read is not lost: it is a marker one day behind, and one day behind is
# the ordinary morning the hook is silent about.
#
# NEVER A LIE. Every way this can fail (no gh, no home repo, a read that did not
# answer, a board carrying no brief) leaves the existing marker exactly as it
# was and names the skip. A marker a day stale warns a day late; an invented one
# never warns at all.
record_brief_status() {
  if (( CLOUD )); then
    note_skip 'marker: the brief marker is read at session start on a machine; a runner has no home that outlives the job, skipped'
    return 0
  fi

  local wk_dir marker prefix slug owner name out last
  wk_dir="${WORKFLOW_HOME:-$HOME/.workkit}"
  marker="$wk_dir/brief-status.json"

  if ! command -v gh >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
    note_skip 'marker: gh and jq are what read the board; the brief marker was left as it was'
    return 0
  fi

  slug="$(wk_jq -r '.site.repo // empty' "$wk_dir/settings.json" 2>/dev/null || true)"
  if [[ -z "$slug" ]]; then
    note_skip 'marker: no home repo configured; there is no board to read the newest brief from'
    return 0
  fi

  # The title prefix comes from the module that OWNS it rather than from a
  # second literal in a second language: tower/api/lib/history.js is where the
  # writer and every reader of these posts already agree.
  prefix="$(node -e 'process.stdout.write(require(process.argv[1]).BRIEF_TITLE_PREFIX)' \
    "$SCRIPT_DIR/../tower/api/lib/history.js" 2>/dev/null || true)"
  if [[ -z "$prefix" ]]; then
    note_warn 'marker: the brief title prefix could not be read from tower/api/lib/history.js; the marker was left as it was'
    return 0
  fi

  # ONE bounded read, on the same knob and the same reasoning as the engine's
  # own reads: a captive portal answers the handshake and never the request, and
  # an unbounded call here would hold the morning open for as long as it liked.
  # macOS ships no coreutils `timeout`, so the bound is applied where there is
  # one and the read is made plain where there is not: a bound that fires looks
  # exactly like a read that did not answer, which is already a named skip.
  # Expanded the bash 3.2 way, like TIMEOUT in morning.sh: a bare "${BOUND[@]}" is an
  # unbound variable there under `set -u`.
  local BOUND=()
  if command -v timeout >/dev/null 2>&1; then BOUND=(timeout "${WORKKIT_GH_TIMEOUT:-10}"); fi

  # The window is 50 because the board is SHARED (the daily summaries publish
  # beside the briefs) and the gap this exists to notice is measured in days.
  owner="${slug%%/*}"
  name="${slug##*/}"
  out="$(wk_spin 'reading the newest brief' ${BOUND[@]+"${BOUND[@]}"} gh api graphql \
    -f owner="$owner" -f name="$name" \
    -f query='query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        discussions(first:50, orderBy:{field:CREATED_AT, direction:DESC}){
          nodes { title }
        }
      }
    }' 2>/dev/null)" || out=''
  if [[ -z "$out" ]]; then
    note_warn "marker: the board on $slug could not be read; the brief marker was left as it was"
    return 0
  fi

  last="$(printf '%s' "$out" | wk_jq -r --arg p "$prefix" '
    [ .data.repository.discussions.nodes[]? | .title | select(startswith($p)) ]
    | .[0] // empty | ltrimstr($p)' 2>/dev/null || true)"
  case "$last" in
    ([0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;;
    (*)
      note_skip "marker: nothing titled ${prefix}<date> in the newest 50 posts on $slug; the brief marker was left as it was"
      return 0
      ;;
  esac

  mkdir -p "$wk_dir" 2>/dev/null || true
  # Written whole BESIDE the marker and renamed onto it: the hook may read this
  # file at any moment, and half a marker must never be one of the things it can
  # find. Beside it and not in the scratch, because a move across filesystems is
  # a copy and an unlink rather than a rename - and a copy is exactly the half
  # file this is written this way to rule out.
  #
  # The move is GUARDED ON THE WRITE. A scratch file that filled the disk or lost
  # its directory is a truncated one, and moving that over a good marker is the
  # one way this step could destroy the very answer it exists to keep: the same
  # never-a-lie rule every skip above obeys, at the last step where it can break.
  # A move that fails takes the temp with it: the marker's own directory is the
  # machine's, and nothing half-written is left sitting in it.
  if ! printf '{\n  "version": 1,\n  "lastBrief": "%s",\n  "checkedAt": "%s"\n}\n' \
    "$last" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"$marker.tmp" 2>/dev/null; then
    rm -f "$marker.tmp" 2>/dev/null || true
    note_warn "marker: the marker could not be written in $wk_dir; $marker was left as it was (the board says the newest brief is $last)"
    return 0
  fi
  if mv "$marker.tmp" "$marker" 2>/dev/null; then
    note "marker: the newest brief on $slug is $last; recorded in $marker"
  else
    rm -f "$marker.tmp" 2>/dev/null || true
    note_warn "marker: $marker could not be written; the board says the newest brief is $last"
  fi
  return 0
}
