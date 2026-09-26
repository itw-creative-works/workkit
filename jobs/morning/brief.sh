#!/usr/bin/env bash
# jobs/morning/brief.sh: the morning's third step, the brief: its compose and
# send, the cloud's synthetic machine and its compose-send-post, and the local
# send. SOURCED by morning.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. Every name it reads (CLOUD, SCRIPT_DIR,
# ENGINE, WK_DIR, SCRATCH_DIR, MARK_FILE, PAYLOAD_ERR_FILE, SEND_ERR_FILE,
# LOG_FILE, LOG_STAMP, notify, the note helpers, and STATUS, which local_send
# sets) is the entry's; the wk_* helpers are lib.sh's and wk_brief_publish is
# brief-publish.sh's, both sourced by the entry.

# ── 3. The brief ──────────────────────────────────────────────────────────────

# The payload, composed the same way in both environments: brief-payload.js
# builds the tower's /api/brief without the tower. Its stderr is kept OUT of the
# message: it carries the crash on a failure, and on a good run the one line
# naming repos the sweep could not read, a token whose reach is short. Either
# belongs in the log, neither in what Claude is handed.
compose() {
  node "$SCRIPT_DIR/brief-payload.js" 2>"$PAYLOAD_ERR_FILE"
}

# The send, and the one place its rails are written. stderr goes to a FILE: the
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

  # The engine seeded beside this file (WK_HOME_RUNNER_FILES) is a REQUIREMENT
  # of this branch, not the convenience it is on a machine: the roster below is
  # written through the engine's own predicates, and without them every
  # directory reads as no repo at all, so the brief would sweep a roster built
  # on a question nothing answered. A runner missing it says so and stops, since
  # the Actions log is the delivery here and a red run is how a gap is heard.
  if ! declare -f wk_is_repo_root >/dev/null 2>&1; then
    wk_error "the engine seeded beside this job is missing at $ENGINE, so the roster this brief sweeps cannot be built"
    exit 1
  fi

  # GITHUB_REPOSITORY IS the home (issue #91): the workflow lives on the home
  # repo and nowhere else, so the run already knows which repo it is standing in.
  # An existing settings file WINS: a runner handed a configured home does not
  # get it rewritten. With neither there is no board to read and nowhere to
  # publish, which is the one thing this refuses over rather than working around.
  if [[ ! -f "$settings" ]]; then
    if [[ -z "${GITHUB_REPOSITORY:-}" ]]; then
      wk_error "GITHUB_REPOSITORY is unset and $settings does not exist, so there is no home repo to sweep or publish to"
      exit 1
    fi
    mkdir -p "$WK_DIR"
    printf '{\n  "version": 1,\n  "site": {\n    "repo": "%s"\n  }\n}\n' "$GITHUB_REPOSITORY" >"$settings"
    note "settings: wrote $settings for $GITHUB_REPOSITORY"
  fi

  # jq is asked FIRST, on its own. It reads the home slug on the next line and
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

  # Which repos this brief covers. The roster is a machine's own knowledge and a
  # runner has none, so it is read from the one place the machine already wrote
  # it: `data/repos.json` on the home repo's DEFAULT branch, the slug list the
  # published dashboard sweeps (workflow/site-repos.js writes it). It is on the
  # default branch rather than beside the pages because gh-pages is public even
  # from a private repo and the list names private repos (issue #110), which
  # changes nothing here, since this read was always authenticated. The contents
  # API answers with a base64 body.
  #
  # WHICH branch is ASKED FOR, never assumed (issue #112): the writer pushes
  # whatever branch the home clone is on, and a runner hardcoding `main` reads a
  # 404 on a repo whose default branch is not: a silently home-only board. The
  # laptop's other reader is told the branch by the published pointer; a runner
  # has no site to read that from, so it asks GitHub for the repo it is standing
  # in. `main` is the fallback, because that is what the engine creates.
  if command -v gh >/dev/null 2>&1; then
    home_branch="$(wk_spin "reading $home_slug" gh api "repos/$home_slug" -q '.default_branch' 2>/dev/null || true)"
    [[ -n "$home_branch" ]] || home_branch='main'
    site_repos="$(wk_spin 'reading the slug list' gh api "repos/$home_slug/contents/data/repos.json?ref=$home_branch" -q '.content' 2>/dev/null || true)"
    site_repos="$(printf '%s' "$site_repos" | tr -d '\n' | base64 -d 2>/dev/null || true)"
  fi
  slugs="$(printf '%s' "$site_repos" | wk_jq -r '.repos[]? // empty' 2>/dev/null || true)"
  if [[ -z "$slugs" ]]; then
    # No published list: the site has never been published, or the read failed.
    # The home repo ALONE is the fallback rather than an empty roster: its issues
    # are the cross-project queue, so a brief built from it is a real morning,
    # while an empty board would read as "nothing is waiting on you": the one
    # thing a brief must never say when it simply did not look.
    note "roster: no slug list on $home_slug ($home_branch data/repos.json); sweeping the home repo alone"
    slugs="$home_slug"
  fi
  # The home repo is on the published list already; this covers the list that
  # somehow lost it, since it is where the brief is published either way.
  printf '%s\n' "$slugs" | grep -qxF "$home_slug" || slugs="$slugs"$'\n'"$home_slug"

  # A synthetic checkout per slug, because that is what the roster is a list OF:
  # `discoverRepos` reads a path, checks the committed opt-in there and asks git
  # for the origin. Both are given honestly and nothing else is faked: there is
  # no working tree, so health reads zeroes and the brief carries no warnings
  # from a runner. The board, which needs only the slug, is unaffected.
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

  # The DIGEST NEVER REACHES THIS LOG. It summarizes issues across private repos,
  # and an Actions log belongs to the repo it ran in, one that could be made
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
  # The publish line is the publisher's own words, and its STATUS is what says
  # which outcome they report: 0 posted, 2 nothing to post, 1 a post that did
  # not land. Reading the status is what keeps the glyph honest here.
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

# The brief composed and sent HERE, which on this machine is the rehearsal
# (`--now`) and the generic headless runner (`morning.sh <message>`), never the
# scheduled morning, which hands the day over instead. It publishes nothing: a
# rehearsal must not claim the day's title, and a prompt is not a digest.
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
