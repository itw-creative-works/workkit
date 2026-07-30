#!/usr/bin/env bash
# jobs/claude-cloud.sh — the morning brief, composed and published from a
# GitHub Actions runner (issues #82, #91).
#
# It runs from the HOME REPO's checkout of itself. This file is the source, and
# `workkit setup` seeds a copy of it — with brief-publish.sh, the composers and
# the engine libraries they need — into `brief/` on `<login>/workkit`, beside
# the `.github/workflows/brief.yml` that drives it. The plugin repo is
# distributed to everyone who installs the kit, so it is the one place the
# cloud brief's credentials must NOT live.
#
# The cloud sibling of claude-daily.sh's brief leg, and ONLY that leg. The
# summaries step reads this machine's git log and its session transcripts, and
# the site publish builds the project in the home clone; none of those exist on
# a runner, so both stay on the laptop. What travels is the part that needs
# nothing but GitHub: the board, the health the board can see, the digest, and
# the Discussion it is published as.
#
# It differs from the laptop in one DELIBERATE way: failures are loud. The local
# job swallows every reason it could not publish, because the morning already
# happened on screen and a post that could not be made must not undo it. Here
# the Actions log IS the delivery — a silent failure is a morning nobody hears
# about at all — so a brief that could not be composed, sent or posted exits
# non-zero and shows up as a red run.
#
# The runner's REAL $HOME is the workflow folder's home: the Node composers
# resolve `~/.workkit` through os.homedir() and honor no override, so this
# script writes the synthetic settings and roster exactly where they look.
#
# Needs: gh, jq, git, node, and a `claude` on PATH authenticated by
# CLAUDE_CODE_OAUTH_TOKEN. The home repo is the repo the run BELONGS to —
# GITHUB_REPOSITORY, which Actions always sets — so nothing has to be told
# which one it is.
#
# TWO TOKENS, TWO JOBS (issue #91). GH_TOKEN is the cross-repo one: the board
# sweep and the gh-pages read of the published slug list, both reaching repos
# this workflow does not run in. WORKKIT_POST_TOKEN is the workflow's built-in
# GITHUB_TOKEN, which reaches this repo alone and is all the Discussion post
# needs; it is exported for that one call and nothing else. A run handed
# neither falls back to the other, which is what lets a rehearsal work with one.
# Usage: claude-cloud.sh   (no arguments — the runner has one job)

set -euo pipefail

# A RUNNER ONLY. Everything below writes the synthetic machine into ~/.workkit —
# the settings file, and a roster of synthetic checkouts that REPLACES whatever
# was registered there. On a runner that folder is scratch that dies with the
# job; on a laptop it is the real roster every other part of the kit reads, so a
# stray local run would leave phantom repos on the tower and in the next
# published slug list. GITHUB_ACTIONS is the variable Actions always sets.
if [[ "${GITHUB_ACTIONS:-}" != "true" ]]; then
  printf 'claude-cloud: GITHUB_ACTIONS is not set — this script only runs on a GitHub Actions runner, because it rewrites ~/.workkit. Use claude-daily.sh locally.\n' >&2
  exit 1
fi

# Resolve before any cd — BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/../workflow"

WK_DIR="$HOME/.workkit"
SETTINGS="$WK_DIR/settings.json"
ROSTER="$WK_DIR/.repos.json"
# The bash side of the engine and cc-news.js both honor this override; the Node
# composers do not. Pinning it to the folder they resolve is what keeps the two
# halves of the run reading one home.
export WORKFLOW_HOME="$WK_DIR"

SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT
MARK_FILE="$SCRATCH_DIR/cc-version"
export WORKKIT_BRIEF_MARK_FILE="$MARK_FILE"

# shellcheck source=./brief-publish.sh
. "$SCRIPT_DIR/brief-publish.sh"

# The log is the Actions log. One line per thing that happened, on stdout.
note() { printf '%s\n' "$1"; }

# ── The machine this runner pretends to be ────────────────────────────────────

# The settings file the engine and the composers read the home repo from. An
# existing one WINS — a runner that was handed a configured home does not get it
# rewritten — and an absent one is written from the repo this run belongs to.
#
# GITHUB_REPOSITORY IS the home (issue #91): the workflow lives on the home repo
# and nowhere else, so the run already knows which repo it is standing in and
# nothing has to be configured to tell it. With neither that nor a settings file
# there is no board to read and nowhere to publish, which is the one thing this
# script refuses over rather than working around.
if [[ ! -f "$SETTINGS" ]]; then
  if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
    printf 'claude-cloud: GITHUB_REPOSITORY is unset and %s does not exist — there is no home repo to sweep or publish to.\n' \
      "$SETTINGS" >&2
    exit 1
  fi
  mkdir -p "$WK_DIR"
  printf '{\n  "version": 1,\n  "site": {\n    "repo": "%s"\n  }\n}\n' "$GITHUB_REPOSITORY" >"$SETTINGS"
  note "settings: wrote $SETTINGS for $GITHUB_REPOSITORY"
fi

# jq is asked FIRST, on its own. It reads the home slug on the next line and
# writes the roster later, and an absent one would empty that read — making a
# missing tool look exactly like a settings file that names no home repo.
if ! command -v jq >/dev/null 2>&1; then
  printf 'claude-cloud: jq is not installed — the settings file cannot be read and the roster cannot be written.\n' >&2
  exit 1
fi

HOME_SLUG="$(jq -r '.site.repo // empty' "$SETTINGS" 2>/dev/null || true)"
if [[ -z "$HOME_SLUG" ]]; then
  printf 'claude-cloud: %s names no home repo (.site.repo) — there is no board to sweep or publish to.\n' \
    "$SETTINGS" >&2
  exit 1
fi

# Which repos this brief covers. The roster is a machine's own knowledge and a
# runner has none, so it is read from the one place the machine already
# published it: `data/repos.json` on the home repo's gh-pages branch, the slug
# list the published dashboard sweeps (workflow/site-repos.js writes it). The
# contents API answers with a base64 body.
fetch_site_repos() {
  local slug="$1" encoded
  command -v gh >/dev/null 2>&1 || return 1
  encoded="$(gh api "repos/$slug/contents/data/repos.json?ref=gh-pages" -q '.content' 2>/dev/null)" || return 1
  [[ -n "$encoded" ]] || return 1
  printf '%s' "$encoded" | tr -d '\n' | base64 -d 2>/dev/null || return 1
}

SITE_REPOS=''
if ! SITE_REPOS="$(fetch_site_repos "$HOME_SLUG")"; then SITE_REPOS=''; fi
SLUGS="$(printf '%s' "$SITE_REPOS" | jq -r '.repos[]? // empty' 2>/dev/null || true)"
if [[ -z "$SLUGS" ]]; then
  # No published list — the site has never been published, or publishing is off.
  # The home repo ALONE is the fallback rather than an empty roster: its issues
  # are the cross-project queue, so a brief built from it is a real morning,
  # while an empty board would read as "nothing is waiting on you" — the one
  # thing a brief must never say when it simply did not look.
  note "roster: no published slug list on $HOME_SLUG (gh-pages data/repos.json) — sweeping the home repo alone"
  SLUGS="$HOME_SLUG"
fi
# The home repo is on the published list already; this covers the list that
# somehow lost it, since it is where the brief is published either way.
printf '%s\n' "$SLUGS" | grep -qxF "$HOME_SLUG" || SLUGS="$SLUGS"$'\n'"$HOME_SLUG"

# A synthetic checkout per slug, because that is what the roster is a list OF:
# `discoverRepos` reads a path, checks the committed opt-in there and asks git
# for the origin. Both are given honestly and nothing else is faked — there is
# no working tree, so health reads zeroes and the brief carries no warnings from
# a runner. The board, which needs only the slug, is unaffected.
ENTRIES=''
while IFS= read -r slug; do
  [[ "$slug" == */* ]] || continue
  dir="$WK_DIR/cloud/$slug"
  mkdir -p "$dir/.workkit"
  printf '{\n  "version": 1,\n  "enabled": true\n}\n' >"$dir/.workkit/settings.json"
  if [[ ! -d "$dir/.git" ]]; then
    git init -q "$dir" >/dev/null 2>&1 || continue
  fi
  git -C "$dir" remote remove origin >/dev/null 2>&1 || true
  git -C "$dir" remote add origin "https://github.com/$slug.git" >/dev/null 2>&1 || true
  ENTRIES="$ENTRIES$dir"$'\n'
done <<<"$SLUGS"

printf '%s' "$ENTRIES" | jq -R -s '
  split("\n") | map(select(length > 0))
  | { version: 1, repos: (map({ (.): "enabled" }) | add // {}) }' >"$ROSTER"
note "roster: $(printf '%s' "$ENTRIES" | grep -c . || true) repos in $ROSTER"

# ── The brief ─────────────────────────────────────────────────────────────────

PAYLOAD_STATUS=0
# The composer's stderr stays out of the payload and goes to the log instead: on
# a failure it is the crash, and on a good run it is the line naming repos the
# sweep could not read — the shape a token whose reach is short takes here, and
# the only place the Actions log would ever say so.
PAYLOAD_ERR_FILE="$SCRATCH_DIR/payload-err"
MESSAGE="$(node "$SCRIPT_DIR/brief-payload.js" 2>"$PAYLOAD_ERR_FILE")" || PAYLOAD_STATUS=$?
PAYLOAD_ERR="$(cat "$PAYLOAD_ERR_FILE" 2>/dev/null || true)"
if (( PAYLOAD_STATUS != 0 )); then
  printf 'claude-cloud: brief-payload exit %d\n%s\n' "$PAYLOAD_STATUS" "$PAYLOAD_ERR" >&2
  exit "$PAYLOAD_STATUS"
fi
if [[ -n "$PAYLOAD_ERR" ]]; then note "$PAYLOAD_ERR"; fi

# The DIGEST NEVER REACHES THIS LOG. It summarizes issues across private repos,
# and an Actions log belongs to the repo it ran in — one that could be made
# public. The Discussion is the delivery; the log needs only proof of life, so it
# carries the headline the response leads with and how much there was of it.
STATUS=0
SEND_ERR_FILE="$SCRATCH_DIR/send-err"
RESPONSE="$(claude -p "$MESSAGE" \
  --model haiku \
  --effort low \
  --safe-mode \
  --no-session-persistence \
  --tools "" \
  --max-budget-usd 0.25 2>"$SEND_ERR_FILE")" || STATUS=$?

if (( STATUS != 0 )); then
  # The status and what the CLI said about it — never the payload it was handed,
  # and never whatever half a digest it managed before it stopped.
  printf 'claude-cloud: the digest send exit %d\n%s\n' "$STATUS" "$(cat "$SEND_ERR_FILE" 2>/dev/null || true)" >&2
  exit "$STATUS"
fi

note "digest: $(printf '%s' "$RESPONSE" | head -1) (${#RESPONSE} bytes)"

PUBLISH_STATUS=0
# The one call that speaks to THIS repo, and the one that uses the workflow's
# built-in token: the Discussion is posted where the run lives, so the
# cross-repo secret has no business in it. The export is inside the capture's
# subshell, so the sweep's token is untouched for anything after this.
PUBLISH_LINE="$(
  # An empty value is left alone rather than exported: `gh` reads an empty
  # GH_TOKEN as a token, not as an absent one, and a run given only the
  # cross-repo secret must keep it.
  if [[ -n "${WORKKIT_POST_TOKEN:-}" ]]; then export GH_TOKEN="$WORKKIT_POST_TOKEN"; fi
  wk_brief_publish "$ENGINE" "$RESPONSE" "$MARK_FILE" "$SCRATCH_DIR/brief.md"
)" || PUBLISH_STATUS=$?
if [[ -n "$PUBLISH_LINE" ]]; then note "$PUBLISH_LINE"; fi
# 2 is nothing to post — today's brief is already on the board, or this runner
# has nowhere to publish; both are ordinary mornings. 1 is a post that was
# attempted and did not land, and that is the red run.
if (( PUBLISH_STATUS == 1 )); then
  exit 1
fi
exit 0
