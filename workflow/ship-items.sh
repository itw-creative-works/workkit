#!/usr/bin/env bash
# ship-items: what a ship carries, with the proof call already read (issue #290).
#
# The ship's Step 0c (skills/ship/SKILL.md) needs two lists and one question
# about each item on them: the open issues at `status:qa` and at
# `status:complete`, and whether each carries a `Proof:` line. Read by hand that
# is a list call per stage and a comment read per issue, which is where a ship
# drifts; here it is two calls and one line per issue:
#
#   <stage> #<N> <proved|unproved> <title>
#
# qa lines first, then complete, each by number ascending. The title is
# everything after the third field, verbatim. Nothing at either stage prints
# `ship-items: nothing at qa or complete` and exits 0; a `gh` that fails (or
# answers with something that is not JSON) prints one `ship-items: ...` line on
# stderr and exits 1, with nothing on stdout. A usage error exits 2, before gh
# is asked anything.
#
# Usage: ship-items.sh [--repo owner/name]
#
# Without `--repo` gh resolves the repo from the current directory, exactly as
# the ship's own `gh issue` calls do. Reached at the engine's stable address:
# ~/.claude/workkit/ship-items.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# wk_jq, the one jq the engine calls (the CRLF strip Windows needs). Nothing
# else of the engine is used, so nothing else is loaded.
# shellcheck source=./platform.sh
. "$SCRIPT_DIR/platform.sh"

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

# One stage's lines. The proof test is safety/proof-guard's, the same regex,
# which has four homes that change together: this one, hook_issue_has_proof in
# hooks/lib/proof.sh, and PROOF_LINE in tower/api/server/validate.js and in the dashboard's
# libs/tower/github/writes.js. tests/scripts/ship-items.test.js pins this one to
# hooks/lib/proof.sh. Any LINE of any comment may open with it, leading blanks
# tolerated and nothing else, case-sensitive; jq's test is not multiline by
# default, hence the explicit newline branch.
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
