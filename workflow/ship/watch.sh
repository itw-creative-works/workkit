#!/usr/bin/env bash
# workkit ship watch: the ship's CI watch, a pushed sha in and one answer out.
# Usage: workkit ship watch <sha>. Exit 0 green (or no CI for push), 1 red, 2
# usage or a sha this clone does not know, 3 not queued yet, 4 gh failed or the
# watch did not finish, 5 a watch already running, 130 interrupted; the lines
# and the log: `workflow/README.md`, the ship/watch.sh row. The foreground runs
# this file as `--watch-body <sha>`, detached, and tails its log. A trigger
# (`push`, `pull_request`) is a top-level `on:` naming it in any of its YAML
# shapes; one nested deeper is not one.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole, and a watch outlives many edits to the kit.

usage() {
  printf 'usage: workkit ship watch <sha>\n' >&2
  printf '  finds the runs for a pushed sha, watches every one, and says green or red\n' >&2
  exit 2
}

repo_root() { git rev-parse --show-toplevel 2>/dev/null || pwd -P; }

# The sha a running watch names on its log's first line. A body just launched
# may not have written it yet, so it is waited for, two seconds at most.
watched_sha() {
  local line='' waited=0
  while ((waited < 20)); do
    line="$(head -n 1 "$1" 2>/dev/null)" || line=''
    [[ "$line" == 'ci-watch: watching '* ]] && break
    sleep 0.1
    waited=$((waited + 1))
  done
  [[ "$line" == 'ci-watch: watching '* ]] || { printf 'an unlogged sha\n'; return 0; }
  printf '%s\n' "${line#ci-watch: watching }"
}

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

# The sha's runs as list_runs prints them, asked TRIES times WAIT seconds
# apart while the list stays empty.
await_runs() {
  local rows='' try
  for ((try = 1; try <= TRIES; try++)); do
    rows="$(list_runs)" || exit $?
    [[ -z "$rows" ]] || break
    if ((try < TRIES)); then sleep "$WAIT"; fi
  done
  printf '%s' "$rows"
}

# The open PR's number for the branch whose tip is the sha (nothing when there
# is none, the HEAD is detached or the tip is another commit), since CI that
# never runs on the branch's push may run on its PR; exit 4 when gh fails.
open_pr() {
  local root branch out number
  root="$(repo_root)"
  branch="$(git -C "$root" symbolic-ref --quiet --short HEAD 2>/dev/null)" || return 0
  [[ "$(git -C "$root" rev-parse HEAD 2>/dev/null)" == "$SHA" ]] || return 0
  if ! out="$(gh pr list --head "$branch" --state open --json number,url --limit 1 2>"$ERR_FILE")"; then
    printf 'ci-watch: gh pr list --head %s failed: %s\n' "$branch" "$(head -n 1 "$ERR_FILE")" >&2
    exit 4
  fi
  if ! number="$(printf '%s' "$out" | wk_jq -r 'if type == "array" then .[0].number // empty else error end' 2>/dev/null)"; then
    printf 'ci-watch: gh pr list --head %s answered no PR list: %s\n' "$branch" "$(printf '%s' "$out" | head -n 1)" >&2
    exit 4
  fi
  printf '%s' "$number"
}

# Does any workflow at the repo's toplevel run on the event $1? One file at a
# time, by triggers.awk, the rule the release job's dispatch reads too.
triggered_on() {
  local root file
  root="$(repo_root)"
  shopt -s nullglob
  for file in "$root"/.github/workflows/*.yml "$root"/.github/workflows/*.yaml; do
    if awk -v ev="$1" -f "$SCRIPT_DIR/triggers.awk" "$file"; then
      return 0
    fi
  done
  return 1
}

push_configured() { triggered_on push; }
pr_configured() { triggered_on pull_request; }

# Watch one run to its end. A non-zero watch is red only when the run says it
# finished; otherwise the watch failed, which is exit 4. Every gh call reads
# /dev/null, or it would swallow the loop's remaining run rows.
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

# platform.sh, detach.sh and (in the foreground) suite.sh, never lib.sh: the
# lines this prints are its own contract, not the engine's voice, so the
# palette and the addresses stay unloaded.
load_libs() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  # shellcheck source=../lib/platform.sh
  . "$SCRIPT_DIR/../lib/platform.sh"
  # shellcheck source=../lib/detach.sh
  . "$SCRIPT_DIR/../lib/detach.sh"
}

# The foreground: run this same script as the body, detached, and answer with
# its code. A 3 with WK_HELD_PID set is a held lock, nothing run; a 3 without it
# is the body's own "not queued". A code the body never logged is the runner
# failing, which is no answer, never a red.
foreground() {
  local root log lock rc=0 last
  # shellcheck source=../lib/suite.sh
  . "$SCRIPT_DIR/../lib/suite.sh"
  root="$(repo_root)"
  log="$(wk_ci_log_path "$root")"
  lock="$(wk_ci_lock_path "$root")"
  wk_run_detached "$log" "$lock" -- "$BASH" "$SCRIPT_DIR/watch.sh" --watch-body "$SHA" || rc=$?
  if ((rc == 3)) && [[ -n "$WK_HELD_PID" ]]; then
    printf 'ci-watch: a watch is already running for %s (pid %s); its output is in %s\n' \
      "$(watched_sha "$log")" "$WK_HELD_PID" "$log" >&2
    exit 5
  fi
  last="$(tail -n 1 "$log" 2>/dev/null)" || last=''
  if ((rc != 0)) && { [[ -z "$WK_RAN_CODE" ]] || [[ "$last" != "ci-watch: exit $rc" ]]; }; then
    printf 'ci-watch: the watch did not finish, so there is no answer; its output is in %s\n' "$log" >&2
    exit 4
  fi
  exit "$rc"
}

# The body: its first line names the sha, its last is always its exit code.
watch_body() {
  local rows='' pr='' status=0 id name url
  wk_body_traps ci-watch 'rm -f "${ERR_FILE:-}"'
  printf 'ci-watch: watching %s\n' "$SHA"
  ERR_FILE="$(mktemp)"

  rows="$(await_runs)" || exit $?
  if [[ -z "$rows" ]] && pr_configured; then pr="$(open_pr)" || exit $?; fi
  if [[ -n "$pr" ]]; then
    printf "ci-watch: waiting for PR #%s's run for %s\n" "$pr" "$SHA"
    rows="$(await_runs)" || exit $?
    if [[ -z "$rows" ]]; then
      printf 'ci-watch: run not queued yet for %s (PR #%s)\n' "$SHA" "$pr" >&2
      exit 3
    fi
  fi

  if [[ -z "$rows" ]]; then
    if push_configured; then
      printf 'ci-watch: run not queued yet for %s\n' "$SHA" >&2
      exit 3
    fi
    printf 'ci-watch: no CI configured for push\n'
    exit 0
  fi

  while IFS=$'\t' read -r id name url; do
    watch_run "$id" "$name" "$url" || status=1
  done <<<"$rows"
  exit "$status"
}

main() {
  local body=0 sha
  set -euo pipefail
  load_libs
  TRIES="${WORKKIT_CI_WATCH_TRIES:-6}"
  WAIT="${WORKKIT_CI_WATCH_WAIT:-10}"
  LOG_TAIL=40
  if [[ $# -eq 2 && "$1" == --watch-body ]]; then
    body=1
    shift
  fi
  [[ $# -eq 1 && "$1" =~ ^[0-9a-fA-F]{7,40}$ ]] || usage
  # gh run list --commit matches the full 40-character id only.
  sha="$1"
  if ((${#sha} < 40)); then
    sha="$(git -C "$(repo_root)" rev-parse --verify --quiet "$1^{commit}")" || {
      printf 'ci-watch: %s is not a commit this clone knows; fetch it or pass the full sha\n' "$1" >&2
      exit 2
    }
  fi
  SHA="$sha"
  if ((body == 1)); then watch_body; fi
  foreground
}

main "$@"
