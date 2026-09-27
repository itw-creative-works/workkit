#!/usr/bin/env bash
# ship-items: what a ship carries, with the proof call already read: the open
# issues at `status:qa` then `status:complete`, one `<stage> #<N>
# <proved|unproved> <title>` line each (`workflow/README.md`, the
# ship/ship-items.sh row). Usage: ship-items.sh [--repo owner/name]; without
# --repo gh resolves the repo from the current directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# wk_jq, the one jq the engine calls (the CRLF strip Windows needs). Nothing
# else of the engine is used, so nothing else is loaded.
# shellcheck source=../lib/platform.sh
. "$SCRIPT_DIR/../lib/platform.sh"

fail() {
  printf 'ship-items: %s\n' "$1" >&2
  exit 1
}

# A usage error is exit 2, the code ci-watch.sh beside it uses for one.
usage() {
  printf 'ship-items: %s (usage: ship-items.sh [--repo owner/name])\n' "$1" >&2
  exit 2
}

repo_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --repo)
      [ $# -ge 2 ] && [ -n "$2" ] || usage '--repo needs a value'
      repo_args=(--repo "$2")
      shift 2
      ;;
    *) usage "unknown argument: $1" ;;
  esac
done

errfile="$(mktemp)"
trap 'rm -f "$errfile"' EXIT

# One stage's lines. The proof test is safety/proof-guard's regex, with four
# homes that change together: this, hook_issue_has_proof in hooks/lib/proof.sh,
# and PROOF_LINE in tower/api/server/validate.js and the dashboard's
# libs/tower/github/writes.js. jq's test is not multiline, hence the newline branch.
stage_lines() {
  local stage="$1" json reason
  if ! json="$(gh issue list --state open --label "status:$stage" \
      --json number,title,comments --limit 1000 ${repo_args[@]+"${repo_args[@]}"} 2>"$errfile")"; then
    reason="$(tr -d '\r' <"$errfile" | grep -m1 . || true)"
    fail "gh issue list failed for status:$stage: ${reason:-no reason given}"
  fi
  wk_jq -r --arg stage "$stage" '
    sort_by(.number)[]
    | ([.comments[]?.body // "" | select(test("(^|\n)[ \t]*Proof:"))] | length > 0) as $proved
    | "\($stage) #\(.number) \(if $proved then "proved" else "unproved" end) \(.title)"
  ' <<<"$json" 2>/dev/null || fail "gh answered no readable issue list for status:$stage"
}

# Both stages are read before anything prints, so a failure on the second
# leaves stdout empty rather than half a list.
qa="$(stage_lines qa)"
complete="$(stage_lines complete)"

if [ -z "$qa" ] && [ -z "$complete" ]; then
  printf 'ship-items: nothing at qa or complete\n'
  exit 0
fi
[ -z "$qa" ] || printf '%s\n' "$qa"
[ -z "$complete" ] || printf '%s\n' "$complete"
