#!/usr/bin/env bash
# jobs/morning.sh — the morning, in ONE script (issue #107).
#
# Two schedulers run this same body: the 9am LaunchAgent on this machine
# (com.workkit.claude-daily) and the brief.yml workflow `workkit setup` seeds
# onto the home repo. There is no laptop script and cloud script — there are
# three steps, and each one asks whether the environment it woke up in has what
# that step needs. A step that cannot run here says so by name.
#
#   1 the summaries  need this machine's session transcripts and git history —
#                    the Mac.
#   2 the brief      needs the sweep token and the roster, which live on the
#                    home repo — the CLOUD. Here the step is the dispatch and
#                    nothing else: a dispatch that cannot be made is a logged,
#                    briefless morning.
#   3 the publish    needs the home clone and its build tooling — the Mac.
#
# The environments differ in three DELIBERATE ways, all about where the output
# goes. On a runner the Actions log IS the delivery, so a failure there is loud
# and red; here the morning already happened on screen, so a failure is one
# logged line and exit 0. There is no desktop to notify on a runner. And the
# digest body never reaches the Actions log, which belongs to a repo that could
# be made public — it gets the headline and a byte count as proof of life.
#
# Usage: morning.sh [--now | message]
#   no arguments   the scheduled morning
#   --now          the brief on demand (`npm run brief`): composed and sent
#                  HERE, stamped manual, and publishing nothing — a post at noon
#                  would make the scheduled brief find its own title on the
#                  board and skip, and would advance the news cursor onto news
#                  that brief has yet to report
#   message        the generic headless runner — no summaries, no publish
#   A runner takes no arguments; the workflow passes none.
#
# Runs standalone or via launchd (sets its own PATH — launchd provides a bare env).
# Log: ~/Library/Logs/claude-daily.log — appended, one timestamped block per run,
#      and named for the schedule's label rather than for this file. In the cloud
#      the Actions log is the log.

set -euo pipefail

# Resolve before any cd — BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/../workflow"

# The workflow on the home repo that runs this same script on a runner. The
# dispatch below names it; setup seeds it as .github/workflows/brief.yml.
BRIEF_WORKFLOW='brief.yml'

# ── Where this run woke up ────────────────────────────────────────────────────

# GITHUB_ACTIONS is the variable Actions always sets, and it is the gate on the
# cloud-only mutations: the brief step there writes a synthetic machine into
# ~/.workkit, which on a laptop is the real roster every other part of the kit
# reads. A stray local run under that branch would leave phantom repos on the
# tower and in the next published slug list.
CLOUD=0
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then CLOUD=1; fi

# The summaries read the day's session transcripts and the roster's git log. A
# machine with neither has no day to write up — and a runner is such a machine,
# which is why this question is asked rather than a mode being passed in.
have_history() {
  [[ -d "${WORKKIT_CLAUDE_PROJECTS:-$HOME/.claude/projects}" ]] || return 1
  command -v git >/dev/null 2>&1
}

# The site is built from the home clone by the engine's own publish, which makes
# every other check itself (no clone, no build tooling, nothing changed). So the
# question here is only whether there is a publish to run at all: the seeded
# cloud runner carries the brief's closure and no engine publish.sh.
have_publish() { [[ -f "$ENGINE/publish.sh" ]]; }

# ── The arguments ─────────────────────────────────────────────────────────────

MANUAL=0
if [[ "${1:-}" == "--now" ]]; then
  MANUAL=1
  shift
fi

# ── The environment each side needs ───────────────────────────────────────────

SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT
# brief-payload.js writes the upstream-version line here and the published body
# is assembled here. Nothing in it outlives the run — the cursor is the
# Discussion, not a file.
MARK_FILE="$SCRATCH_DIR/cc-version"
export WORKKIT_BRIEF_MARK_FILE="$MARK_FILE"
PAYLOAD_ERR_FILE="$SCRATCH_DIR/payload-err"
SEND_ERR_FILE="$SCRATCH_DIR/send-err"

if (( CLOUD )); then
  WK_DIR="$HOME/.workkit"
  # The bash side of the engine and cc-news.js both honor this override; the
  # Node composers resolve ~/.workkit through os.homedir() and honor none.
  # Pinning it to the folder they resolve is what keeps the two halves of the
  # run reading one home.
  export WORKFLOW_HOME="$WK_DIR"
  # The log is the Actions log. One line per thing that happened, on stdout.
  note() { printf '%s\n' "$1"; }
else
  export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:$PATH"
  export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

  # Run from an empty scratch dir. Under launchd the default cwd is / and the job
  # is its own TCC identity (no inherited Terminal grants) — Claude Code's startup
  # scan from / trips macOS privacy prompts (Media Library, Documents, …).
  # An empty cwd gives it nothing to scan.
  WORK_DIR="$HOME/Library/Caches/claude-daily"
  mkdir -p "$WORK_DIR"
  cd "$WORK_DIR"

  LOG_FILE="$HOME/Library/Logs/claude-daily.log"
  # The log directory is this step's own to ensure: a home without ~/Library/Logs
  # would fail the append under `set -e`, and the log is the whole record of what
  # this run did.
  mkdir -p "$(dirname "$LOG_FILE")"
  TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"
  LOG_STAMP="$TIMESTAMP"
  # The manual stamp, so a reader walking the file back can tell a rehearsal at
  # noon from the nine o'clock run.
  if (( MANUAL )); then LOG_STAMP="$TIMESTAMP (manual)"; fi

  # One timestamped block, the same shape every other line in this file takes.
  note() {
    printf '── %s ──\n%s\n\n' "$LOG_STAMP" "$1" >> "$LOG_FILE"
  }

  # Desktop notification — backgrounded + fully detached from stdio: Notifly
  # doesn't return until the notification dismisses; never make the job wait.
  # NOTIFLY is a seam, not a knob: the suite points it at a recorder so running
  # the tests never puts a notification on your screen.
  NOTIFLY="${NOTIFLY:-/Applications/Notifly.app/Contents/MacOS/Notifly}"
  notify() {
    unset ELECTRON_RUN_AS_NODE
    "$NOTIFLY" \
      --title 'Claude Daily' \
      --message "${1:0:180}" \
      --appIcon "$HOME/.claude/icon.png" \
      --timeout 10 \
      --sound 'default' </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || true
  }

  # A HANG is a failure with no exit status, so the two steps that shell out to
  # another script are bounded: 15 minutes, after which timeout's 124 flows down
  # the log-and-continue path like any other failure. `timeout` is homebrew
  # coreutils on macOS and may be absent, so an empty array is the no-bound case
  # — expanded the bash 3.2 way, since a bare "${TIMEOUT[@]}" is an unbound
  # variable there under `set -u`.
  # The `if` is load-bearing too: under `set -e` a bare `command -v … && …` whose
  # left side fails IS the statement's status, and the job would exit right here
  # on a machine without it.
  TIMEOUT=()
  if command -v timeout >/dev/null; then
    TIMEOUT=(timeout 900)
  fi
fi

# ── 1. The summaries ──────────────────────────────────────────────────────────

# Yesterday is written up before the brief is composed, so the morning reads a
# record that already includes the day behind it. claude-nightly.sh stays the one
# home of that logic — its own guards (a day already written up is skipped, a
# quiet day sends nothing) and its own log; calling it is all the wiring there is.
#
# A summaries failure is NOT the brief's failure. It is logged here and the
# morning carries on — the job exists to make sure nine o'clock says something.
summaries() {
  if (( CLOUD )); then
    note 'summaries: a GitHub Actions runner has no session transcripts and no git history to write up — skipped'
    return 0
  fi
  if ! have_history; then
    note 'summaries: this machine has no session transcripts to read — skipped'
    return 0
  fi

  local status=0 output
  output="$(${TIMEOUT[@]+"${TIMEOUT[@]}"} bash "$SCRIPT_DIR/claude-nightly.sh" 2>&1)" || status=$?
  if (( status != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[summaries exit %d — the brief continues]\n' "$status"
      printf '%s\n\n' "$output"
    } >> "$LOG_FILE"
  fi
  return 0
}

# The scheduled morning and the rehearsal write the day up; the generic headless
# runner is a prompt, not a morning.
if (( $# == 0 )); then
  summaries
fi

# ── 2. The brief ──────────────────────────────────────────────────────────────

# The payload, composed the same way in both environments: brief-payload.js
# builds the tower's /api/brief without the tower. Its stderr is kept OUT of the
# message — it carries the crash on a failure, and on a good run the one line
# naming repos the sweep could not read, a token whose reach is short. Either
# belongs in the log, neither in what Claude is handed.
compose() {
  node "$SCRIPT_DIR/brief-payload.js" 2>"$PAYLOAD_ERR_FILE"
}

# The send, and the one place its rails are written. stderr goes to a FILE: the
# Actions log must never carry the digest, and locally the log block carries the
# error text beside the response rather than inside it.
send() {
  claude -p "$1" \
    --model haiku \
    --effort low \
    --safe-mode \
    --no-session-persistence \
    --tools "" \
    --max-budget-usd 0.25 2>"$SEND_ERR_FILE"
}

# The cloud's first job is the machine it has to pretend to be: a runner has no
# settings file and no roster, and both are read by the composers from ~/.workkit.
cloud_machine() {
  local settings="$WK_DIR/settings.json" roster="$WK_DIR/.repos.json"
  local home_slug slugs site_repos='' home_branch='main' entries='' slug dir

  # GITHUB_REPOSITORY IS the home (issue #91): the workflow lives on the home
  # repo and nowhere else, so the run already knows which repo it is standing in.
  # An existing settings file WINS — a runner handed a configured home does not
  # get it rewritten. With neither there is no board to read and nowhere to
  # publish, which is the one thing this refuses over rather than working around.
  if [[ ! -f "$settings" ]]; then
    if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
      printf 'morning: GITHUB_REPOSITORY is unset and %s does not exist — there is no home repo to sweep or publish to.\n' \
        "$settings" >&2
      exit 1
    fi
    mkdir -p "$WK_DIR"
    printf '{\n  "version": 1,\n  "site": {\n    "repo": "%s"\n  }\n}\n' "$GITHUB_REPOSITORY" >"$settings"
    note "settings: wrote $settings for $GITHUB_REPOSITORY"
  fi

  # jq is asked FIRST, on its own. It reads the home slug on the next line and
  # writes the roster later, and an absent one would empty that read — making a
  # missing tool look exactly like a settings file that names no home repo.
  if ! command -v jq >/dev/null 2>&1; then
    printf 'morning: jq is not installed — the settings file cannot be read and the roster cannot be written.\n' >&2
    exit 1
  fi

  home_slug="$(jq -r '.site.repo // empty' "$settings" 2>/dev/null || true)"
  if [[ -z "$home_slug" ]]; then
    printf 'morning: %s names no home repo (.site.repo) — there is no board to sweep or publish to.\n' \
      "$settings" >&2
    exit 1
  fi

  # Which repos this brief covers. The roster is a machine's own knowledge and a
  # runner has none, so it is read from the one place the machine already wrote
  # it: `data/repos.json` on the home repo's DEFAULT branch, the slug list the
  # published dashboard sweeps (workflow/site-repos.js writes it). It is on the
  # default branch rather than beside the pages because gh-pages is public even
  # from a private repo and the list names private repos (issue #110) — which
  # changes nothing here, since this read was always authenticated. The contents
  # API answers with a base64 body.
  #
  # WHICH branch is ASKED FOR, never assumed (issue #112): the writer pushes
  # whatever branch the home clone is on, and a runner hardcoding `main` reads a
  # 404 on a repo whose default branch is not — a silently home-only board. The
  # laptop's other reader is told the branch by the published pointer; a runner
  # has no site to read that from, so it asks GitHub for the repo it is standing
  # in. `main` is the fallback, because that is what the engine creates.
  if command -v gh >/dev/null 2>&1; then
    home_branch="$(gh api "repos/$home_slug" -q '.default_branch' 2>/dev/null || true)"
    [[ -n "$home_branch" ]] || home_branch='main'
    site_repos="$(gh api "repos/$home_slug/contents/data/repos.json?ref=$home_branch" -q '.content' 2>/dev/null || true)"
    site_repos="$(printf '%s' "$site_repos" | tr -d '\n' | base64 -d 2>/dev/null || true)"
  fi
  slugs="$(printf '%s' "$site_repos" | jq -r '.repos[]? // empty' 2>/dev/null || true)"
  if [[ -z "$slugs" ]]; then
    # No published list — the site has never been published, or the read failed.
    # The home repo ALONE is the fallback rather than an empty roster: its issues
    # are the cross-project queue, so a brief built from it is a real morning,
    # while an empty board would read as "nothing is waiting on you" — the one
    # thing a brief must never say when it simply did not look.
    note "roster: no slug list on $home_slug ($home_branch data/repos.json) — sweeping the home repo alone"
    slugs="$home_slug"
  fi
  # The home repo is on the published list already; this covers the list that
  # somehow lost it, since it is where the brief is published either way.
  printf '%s\n' "$slugs" | grep -qxF "$home_slug" || slugs="$slugs"$'\n'"$home_slug"

  # A synthetic checkout per slug, because that is what the roster is a list OF:
  # `discoverRepos` reads a path, checks the committed opt-in there and asks git
  # for the origin. Both are given honestly and nothing else is faked — there is
  # no working tree, so health reads zeroes and the brief carries no warnings
  # from a runner. The board, which needs only the slug, is unaffected.
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
    entries="$entries$dir"$'\n'
  done <<<"$slugs"

  printf '%s' "$entries" | jq -R -s '
    split("\n") | map(select(length > 0))
    | { version: 1, repos: (map({ (.): "enabled" }) | add // {}) }' >"$roster"
  note "roster: $(printf '%s' "$entries" | grep -c . || true) repos in $roster"
}

# The brief on a runner: compose, send, post — and every failure is a red run,
# because the Actions log is the delivery and a silent one is a morning nobody
# hears about at all.
cloud_brief() {
  local message response status=0 publish_status=0 publish_line payload_status=0 payload_err

  cloud_machine

  message="$(compose)" || payload_status=$?
  payload_err="$(cat "$PAYLOAD_ERR_FILE" 2>/dev/null || true)"
  if (( payload_status != 0 )); then
    printf 'morning: brief-payload exit %d\n%s\n' "$payload_status" "$payload_err" >&2
    exit "$payload_status"
  fi
  if [[ -n "$payload_err" ]]; then note "$payload_err"; fi

  response="$(send "$message")" || status=$?
  if (( status != 0 )); then
    # The status and what the CLI said about it — never the payload it was
    # handed, and never whatever half a digest it managed before it stopped.
    printf 'morning: the digest send exit %d\n%s\n' "$status" "$(cat "$SEND_ERR_FILE" 2>/dev/null || true)" >&2
    exit "$status"
  fi

  # The DIGEST NEVER REACHES THIS LOG. It summarizes issues across private repos,
  # and an Actions log belongs to the repo it ran in — one that could be made
  # public. The Discussion is the delivery; the log needs only proof of life.
  note "digest: $(printf '%s' "$response" | head -1) (${#response} bytes)"

  # The one call that speaks to THIS repo, and the one that uses the workflow's
  # built-in token: the Discussion is posted where the run lives, so the
  # cross-repo secret has no business in it. The export is inside the capture's
  # subshell, so the sweep's token is untouched for anything after this.
  publish_line="$(
    # An empty value is left alone rather than exported: `gh` reads an empty
    # GH_TOKEN as a token, not as an absent one, and a run given only the
    # cross-repo secret must keep it.
    if [[ -n "${WORKKIT_POST_TOKEN:-}" ]]; then export GH_TOKEN="$WORKKIT_POST_TOKEN"; fi
    wk_brief_publish "$ENGINE" "$response" "$MARK_FILE" "$SCRATCH_DIR/brief.md"
  )" || publish_status=$?
  if [[ -n "$publish_line" ]]; then note "$publish_line"; fi
  # 2 is nothing to post — today's brief is already on the board, or this runner
  # has nowhere to publish; both are ordinary mornings. 1 is a post that was
  # attempted and did not land, and that is the red run.
  if (( publish_status == 1 )); then
    exit 1
  fi
}

# The scheduled brief on this machine is the DISPATCH and nothing more (issue
# #107): a `workflow_dispatch` on the HOME repo's brief.yml, which runs this same
# script on a runner with the credentials the compose and the sweep need.
#
# The home repo, not this checkout's (issue #91): the workflow and its secrets
# live on `<login>/workkit`, because the plugin repo is distributed and a
# consumer cannot set secrets on a repo they do not own. `workkit setup` seeds
# the workflow there and writes the secrets there, so one slug answers both.
#
# Every reason it cannot be made is a NAMED line in the log and a briefless
# morning — nothing is composed here to cover for it, so the log is the only
# place that says why nine o'clock was quiet.
DISPATCH_REASON=''
DISPATCH_LINE=''
dispatch_brief() {
  local slug secrets
  if [[ ! -f "$ENGINE/lib.sh" || ! -f "$ENGINE/home.sh" ]]; then
    DISPATCH_REASON="the engine's home-repo library is missing at $ENGINE"
    return 1
  fi
  if ! command -v gh >/dev/null 2>&1; then
    DISPATCH_REASON='gh is not on this machine'
    return 1
  fi
  # In a subshell: this is one read of a helper, and sourcing the engine into
  # the job's own shell for it would leak its every function and address.
  slug="$(. "$ENGINE/lib.sh"; . "$ENGINE/home.sh"; wk_home_slug)" || slug=''
  if [[ -z "$slug" ]]; then
    DISPATCH_REASON='no home repo is configured — `workkit setup` creates it'
    return 1
  fi
  # The workflow existing is not the workflow WORKING: `gh workflow run` succeeds
  # the moment the file is on the default branch, and a runner missing either
  # credential composes nothing worth having — no OAuth token and it composes
  # nothing at all, no `WORKKIT_GITHUB_TOKEN` and it sweeps no board. So BOTH
  # secrets are checked on the same repo first, in one listing.
  # A FAILED listing and an EMPTY one are different mornings: the first is a
  # repo this token cannot read, the second a repo that truly has no secrets —
  # and this line's whole job is saying honestly why nine o'clock was quiet.
  if ! secrets="$(gh secret list --repo "$slug" 2>/dev/null)"; then
    DISPATCH_REASON="the secrets on $slug could not be listed"
    return 1
  fi
  if [[ -z "$secrets" ]]; then
    DISPATCH_REASON="$slug carries no secrets — \`workkit setup\` wires both"
    return 1
  fi
  if ! grep -qE '^CLAUDE_CODE_OAUTH_TOKEN([[:space:]]|$)' <<<"$secrets"; then
    DISPATCH_REASON="$slug does not carry CLAUDE_CODE_OAUTH_TOKEN — a runner without it composes nothing"
    return 1
  fi
  if ! grep -qE '^WORKKIT_GITHUB_TOKEN([[:space:]]|$)' <<<"$secrets"; then
    DISPATCH_REASON="$slug does not carry WORKKIT_GITHUB_TOKEN — a runner without it sweeps no board"
    return 1
  fi
  if ! gh workflow run "$BRIEF_WORKFLOW" --repo "$slug" >/dev/null 2>&1; then
    DISPATCH_REASON="gh workflow run $BRIEF_WORKFLOW on $slug did not land"
    return 1
  fi
  DISPATCH_LINE="brief: dispatched $BRIEF_WORKFLOW on $slug — the cloud runner composes and publishes today's brief"
  return 0
}

# The brief composed and sent HERE, which on this machine is the rehearsal
# (`--now`) and the generic headless runner (`morning.sh <message>`) — never the
# scheduled morning, which hands the day over instead. It publishes nothing: a
# rehearsal must not claim the day's title, and a prompt is not a digest.
STATUS=0
local_send() {
  local payload_status=0 payload_err message notif

  if (( $# > 0 )); then
    message="$*"
  else
    # Guarded like the send below: a payload-builder crash must still log and
    # notify — a silent morning is the one failure mode this job exists to
    # prevent.
    message="$(compose)" || payload_status=$?
    payload_err="$(cat "$PAYLOAD_ERR_FILE" 2>/dev/null || true)"
    if (( payload_status != 0 )); then
      {
        printf '── %s ──\n' "$LOG_STAMP"
        printf '[brief-payload exit %d]\n' "$payload_status"
        printf '%s\n\n' "$payload_err"
      } >> "$LOG_FILE"
      notify "❌ brief-payload exit $payload_status — $payload_err"
      exit "$payload_status"
    fi
    if [[ -n "$payload_err" ]]; then note "$payload_err"; fi
  fi

  local response send_err
  response="$(send "$message")" || STATUS=$?
  send_err="$(cat "$SEND_ERR_FILE" 2>/dev/null || true)"

  {
    printf '── %s ──\n' "$LOG_STAMP"
    printf '> %s\n' "${message:0:200}"
    if (( STATUS != 0 )); then
      printf '[exit %d]\n' "$STATUS"
      if [[ -n "$send_err" ]]; then printf '%s\n' "$send_err"; fi
    fi
    printf '%s\n\n' "$response"
  } >> "$LOG_FILE"

  # The morning brief leads with its HEADLINE line — that's the notification.
  notif="$(printf '%s' "$response" | head -1)"
  (( STATUS != 0 )) && notif="❌ exit $STATUS — ${send_err:-$response}"
  notify "$notif"

  printf '%s\n' "$response"
}

BRIEF_SENT_HERE=0
if (( CLOUD )); then
  # Sourced only where it is used: this is the one home of "post today's digest
  # as a Discussion", and on this machine nothing posts one any more.
  # shellcheck source=./brief-publish.sh
  . "$SCRIPT_DIR/brief-publish.sh"
  cloud_brief
elif (( $# == 0 )) && (( MANUAL == 0 )); then
  if dispatch_brief; then
    note "$DISPATCH_LINE"
    printf '%s\n' "$DISPATCH_LINE"
  else
    BRIEFLESS="brief: the day could not be handed to the cloud ($DISPATCH_REASON) — no brief this morning"
    note "$BRIEFLESS"
    printf '%s\n' "$BRIEFLESS" >&2
  fi
else
  BRIEF_SENT_HERE=1
  local_send "$@"
fi

# ── 3. The publish ────────────────────────────────────────────────────────────

# The published dashboard: the tower project in ~/.workkit/tower, rebuilt and
# pushed to the home repo's gh-pages branch. It runs LAST and only for the
# morning, for the same reason the summaries run first and are allowed to fail:
# the job exists to make sure nine o'clock says something, and a build is the
# slowest thing here. Its every reason not to publish — `site.publish` off (the
# default), no home repo, no build tooling, a diverged clone, nothing changed —
# is a skip it logs and exits 0 on, so only a real failure appears in this block.
#
# It runs whether or not the day was handed over: the site is this machine's to
# build either way.
publish_site() {
  if (( CLOUD )); then
    note 'publish: the site is built from the home clone on a machine — a runner has neither, skipped'
    return 0
  fi
  have_publish || return 0
  local status=0 output
  output="$(${TIMEOUT[@]+"${TIMEOUT[@]}"} bash "$ENGINE/publish.sh" --quiet 2>&1)" || status=$?
  if (( status != 0 )); then
    {
      printf '── %s ──\n' "$LOG_STAMP"
      printf '[publish exit %d — the brief was already sent]\n' "$status"
      printf '%s\n\n' "$output"
    } >> "$LOG_FILE"
  elif [[ -n "$output" ]]; then
    printf '── %s ──\n%s\n\n' "$LOG_STAMP" "$output" >> "$LOG_FILE"
  fi
  return 0
}

# The scheduled morning and the rehearsal publish the site; the generic headless
# runner is a prompt, and a prompt builds nothing.
if (( $# == 0 )); then
  publish_site
fi

# The send's status is the run's status — on this machine, where a send happened
# at all. Everything else here has already reported itself and exits 0.
if (( BRIEF_SENT_HERE )); then
  exit "$STATUS"
fi
exit 0
