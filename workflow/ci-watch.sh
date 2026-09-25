#!/usr/bin/env bash
# ci-watch: the ship's CI watch, a pushed sha in and one answer out (issue #290).
#
# A direct push is unchecked until CI runs, so the ship waits on it. This is
# that wait made mechanical: find the sha's runs, watch every one, and say what
# they concluded, in a line the ship reads and an exit code it branches on.
#
# Usage: ci-watch.sh <sha>
#
#   0  every run green: `ci-watch: green: <workflow> <url>` per run on stdout.
#      Or no run and no workflow triggered by a push: `ci-watch: no CI
#      configured for push`, since there is nothing to wait for.
#   1  a run red: `ci-watch: RED: <workflow>, job <failing job>: <url>` on
#      stderr, then the last lines of its failed step's log. Every run is still
#      watched, so each green one says so and each red one is named.
#   2  usage: no sha, or not 7 to 40 hex characters.
#   3  no run after the retries, but a workflow IS triggered by a push: `ci-watch:
#      run not queued yet for <sha>` on stderr. The ship ends without a
#      conclusion rather than calling the push clean.
#   4  gh failed: `ci-watch: gh ...` on stderr, carrying what gh said. A
#      `gh run list` that failed or answered no run list, and a watch that
#      exited non-zero on a run gh cannot then show as finished (GitHub
#      unreachable, the login refused): that is no answer, never a red.
#
# GitHub can take a minute to queue a run, so an empty list is asked again:
# WORKKIT_CI_WATCH_TRIES times (6), WORKKIT_CI_WATCH_WAIT seconds apart (10).
# A failed list is not an empty one and is never retried.
#
# The push trigger is read from `.github/workflows/*.yml` and `*.yaml` at the
# cwd's git toplevel: a top-level `on:` naming `push`, as `on: push`, as a flow
# list or map (`on: [pull_request, push]`), or as a key or list item directly
# under a block `on:`. A `push` nested deeper (a branch named push) is not one.
#
# Reached at the engine's stable address: ~/.claude/workkit/ci-watch.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# wk_jq and nothing else: the lines this prints are its own contract, not the
# engine's voice, so the palette and the addresses in lib.sh stay unloaded.
# shellcheck source=./platform.sh
. "$SCRIPT_DIR/platform.sh"

TRIES="${WORKKIT_CI_WATCH_TRIES:-6}"
WAIT="${WORKKIT_CI_WATCH_WAIT:-10}"
LOG_TAIL=40

usage() {
  printf 'usage: ci-watch.sh <sha>\n' >&2
  printf '  finds the runs for a pushed sha, watches every one, and says green or red\n' >&2
  exit 2
}

[[ $# -eq 1 && "$1" =~ ^[0-9a-fA-F]{7,40}$ ]] || usage
SHA="$1"

ERR_FILE="$(mktemp)"
trap 'rm -f "$ERR_FILE"' EXIT

# The sha's runs, one `<id>\t<workflow>\t<url>` row each (nothing when there
# are none yet), or exit 4 with gh's own first line of complaint. An answer
# that is not a JSON list is gh failing too, never an empty list.
list_runs() {
  local out rows
  if ! out="$(gh run list --commit "$SHA" --json databaseId,name,status,conclusion,url 2>"$ERR_FILE")"; then
    printf 'ci-watch: gh run list --commit %s failed: %s\n' "$SHA" "$(head -n 1 "$ERR_FILE")" >&2
    exit 4
  fi
  if ! rows="$(printf '%s' "$out" | wk_jq -r '.[] | [.databaseId, .name, .url] | @tsv' 2>/dev/null)"; then
    printf 'ci-watch: gh run list --commit %s answered no run list: %s\n' "$SHA" "$(printf '%s' "$out" | head -n 1)" >&2
    exit 4
  fi
  printf '%s' "$rows"
}

# Does any workflow at the repo's toplevel run on a push? Read in awk, one file
# at a time, carriage returns off and single quotes read as double, so a quoted
# `"on":` key and a CRLF file answer the same as the plain one.
push_configured() {
  local root file
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || root="$(pwd -P)"
  shopt -s nullglob
  for file in "$root"/.github/workflows/*.yml "$root"/.github/workflows/*.yaml; do
    if tr -d '\r' <"$file" | tr "'" '"' | awk '
      /^[[:space:]]*(#|$)/ { next }
      inblock && /^[^[:space:]]/ { inblock = 0 }
      inblock {
        match($0, /^[[:space:]]*/)
        if (want < 0) want = RLENGTH
        if (RLENGTH == want) {
          line = substr($0, RLENGTH + 1)
          sub(/^-[[:space:]]*/, "", line)
          if (line ~ /^"?push"?[[:space:]]*(:|#|$)/) found = 1
        }
        next
      }
      /^"?on"?[[:space:]]*:/ {
        rest = $0
        sub(/^[^:]*:/, "", rest)
        sub(/#.*/, "", rest)
        if (rest ~ /[^[:space:]]/) {
          if (rest ~ /(^|[^A-Za-z0-9_-])push([^A-Za-z0-9_-]|$)/) found = 1
        } else {
          inblock = 1
          want = -1
        }
      }
      END { exit found ? 0 : 1 }
    '; then
      return 0
    fi
  done
  return 1
}

# Watch one run to its end and say what it concluded. A watch that exits
# non-zero is only red when the run itself says it finished: one view answers
# that and names the first failed job, and a view that fails, or a run with no
# conclusion yet, means the watch failed rather than the run, which is exit 4.
# Red goes on stderr with the tail of the failed step's log.
#
# Every gh call reads /dev/null, never the loop's stdin: that stdin is the run
# rows, and a child that read it would swallow the runs still to be watched.
watch_run() {
  local id="$1" name="$2" url="$3" view conclusion job
  if gh run watch "$id" --exit-status </dev/null >/dev/null 2>"$ERR_FILE"; then
    printf 'ci-watch: green: %s %s\n' "$name" "$url"
    return 0
  fi
  view="$(gh run view "$id" --json conclusion,jobs </dev/null 2>>"$ERR_FILE")" || view=''
  conclusion="$(printf '%s' "$view" | wk_jq -r '.conclusion // empty' 2>/dev/null)" || conclusion=''
  if [[ -z "$conclusion" ]]; then
    printf 'ci-watch: gh run watch %s failed: %s\n' "$id" "$(head -n 1 "$ERR_FILE")" >&2
    exit 4
  fi
  job="$(printf '%s' "$view" \
    | wk_jq -r 'first(.jobs[]? | select(.conclusion == "failure") | .name) // "unknown"' 2>/dev/null)" || job=''
  printf 'ci-watch: RED: %s, job %s: %s\n' "$name" "${job:-unknown}" "$url" >&2
  { gh run view "$id" --log-failed </dev/null 2>/dev/null || true; } | tail -n "$LOG_TAIL" >&2
  return 1
}

rows=''
for ((try = 1; try <= TRIES; try++)); do
  rows="$(list_runs)" || exit $?
  [[ -z "$rows" ]] || break
  if ((try < TRIES)); then sleep "$WAIT"; fi
done

if [[ -z "$rows" ]]; then
  if push_configured; then
    printf 'ci-watch: run not queued yet for %s\n' "$SHA" >&2
    exit 3
  fi
  printf 'ci-watch: no CI configured for push\n'
  exit 0
fi

status=0
while IFS=$'\t' read -r id name url; do
  watch_run "$id" "$name" "$url" || status=1
done <<<"$rows"
exit "$status"
