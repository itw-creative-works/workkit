#!/usr/bin/env bash
# workflow/home.sh — the home repo's lifecycle. SOURCED, never executed.
#
# `~/.workkit` starts as a folder one machine writes to. Issue #27 makes it a
# CLONE of a private repo — `<login>/workkit` — so the things that belong to no
# single project have a home: the opted-in project slugs, the published
# dashboard, the summaries' destination, the preferences.
#
# Two layers in one folder, and the .gitignore is the boundary:
#   committed      workkit.json (the shared truth) · docs/ (the built site)
#   machine-local  settings.json (paths, declines, roster, home slug, id cache)
#                  and inbox.md — one machine's own knowledge, never travelling
#
# WHO CREATES WHAT. Creating the repo, converting the folder, enabling
# Discussions and Pages happen in `workkit setup` and NOWHERE else (issue #71's
# doctrine): the daily path and the session hook only ever read, write, commit
# and push a home that a human already made.
#
# Needs: lib.sh and discussions.sh sourced first.

# The repo's fixed name under the login. One name, so a second machine running
# setup finds the repo that exists rather than making another.
WK_HOME_REPO_NAME='workkit'

# The remote, and the one seam the suite needs: pointed at a local bare repo,
# every clone, fetch and push in this file runs fully offline. Unset on a real
# machine, where the remote is the ordinary GitHub HTTPS URL.
wk_home_remote_url() {
  if [[ -n "${WORKKIT_HOME_REMOTE:-}" ]]; then printf '%s' "$WORKKIT_HOME_REMOTE"; return 0; fi
  printf 'https://github.com/%s.git' "$1"
}

# The home slug this machine is configured for, or empty.
wk_home_slug() { wk_json_get "$WK_HOME_SETTINGS" '.home'; }

# Record the home slug in the machine-local settings — the key everything else
# reads to decide whether there is a home at all.
wk_home_set_slug() {
  local locked=0 rc=0
  # The engine seeds this file on every run, so it is normally already here;
  # this covers the one order where it is not — a folder that was CLONED rather
  # than converted, which arrives carrying only the repo's own files.
  if [[ ! -f "$WK_HOME_SETTINGS" ]]; then
    mkdir -p "$WK_HOME_DIR" 2>/dev/null || return 1
    printf '{\n  "version": 1,\n  "repos": {}\n}\n' >"$WK_HOME_SETTINGS" 2>/dev/null || return 1
  fi
  # The shared mutex, for the same reason every other writer of this file takes
  # it: a whole-file read-modify-write, and a heal registering a repo at the
  # same moment would otherwise keep only one of the two edits.
  if wk_take_settings_lock; then locked=1; fi
  wk_json_edit "$WK_HOME_SETTINGS" --arg s "$1" '.home = $s' || rc=$?
  if [[ "$locked" -eq 1 ]]; then wk_drop_settings_lock; fi
  return "$rc"
}

# The origin slug of the folder, or empty when it is not a git repo.
wk_home_clone_slug() { wk_repo_slug "$WK_HOME_DIR"; }

# Whether the folder's origin IS the given repo. Asked of the URL as well as of
# the slug, because the two are the same question on a real machine and only the
# URL can answer it under the suite's local-remote seam.
wk_home_matches() {
  local slug="$1" actual
  actual="$(git -C "$WK_HOME_DIR" remote get-url origin 2>/dev/null || true)"
  [[ -n "$actual" ]] || return 1
  [[ "$actual" == "$(wk_home_remote_url "$slug")" ]] && return 0
  [[ "$(wk_slug_from_remote "$actual")" == "$slug" ]]
}

# What the folder IS, in one word — the answer doctor, publish and the summaries
# step all branch on.
#
#   unset    no home slug configured; the folder is whatever it was
#   nogit    a slug is configured, the folder is not a git repo yet
#   foreign  the folder is a git repo pointing at a DIFFERENT remote
#   clone    the folder is the home repo's clone
wk_home_state() {
  local slug
  slug="$(wk_home_slug)"
  [[ -n "$slug" ]] || { printf 'unset'; return 0; }
  if [[ ! -d "$WK_HOME_DIR/.git" ]]; then printf 'nogit'; return 0; fi
  if wk_home_matches "$slug"; then printf 'clone'; else printf 'foreign'; fi
}

# True when there is a home clone to read, write or push — the one guard the
# daily path uses before it touches anything.
wk_home_ready() { [[ "$(wk_home_state)" == "clone" ]]; }

# ── The setup steps ───────────────────────────────────────────────────────────

# The GitHub login, which names the repo. Empty when gh cannot answer.
wk_home_login() {
  command -v gh >/dev/null 2>&1 || return 1
  gh api user -q .login 2>/dev/null || return 1
}

# The repo itself. A repo that already exists is CURRENT, never an error: a
# second machine, or a second setup, finds the same home.
# Prints nothing; returns 0 created, 2 already there, 1 could not.
wk_home_ensure_repo() {
  local slug="$1"
  command -v gh >/dev/null 2>&1 || return 1
  if gh repo view "$slug" --json name >/dev/null 2>&1; then return 2; fi
  gh repo create "$slug" --private >/dev/null 2>&1 || return 1
  return 0
}

# The folder becomes the clone, in whichever of the four states it is in.
#
# The conversion is IN PLACE and additive in BOTH directions: a folder that
# predates the repo keeps every file it has, and the files the repo already
# carries are checked out into it — a second machine converting its own folder
# joins the home rather than proposing to empty it. Only the schema files are
# ever committed; the machine-local ones are untracked by construction, because
# .gitignore is written before the first `git add`.
#
# Returns 0 (converted or already), 1 (could not), 3 (a foreign remote — the
# one state that stops the home steps: adopting someone else's repo would push
# this machine's settings into it).
wk_home_convert() {
  local slug="$1" url existing
  url="$(wk_home_remote_url "$slug")"

  if [[ -d "$WK_HOME_DIR/.git" ]]; then
    if ! wk_home_matches "$slug"; then
      existing="$(wk_home_clone_slug)"
      wk_say_warn "home: $WK_HOME_DIR is already a git repo pointing at ${existing:-another remote} — leaving it alone; move it aside if $slug should live there"
      return 3
    fi
    wk_say_skip "home: $WK_HOME_DIR is the clone of $slug"
    return 0
  fi

  # Nothing there, or nothing but an empty directory: the plain case.
  if [[ ! -e "$WK_HOME_DIR" ]] || [[ -z "$(ls -A "$WK_HOME_DIR" 2>/dev/null)" ]]; then
    rmdir "$WK_HOME_DIR" 2>/dev/null || true
    if git clone -q "$url" "$WK_HOME_DIR" 2>/dev/null; then
      wk_say_ok "home: cloned $slug into $WK_HOME_DIR"
      return 0
    fi
    # An empty repo has nothing to clone on some git versions; init instead and
    # let the push below give it its first commit.
    mkdir -p "$WK_HOME_DIR"
  fi

  git -C "$WK_HOME_DIR" init -q 2>/dev/null || { wk_say_warn "home: could not git init $WK_HOME_DIR"; return 1; }
  git -C "$WK_HOME_DIR" symbolic-ref HEAD refs/heads/main 2>/dev/null || true
  git -C "$WK_HOME_DIR" remote add origin "$url" 2>/dev/null \
    || git -C "$WK_HOME_DIR" remote set-url origin "$url" 2>/dev/null || true

  # A repo that already has history (a second machine converting its own folder)
  # is joined rather than overwritten: reset moves the branch onto what the
  # remote has and leaves every local file exactly where it is.
  #
  # And then the CHECKOUT, which is what makes the join whole. Reset alone moves
  # the branch and the index only, so every file the remote carries and this
  # folder lacks reads as DELETED — the next `git add -A` would stage those
  # deletions and the first push would empty the home repo of the other
  # machine's work. Checking HEAD out materializes them instead. Nothing local
  # is clobbered: the only paths it writes are the tracked ones, and the
  # machine-local files are untracked by construction.
  if git -C "$WK_HOME_DIR" fetch -q origin 2>/dev/null \
    && git -C "$WK_HOME_DIR" rev-parse --verify -q origin/main >/dev/null 2>&1; then
    git -C "$WK_HOME_DIR" reset -q origin/main 2>/dev/null || true
    git -C "$WK_HOME_DIR" checkout -q HEAD -- . 2>/dev/null || true
    git -C "$WK_HOME_DIR" branch --set-upstream-to=origin/main main 2>/dev/null || true
  fi

  wk_say_ok "home: $WK_HOME_DIR is now the clone of $slug — its machine-local files stay untracked"
  return 0
}

# The two committed files. workkit.json is written ONCE and never overwritten —
# it accrues the project slugs, and the copy the conversion just checked out of
# the remote is another machine's work, so a template written over it would push
# that work away.
#
# The .gitignore is the one file this function keeps CURRENT: a version of the
# engine that learns of a new machine-local path has to be able to add it to a
# folder that already has the file, or that path starts being committed. The
# lines someone added themselves are left exactly where they are — only the
# template lines that are missing are appended.
wk_home_write_files() {
  local templates="${WK_TEMPLATES_DIR:-$(dirname "${BASH_SOURCE[0]}")/templates}/home"
  local wrote=0 ignore="$WK_HOME_DIR/.gitignore" line added=''

  if [[ ! -f "$WK_HOME_CONFIG" ]]; then
    if [[ -f "$templates/workkit.json" ]]; then
      cp "$templates/workkit.json" "$WK_HOME_CONFIG" && wrote=1
    else
      wk_say_warn "home: the workkit.json template is missing at $templates — this checkout is incomplete"
      return 1
    fi
  fi
  if [[ ! -f "$templates/gitignore" ]]; then
    wk_say_warn "home: the .gitignore template is missing at $templates — this checkout is incomplete"
    return 1
  fi
  if [[ ! -f "$ignore" ]]; then
    cp "$templates/gitignore" "$ignore" && wrote=1
  else
    # A file whose last line has no newline would fuse with the first rule
    # appended after it, and an ignore rule spelled `caches/jobs/` matches
    # nothing at all.
    if [[ -s "$ignore" ]] && [[ -n "$(tail -c 1 "$ignore")" ]]; then
      printf '\n' >>"$ignore"
    fi
    # Comments and blank lines are the template's own prose, not rules: they are
    # never appended to a file someone already keeps.
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ -z "$line" ]] || [[ "$line" == '#'* ]]; then continue; fi
      if grep -qxF -- "$line" "$ignore" 2>/dev/null; then continue; fi
      added="$added $line"
      printf '%s\n' "$line" >>"$ignore"
    done <"$templates/gitignore"
  fi

  if [[ -n "$added" ]]; then
    wk_say_ok "home: added the ignore rules this engine version needs ($(printf '%s' "${added# }" | sed 's/ /, /g')) to $ignore"
  fi
  if [[ "$wrote" -eq 1 ]]; then
    wk_say_ok "home: wrote the schema files (workkit.json, .gitignore) in $WK_HOME_DIR"
  elif [[ -z "$added" ]]; then
    wk_say_skip "home: the schema files are in place"
  fi
  return 0
}

# Commit whatever of the committed layer has changed, and push. The message is
# fixed and the commit is skipped when there is nothing staged, so a second run
# writes no empty commit. Never forces.
#
# Usage: wk_home_commit_push <subject>
wk_home_commit_push() {
  local subject="$1" branch
  wk_home_ready || return 1

  git -C "$WK_HOME_DIR" add -A >/dev/null 2>&1 || true
  if ! git -C "$WK_HOME_DIR" diff --cached --quiet 2>/dev/null; then
    git -C "$WK_HOME_DIR" -c user.name="${GIT_AUTHOR_NAME:-workkit}" \
      -c user.email="${GIT_AUTHOR_EMAIL:-workkit@localhost}" \
      commit -q -m "$subject" >/dev/null 2>&1 \
      || { wk_say_warn "home: the commit did not finish in $WK_HOME_DIR"; return 1; }
  fi

  branch="$(git -C "$WK_HOME_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || printf 'main')"
  if git -C "$WK_HOME_DIR" push -q -u origin "$branch" 2>/dev/null; then
    return 0
  fi
  wk_say_warn "home: could not push $branch to origin — the commit is local; \`git -C $WK_HOME_DIR push\` reports why"
  return 1
}

# Discussions on, and the cadence categories checked. Categories CANNOT be
# created over the API (no createDiscussionCategory mutation exists — probed
# 2026-07-28), so a missing one is a one-time pointer at the page that makes it,
# and the summaries step publishes into the repo's default category until it
# is there.
wk_home_discussions() {
  local slug="$1" rc=0 meta missing='' name
  wk_disc_ready || { wk_say_skip "home: Discussions need gh and jq — skipped"; return 0; }

  wk_disc_enable "$slug" || rc=$?
  case "$rc" in
    0) wk_say_ok "home: Discussions enabled on $slug" ;;
    2) wk_say_skip "home: Discussions are on for $slug" ;;
    *) wk_say_warn "home: could not enable Discussions on $slug — turn them on at https://github.com/$slug/settings"; return 0 ;;
  esac

  meta="$(wk_disc_meta "$slug" --refresh)" || return 0
  for name in Daily Weekly Monthly; do
    printf '%s' "$meta" | jq -e --arg c "$name" '.categories | has($c)' >/dev/null 2>&1 || missing="$missing $name"
  done
  if [[ -n "$missing" ]]; then
    wk_say_info "home: the summary categories ($(printf '%s' "${missing# }" | sed 's/ /, /g')) do not exist yet — GitHub has no API that creates one, so make them once at https://github.com/$slug/discussions/categories. Until then summaries publish in the repo's default category"
  else
    wk_say_skip "home: the Daily, Weekly and Monthly categories are there"
  fi
  return 0
}

# Pages, serving the built dashboard from `docs/` on the default branch — the
# only subdirectory shape the API accepts (`source.path` is `/` or `/docs`).
# A refusal is the ordinary case on a plan without private Pages: it warns with
# the fix and setup carries on.
wk_home_pages() {
  local slug="$1" out
  command -v gh >/dev/null 2>&1 || return 0

  if gh api "repos/$slug/pages" >/dev/null 2>&1; then
    wk_say_skip "home: GitHub Pages is on for $slug"
    return 0
  fi
  out="$(gh api -X POST "repos/$slug/pages" \
    -f 'source[branch]=main' -f 'source[path]=/docs' 2>&1)" || {
    wk_say_warn "home: could not enable GitHub Pages on $slug — a private repo needs a paid plan for Pages; make the repo public or enable it at https://github.com/$slug/settings/pages"
    return 0
  }
  wk_say_ok "home: GitHub Pages serves $slug from main /docs"
  return 0
}

# The whole home half of the wizard, in the Spec's order. Every step is
# idempotent and every failure warns and continues — setup never dies mid-way —
# with one exception: a folder pointing at someone else's remote stops the rest,
# because every step after it would write into that repo.
wk_home_setup() {
  local login slug rc=0

  login="$(wk_home_login)" || true
  if [[ -z "$login" ]]; then
    wk_say_info "home: gh could not say who you are — run \`gh auth login\`, then \`workkit setup\` again to create the home repo"
    return 0
  fi
  slug="$login/$WK_HOME_REPO_NAME"

  # The one confirm line, and only where there is someone to answer it. A
  # non-interactive run prints what it would do and moves on.
  if [[ "$(wk_home_slug)" != "$slug" ]]; then
    if declare -f interactive >/dev/null 2>&1 && ! interactive; then
      wk_say_info "home: no home repo is configured — a terminal run of \`workkit setup\` creates the private $slug and makes $WK_HOME_DIR its clone"
      return 0
    fi
    printf 'Create the private home repo %s and make %s its clone? [y/N] ' "$slug" "$WK_HOME_DIR"
    local answer=''
    read -r answer || true
    case "$answer" in
      y|Y|yes|YES) ;;
      *) wk_say_skip "home: left as it is — \`workkit setup\` offers again"; return 0 ;;
    esac
  fi

  wk_home_ensure_repo "$slug" || rc=$?
  case "$rc" in
    0) wk_say_ok "home: created the private repo $slug" ;;
    2) wk_say_skip "home: $slug already exists — using it" ;;
    *) wk_say_warn "home: could not create $slug — \`gh repo create $slug --private\` reports why"; return 0 ;;
  esac

  rc=0
  wk_home_convert "$slug" || rc=$?
  # 3 is the foreign remote, 1 is a conversion that could not finish. Neither
  # leaves anything the steps below could safely write to.
  [[ "$rc" -eq 0 ]] || return 0

  wk_home_write_files || return 0
  wk_home_set_slug "$slug" >/dev/null 2>&1 || true
  wk_home_discussions "$slug"
  wk_home_pages "$slug"
  wk_home_commit_push 'chore(home): the schema files' || true
  return 0
}

# ── The project list ──────────────────────────────────────────────────────────

# One repo's slug in workkit.json's `projects`, added on enable or heal and
# removed when the repo says `enabled: false`. SLUGS, never paths: the file
# travels between machines and a path does not (the machine-local roster in
# settings.json keeps those).
#
# Writes nothing anywhere but the home clone's workkit.json, and nothing at all
# when the value is already what it should be — a heal that changed nothing
# leaves the file untouched, so the daily publish has nothing to commit.
#
# The CALLER holds the settings mutex: this is a read-modify-write like the
# roster's, and the two run in the same heal.
wk_home_upsert_project() {
  local slug="$1" name="$2" current
  wk_home_ready || return 0
  [[ -f "$WK_HOME_CONFIG" ]] || return 0
  [[ -n "$slug" ]] || return 0

  current="$(jq -r --arg s "$slug" '.projects[$s].name // empty' "$WK_HOME_CONFIG" 2>/dev/null || true)"
  [[ "$current" == "$name" ]] && return 0

  wk_json_edit "$WK_HOME_CONFIG" --arg s "$slug" --arg n "$name" \
    '.projects = ((.projects // {}) + { ($s): { name: $n } })' >/dev/null 2>&1 || true
  return 0
}

wk_home_remove_project() {
  local slug="$1"
  wk_home_ready || return 0
  [[ -f "$WK_HOME_CONFIG" ]] || return 0
  [[ -n "$slug" ]] || return 0

  jq -e --arg s "$slug" '(.projects // {}) | has($s)' "$WK_HOME_CONFIG" >/dev/null 2>&1 || return 0
  wk_json_edit "$WK_HOME_CONFIG" --arg s "$slug" \
    '.projects = ((.projects // {}) | del(.[$s]))' >/dev/null 2>&1 || true
  return 0
}

# ── Doctor ────────────────────────────────────────────────────────────────────

# The home clone's state, in the voice of whoever called. Returns the number of
# things needing attention, which is what `workkit doctor` counts.
wk_home_doctor() {
  local slug state track

  slug="$(wk_home_slug)"
  state="$(wk_home_state)"
  case "$state" in
    unset)
      wk_say_info "home: not set — \`workkit setup\` creates the private home repo and makes $WK_HOME_DIR its clone"
      return 0 ;;
    nogit)
      wk_say_warn "home: $slug is configured but $WK_HOME_DIR is not a clone of it — run \`workkit setup\` to convert the folder in place"
      return 1 ;;
    foreign)
      wk_say_warn "home: $WK_HOME_DIR is a git repo pointing at $(wk_home_clone_slug), not $slug — move it aside, then run \`workkit setup\`"
      return 1 ;;
  esac

  # A clone. The only question left is where it stands against its upstream, and
  # `git status -sb` answers all three without a network call.
  track="$(git -C "$WK_HOME_DIR" status -sb 2>/dev/null | head -1 || true)"
  if [[ "$track" == *'[ahead '*'behind '* ]]; then
    wk_say_warn "home: $slug has diverged from its upstream — \`git -C $WK_HOME_DIR pull --rebase\` on a clean tree reconciles it; the engine never force-pushes"
    return 1
  fi
  if [[ "$track" == *'[ahead '* ]]; then
    wk_say_info "home: $slug is a clone with unpushed commits — the daily publish pushes them"
    return 0
  fi
  if [[ "$track" == *'[behind '* ]]; then
    wk_say_warn "home: $slug is behind its upstream — \`git -C $WK_HOME_DIR pull --rebase\` catches it up"
    return 1
  fi
  wk_say_ok "home: $slug — $WK_HOME_DIR is its clone"
  return 0
}
