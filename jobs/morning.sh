#!/usr/bin/env bash
# jobs/morning.sh: the morning in one script, run by the 9am LaunchAgent and by
# the brief.yml workflow on the home repo. Five steps, each gated on what the
# environment it woke up in can do: jobs/README.md tells which runs where.
#
# Usage: morning.sh [--now | message]. None is the scheduled morning; --now is
# the rehearsal, sent here and publishing nothing; a message is the generic
# headless runner. Log: ~/Library/Logs/claude-daily.log, or the Actions log.

set -euo pipefail

# Resolve before any cd: BASH_SOURCE may be a relative path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE="$SCRIPT_DIR/../workflow"

# The engine's voice. lib.sh is seeded onto the runner beside this file, and the
# plain fallback covers a checkout without it: a missing logger would end the
# morning under `set -e`.
if [[ -f "$ENGINE/lib.sh" ]]; then
  # shellcheck source=../workflow/lib.sh
  . "$ENGINE/lib.sh"
fi
if ! declare -f wk_ok >/dev/null 2>&1; then
  wk_ok()    { printf '%s\n' "$1"; }
  wk_skip()  { printf '%s\n' "$1"; }
  wk_info()  { printf '%s\n' "$1"; }
  wk_warn()  { printf '%s\n' "$1" >&2; }
  wk_error() { printf '%s\n' "$1" >&2; }
  wk_spin()  { shift; "$@"; }
fi

# ── Where this run woke up ────────────────────────────────────────────────────

# The gate on the cloud-only writes into ~/.workkit, which on a machine is the
# real roster (jobs/README.md § The brief runs in the cloud).
CLOUD=0
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then CLOUD=1; fi

# The summaries read the day's session transcripts and the roster's git log. A
# machine with neither has no day to write up, and a runner is such a machine,
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
# is assembled here. Nothing in it outlives the run: the cursor is the
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
  # The log is the Actions log: one line per thing that happened, under its glyph.
  note()      { wk_ok "$1"; }
  note_skip() { wk_skip "$1"; }
  note_warn() { wk_warn "$1"; }
else
  export PATH="$HOME/.local/bin:$HOME/.nvm/default-bin:/opt/homebrew/bin:$PATH"
  export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

  # Run from an empty scratch dir. Under launchd the default cwd is / and the job
  # is its own TCC identity (no inherited Terminal grants): Claude Code's startup
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

  # One block per note: the stamp (no line here carries a clock of its own), then
  # the note under its glyph, both streams redirected: a warning is stderr's
  # everywhere in the kit, and this file is the whole record of the run.
  note_as() {
    { printf '%s\n' "--- $LOG_STAMP ---"; "$1" "$2"; printf '\n'; } >> "$LOG_FILE" 2>&1
  }
  note()      { note_as wk_ok "$1"; }
  note_skip() { note_as wk_skip "$1"; }
  note_warn() { note_as wk_warn "$1"; }

  # Desktop notification, backgrounded + fully detached from stdio: Notifly
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

  # A hang is a failure with no exit status: 15 minutes, then 124 takes the
  # log-and-continue path. `timeout` may be absent, so an empty array is no bound
  # (expanded the bash 3.2 way at each use), and the `if` keeps a missing one from
  # ending the job under `set -e`.
  TIMEOUT=()
  if command -v timeout >/dev/null; then
    TIMEOUT=(timeout 900)
  fi
fi

# ── 1. The summaries ──────────────────────────────────────────────────────────

# A summaries failure is never the brief's: it is logged here and the morning
# carries on (jobs/README.md § The morning on this machine).
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

# The scheduled morning and the rehearsal write the day up; the generic headless
# runner is a prompt, not a morning.
if (( $# == 0 )); then
  summaries
fi

# ── 2. The runner ─────────────────────────────────────────────────────────────

# Runs before the dispatch, whose cloud run consumes what it pushes, and creates,
# clones or enables nothing (jobs/README.md § The morning on this machine).
reconcile_runner() {
  if (( CLOUD )); then
    note_skip 'runner: a runner IS the seeded copy of the cloud brief; there is no checkout here to reconcile it from, skipped'
    return 0
  fi
  if [[ ! -f "$ENGINE/lib.sh" || ! -f "$ENGINE/home.sh" ]]; then
    note_warn "runner: the engine libraries are missing at $ENGINE; the cloud brief's runner was not reconciled (a partial checkout)"
    return 0
  fi

  local output status=0
  # A subshell, so the libraries' names die with this step and all it says lands
  # in the log block. Inside it, for the bash 3.2 re-parse: apostrophes stay paired
  # per line, comments included, and case patterns wear both parens, `(x)`.
  output="$(
    # Warnings go to stderr, and this capture is the log: fold the two together
    # so a refusal is recorded rather than scattered across the output.
    exec 2>&1
    # shellcheck source=../workflow/lib.sh
    . "$ENGINE/lib.sh"
    # shellcheck source=../workflow/home.sh
    . "$ENGINE/home.sh"
    if ! wk_home_ready; then
      case "$(wk_home_state)" in
        (unset)  wk_skip "runner: no home repo; \`workkit setup\` creates one; nothing to reconcile" ;;
        (absent) wk_skip "runner: nothing is cloned at $WK_HOME_DIR yet; the cloud brief runner was not reconciled; \`workkit setup\` clones it" ;;
        (other)  wk_warn "runner: $WK_HOME_DIR is not the home repo's clone; nothing is reconciled in somebody else's folder" ;;
      esac
      exit 0
    fi
    # The seed judges from the working copy, so the clone is caught up first;
    # --autostash because a hand-taken upstream change would read as a divergence.
    # A pull that cannot finish is aborted and the seed skipped, clone untouched.
    if ! wk_spin "catching the clone up with origin" git -C "$WK_HOME_DIR" pull --rebase --autostash --quiet 2>/dev/null; then
      git -C "$WK_HOME_DIR" rebase --abort >/dev/null 2>&1 || true
      wk_warn "runner: the clone could not be brought up to date; the runner was not refreshed"
      exit 0
    fi
    rc=0
    wk_home_seed_runner || rc=$?
    # 0 is a copy that moved, the only answer worth a commit. 2 is a runner
    # already current, which is every ordinary morning; 1 has already warned and
    # left the clone exactly as it was.
    [[ "$rc" -eq 0 ]] || exit 0
    wk_home_commit_push 'chore(home): refresh the cloud brief runner' || true
  )" || status=$?

  # note() adds its own glyph: strip the inner one so no line wears two, and let
  # the glyph it arrived with pick the relay, so a seed that warned and exited 0
  # is never relayed as an action taken. Alternation, not a bracket class: see
  # wk_plain in workflow/lib/voice.sh.
  local relay='note'
  printf '%s\n' "$output" | grep -qE '^ *(⚠|✖) ' && relay='note_warn'
  output="$(printf '%s\n' "$output" | wk_plain)"
  if (( status != 0 )); then
    note_warn "$(printf 'runner: the reconcile exited %d; the morning continues\n%s' "$status" "$output")"
  elif [[ -n "$output" ]]; then
    "$relay" "$output"
  fi
  return 0
}

# The scheduled morning and the rehearsal reconcile it; the generic headless
# runner is a prompt, and a prompt seeds nothing.
if (( $# == 0 )); then
  reconcile_runner
fi

# ── 3. The brief ──────────────────────────────────────────────────────────────

# The payload, composed the same way in both environments. Its stderr stays out
# of the message: a crash, or the line naming repos the sweep could not read,
# belongs in the log and never in what Claude is handed.
compose() {
  node "$SCRIPT_DIR/morning/brief/brief-payload.js" 2>"$PAYLOAD_ERR_FILE"
}

# The send, and the one place its rails are written. stderr goes to a file: the
# Actions log must never carry the digest, and locally the log block carries the
# error text beside the response rather than inside it.
send() {
  wk_spin 'asking Claude for the brief' claude -p "$1" \
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

  # The seeded engine is a requirement here: the roster is written through its
  # predicates, and without them every directory reads as no repo at all. A red
  # run is how a runner missing it is heard.
  if ! declare -f wk_is_repo_root >/dev/null 2>&1; then
    wk_error "the engine seeded beside this job is missing at $ENGINE, so the roster this brief sweeps cannot be built"
    exit 1
  fi

  # GITHUB_REPOSITORY is the home: the workflow lives on the home repo alone. An
  # existing settings file wins; with neither there is nothing to sweep or post.
  if [[ ! -f "$settings" ]]; then
    if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
      wk_error "GITHUB_REPOSITORY is unset and $settings does not exist, so there is no home repo to sweep or publish to"
      exit 1
    fi
    mkdir -p "$WK_DIR"
    printf '{\n  "version": 1,\n  "site": {\n    "repo": "%s"\n  }\n}\n' "$GITHUB_REPOSITORY" >"$settings"
    note "settings: wrote $settings for $GITHUB_REPOSITORY"
  fi

  # jq is asked first, on its own. It reads the home slug on the next line and
  # writes the roster later, and an absent one would empty that read, making a
  # missing tool look exactly like a settings file that names no home repo.
  if ! command -v jq >/dev/null 2>&1; then
    wk_error "jq is not installed, so the settings file cannot be read and the roster cannot be written"
    exit 1
  fi

  home_slug="$(wk_jq -r '.site.repo // empty' "$settings" 2>/dev/null || true)"
  if [[ -z "$home_slug" ]]; then
    wk_error "$settings names no home repo (.site.repo), so there is no board to sweep or publish to"
    exit 1
  fi

  # The slug list the published dashboard sweeps, `data/repos.json` on the home
  # repo's default branch, which is asked for: a hardcoded `main` is a 404 and a
  # silently home-only board (jobs/README.md § The brief runs in the cloud). The
  # contents API answers with a base64 body.
  if command -v gh >/dev/null 2>&1; then
    home_branch="$(wk_spin "reading $home_slug" gh api "repos/$home_slug" -q '.default_branch' 2>/dev/null || true)"
    [[ -n "$home_branch" ]] || home_branch='main'
    site_repos="$(wk_spin 'reading the slug list' gh api "repos/$home_slug/contents/data/repos.json?ref=$home_branch" -q '.content' 2>/dev/null || true)"
    site_repos="$(printf '%s' "$site_repos" | tr -d '\n' | base64 -d 2>/dev/null || true)"
  fi
  slugs="$(printf '%s' "$site_repos" | wk_jq -r '.repos[]? // empty' 2>/dev/null || true)"
  if [[ -z "$slugs" ]]; then
    # The home repo alone rather than an empty roster: its issues are the
    # cross-project queue, and an empty board would say "nothing is waiting on
    # you" about a board nobody looked at.
    note "roster: no slug list on $home_slug ($home_branch data/repos.json); sweeping the home repo alone"
    slugs="$home_slug"
  fi
  # The home repo is on the published list already; this covers the list that
  # somehow lost it, since it is where the brief is published either way.
  printf '%s\n' "$slugs" | grep -qxF "$home_slug" || slugs="$slugs"$'\n'"$home_slug"

  # A synthetic checkout per slug, the minimum `discoverRepos` reads: the
  # committed opt-in and an origin. Nothing else is faked, so health reads zeroes.
  while IFS= read -r slug; do
    [[ "$slug" == */* ]] || continue
    dir="$WK_DIR/cloud/$slug"
    mkdir -p "$dir/.workkit"
    printf '{\n  "version": 1,\n  "enabled": true\n}\n' >"$dir/.workkit/settings.json"
    if ! wk_is_repo_root "$dir"; then
      git init -q "$dir" >/dev/null 2>&1 || continue
    fi
    git -C "$dir" remote remove origin >/dev/null 2>&1 || true
    git -C "$dir" remote add origin "https://github.com/$slug.git" >/dev/null 2>&1 || true
    entries="$entries$dir"$'\n'
  done <<<"$slugs"

  printf '%s' "$entries" | wk_jq -R -s '
    split("\n") | map(select(length > 0))
    | { version: 1, repos: (map({ (.): "enabled" }) | add // {}) }' >"$roster"
  note "roster: $(printf '%s' "$entries" | grep -c . || true) repos in $roster"
}

# The brief on a runner: compose, send, post. And every failure is a red run,
# because the Actions log is the delivery and a silent one is a morning nobody
# hears about at all.
cloud_brief() {
  local message response status=0 publish_status=0 publish_line payload_status=0 payload_err

  cloud_machine

  message="$(compose)" || payload_status=$?
  payload_err="$(cat "$PAYLOAD_ERR_FILE" 2>/dev/null || true)"
  if (( payload_status != 0 )); then
    wk_error "brief-payload exit $payload_status: $payload_err"
    exit "$payload_status"
  fi
  if [[ -n "$payload_err" ]]; then note_warn "$payload_err"; fi

  response="$(send "$message")" || status=$?
  if (( status != 0 )); then
    # The status and what the CLI said about it, never the payload it was
    # handed, and never whatever half a digest it managed before it stopped.
    wk_error "the digest send exit $status: $(cat "$SEND_ERR_FILE" 2>/dev/null || true)"
    exit "$status"
  fi

  # The digest never reaches this log: it summarizes private repos, and an
  # Actions log could be made public. The log needs only proof of life.
  note "digest: $(printf '%s' "$response" | head -1) (${#response} bytes)"

  # The one call that speaks to this repo, with the workflow's built-in token;
  # the export stays inside the capture's subshell, so the sweep's token is
  # untouched after it.
  publish_line="$(
    # An empty value is left alone: gh reads an empty GH_TOKEN as a token, and a
    # run given only the cross-repo secret must keep it.
    if [[ -n "${WORKKIT_POST_TOKEN:-}" ]]; then export GH_TOKEN="$WORKKIT_POST_TOKEN"; fi
    wk_brief_publish "$ENGINE" "$response" "$MARK_FILE" "$SCRATCH_DIR/brief.md"
  )" || publish_status=$?
  # The line is the publisher's own words; its status picks the glyph: 0 posted,
  # 2 nothing to post, 1 a post that did not land.
  if [[ -n "$publish_line" ]]; then
    case "$publish_status" in
      (1) note_warn "$publish_line" ;;
      (2) note_skip "$publish_line" ;;
      (*) note "$publish_line" ;;
    esac
  fi
  # 2 is nothing to post: today's brief is already on the board, or this runner
  # has nowhere to publish; both are ordinary mornings. 1 is a post that was
  # attempted and did not land, and that is the red run.
  if (( publish_status == 1 )); then
    exit 1
  fi
}

# The brief composed and sent here, which on this machine is the rehearsal
# (`--now`) and the generic headless runner (`morning.sh <message>`), never the
# scheduled morning, which hands the day over instead. It publishes nothing: a
# rehearsal must not claim the day's title, and a prompt is not a digest.
STATUS=0
local_send() {
  local payload_status=0 payload_err message notif

  if (( $# > 0 )); then
    message="$*"
  else
    # Guarded like the send below: a payload-builder crash must still log and
    # notify: a silent morning is the one failure mode this job exists to
    # prevent.
    message="$(compose)" || payload_status=$?
    payload_err="$(cat "$PAYLOAD_ERR_FILE" 2>/dev/null || true)"
    if (( payload_status != 0 )); then
      {
        printf '%s\n' "--- $LOG_STAMP ---"
        printf '[brief-payload exit %d]\n' "$payload_status"
        printf '%s\n\n' "$payload_err"
      } >> "$LOG_FILE"
      notify "❌ brief-payload exit $payload_status; $payload_err"
      exit "$payload_status"
    fi
    if [[ -n "$payload_err" ]]; then note_warn "$payload_err"; fi
  fi

  local response send_err
  response="$(send "$message")" || STATUS=$?
  send_err="$(cat "$SEND_ERR_FILE" 2>/dev/null || true)"

  {
    printf '%s\n' "--- $LOG_STAMP ---"
    printf '> %s\n' "${message:0:200}"
    if (( STATUS != 0 )); then
      printf '[exit %d]\n' "$STATUS"
      if [[ -n "$send_err" ]]; then printf '%s\n' "$send_err"; fi
    fi
    printf '%s\n\n' "$response"
  } >> "$LOG_FILE"

  # The morning brief leads with its HEADLINE line: that's the notification.
  notif="$(printf '%s' "$response" | head -1)"
  (( STATUS != 0 )) && notif="❌ exit $STATUS; ${send_err:-$response}"
  notify "$notif"

  printf '%s\n' "$response"
}

BRIEF_SENT_HERE=0
if (( CLOUD )); then
  # Sourced only where it is used: the one home of posting today's digest, and
  # only the cloud posts one.
  # shellcheck source=./morning/brief-publish.sh
  . "$SCRIPT_DIR/morning/brief-publish.sh"
  cloud_brief
elif (( $# == 0 )) && (( MANUAL == 0 )); then
  # The dispatch is the scheduled morning's alone (`workkit brief` is its other
  # caller). A checkout missing the lib is a refusal, not an abort under set -e:
  # the publish after this must still run.
  # shellcheck source=./brief-dispatch.sh
  if [[ -f "$SCRIPT_DIR/brief-dispatch.sh" ]]; then
    . "$SCRIPT_DIR/brief-dispatch.sh"
  else
    DISPATCH_REASON="$SCRIPT_DIR/brief-dispatch.sh is missing; a partial checkout"
    dispatch_brief() { return 1; }
  fi
  if dispatch_brief; then
    note "$DISPATCH_LINE"
    printf '%s\n' "$DISPATCH_LINE"
  else
    BRIEFLESS="brief: the day could not be handed to the cloud ($DISPATCH_REASON); no brief this morning"
    note_warn "$BRIEFLESS"
    printf '%s\n' "$BRIEFLESS" >&2
  fi
else
  BRIEF_SENT_HERE=1
  local_send "$@"
fi

# ── 4. The publish ────────────────────────────────────────────────────────────

# Runs after the brief, whether or not the day was handed over: the site is this
# machine's to build. Every reason not to publish is the engine's own logged
# skip, so only a real failure lands in this block.
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

# The scheduled morning and the rehearsal publish the site; the generic headless
# runner is a prompt, and a prompt builds nothing.
if (( $# == 0 )); then
  publish_site
fi

# ── 5. The marker ─────────────────────────────────────────────────────────────

# Never a lie: every way this can fail leaves the existing marker as it was and
# names the skip (jobs/README.md § The morning on this machine).
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

  # The title prefix comes from the module that owns it rather than from a
  # second literal in a second language: tower/api/lib/history.js is where the
  # writer and every reader of these posts already agree.
  prefix="$(node -e 'process.stdout.write(require(process.argv[1]).BRIEF_TITLE_PREFIX)' \
    "$SCRIPT_DIR/../tower/api/lib/history.js" 2>/dev/null || true)"
  if [[ -z "$prefix" ]]; then
    note_warn 'marker: the brief title prefix could not be read from tower/api/lib/history.js; the marker was left as it was'
    return 0
  fi

  # One bounded read: a captive portal answers the handshake and never the
  # request. `timeout` may be absent, and a bound that fires reads as a read that
  # did not answer, already a named skip. Expanded the bash 3.2 way: a bare
  # "${BOUND[@]}" is an unbound variable there under `set -u`.
  local BOUND=()
  if command -v timeout >/dev/null 2>&1; then BOUND=(timeout "${WORKKIT_GH_TIMEOUT:-10}"); fi

  # The window is 50 because the board is shared (the daily summaries publish
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
  # Written whole beside the marker and renamed onto it, so the hook never reads
  # half a marker; beside it because a move across filesystems is a copy. The
  # move is guarded on the write, so a truncated temp never replaces a good
  # marker, and a failed one takes the temp with it.
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

# The scheduled morning and the rehearsal record it; the generic headless runner
# is a prompt, and a prompt reads no board.
if (( $# == 0 )); then
  record_brief_status
fi

# The send's status is the run's status, on this machine, where a send happened
# at all. Everything else here has already reported itself and exits 0.
if (( BRIEF_SENT_HERE )); then
  exit "$STATUS"
fi
exit 0
