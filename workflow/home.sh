#!/usr/bin/env bash
# workflow/home.sh — the home repo's lifecycle. SOURCED, never executed.
#
# `~/.workkit` is a PLAIN folder holding this machine's own state, and it is
# never a git repo (issue #77). The one git repo in the global layer is
# `~/.workkit/tower` — the clone of a private `<login>/workkit`, seeded from
# this checkout's `tower/app` and shaped like every other omega site project:
# a brand root with `apps/`, `config/` and its own `.gitignore`.
#
# The boundary is the folder, not a .gitignore:
#   ~/.workkit/          settings.json (the site options, hand-edited),
#                        .repos.json (the roster and the declines) and
#                        .cache.json (the ids and cursors) — one machine's own
#                        knowledge, never travelling
#   ~/.workkit/tower/    the project, and only the project: engine territory,
#                        never hand-edited and carrying no `.workkit/` of its own
#
# The built site never lands on main at all: it is pushed to the repo's
# `gh-pages` branch, which Pages serves from the branch root.
#
# WHO CREATES WHAT. Creating the repo, cloning it, seeding it — the tower
# project, and since issue #91 the cloud brief's runner and its workflow —
# enabling Discussions and Pages happen in `workkit setup` and NOWHERE else
# (issue #71's doctrine): the daily path and the session hook only ever read,
# write, commit and push a home that a human already made.
#
# Needs: lib.sh and discussions.sh sourced first.

# The repo's fixed name under the login. One name, so a second machine running
# setup finds the repo that exists rather than making another.
WK_HOME_REPO_NAME='workkit'

# The branch the built site is published to. Pages serves a branch's ROOT, so
# nothing on main is ever named for a Pages rule and no build output is ever
# committed as source.
WK_HOME_PAGES_BRANCH='gh-pages'

# The seed's source of truth: this checkout's tower/app, resolved from the
# engine's own location so a moved or symlinked checkout still finds it. There
# is no stored second template — the app IS the template. The override is the
# suite's seam.
WK_TOWER_APP="${WORKKIT_TOWER_APP:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../tower/app" 2>/dev/null && pwd -P || printf '')}"

# The plugin checkout this engine is part of — the source of the cloud brief's
# runner, the way tower/app is the source of the project. Resolved the same way,
# and overridden the same way for the suite.
WK_KIT_DIR="${WORKKIT_KIT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd -P || printf '')}"

# The cloud brief's runner, seeded into the home repo (issue #91).
#
# `.github/workflows/brief.yml` and its secrets cannot live on the plugin repo:
# that repo is distributed to everyone who installs the kit, and a consumer
# cannot set secrets on a repo they do not own. So the workflow runs on the
# HOME repo, and the code it runs is copied there — the checkout stays the one
# source, and a `workkit setup` after this checkout changes refreshes the copy.
#
# `src:dest` pairs, both relative. Everything but the workflow file lands under
# one folder with its checkout-relative subpath intact, so every relative
# address inside those scripts — `../workflow` for the engine libraries,
# `../tower/api/lib` for the composers' requires — resolves in the clone exactly
# as it does here. The list IS the require closure of brief-payload.js plus what
# claude-cloud.sh sources; a new require means a new line here.
WK_HOME_RUNNER_FILES=(
  'workflow/templates/github-workflows/brief.yml:.github/workflows/brief.yml'
  'jobs/claude-cloud.sh:brief/jobs/claude-cloud.sh'
  'jobs/brief-publish.sh:brief/jobs/brief-publish.sh'
  'jobs/brief-payload.js:brief/jobs/brief-payload.js'
  'jobs/cc-news.js:brief/jobs/cc-news.js'
  'workflow/lib.sh:brief/workflow/lib.sh'
  'workflow/discussions.sh:brief/workflow/discussions.sh'
  'workflow/home.sh:brief/workflow/home.sh'
  'tower/api/lib/repos.js:brief/tower/api/lib/repos.js'
  'tower/api/lib/board.js:brief/tower/api/lib/board.js'
  'tower/api/lib/health.js:brief/tower/api/lib/health.js'
  'tower/api/lib/brief.js:brief/tower/api/lib/brief.js'
)

# The remote, and the one seam the suite needs: pointed at a local bare repo,
# every clone, fetch and push in this file runs fully offline. Unset on a real
# machine, where the remote is the ordinary GitHub HTTPS URL.
wk_home_remote_url() {
  if [[ -n "${WORKKIT_HOME_REMOTE:-}" ]]; then printf '%s' "$WORKKIT_HOME_REMOTE"; return 0; fi
  printf 'https://github.com/%s.git' "$1"
}

# The home slug this machine is configured for, or empty. It is a SITE option:
# the hand-edited file names the repo the site publishes from (issue #80).
wk_home_slug() { wk_json_get "$WK_HOME_SETTINGS" '.site.repo'; }

# Record the home slug in the hand-edited settings — the one key setup writes
# there, and the key everything else reads to decide whether there is a home at
# all. Nothing else in that file is ever written by a machine.
wk_home_set_slug() {
  local locked=0 rc=0
  # The engine seeds this file on every run, so it is normally already here;
  # this covers the one order where it is not — a machine whose first workkit
  # command is `setup`, before any heal has written the user folder.
  if [[ ! -f "$WK_HOME_SETTINGS" ]]; then
    mkdir -p "$WK_USER_DIR" 2>/dev/null || return 1
    printf '{\n  "version": 1,\n  "site": {\n    "repo": null,\n    "publish": null,\n    "url": null\n  }\n}\n' \
      >"$WK_HOME_SETTINGS" 2>/dev/null || return 1
  fi
  # The shared mutex, for the same reason every other writer of the machine's
  # state files takes it: a whole-file read-modify-write, and a heal registering
  # a repo at the same moment would otherwise keep only one of the two edits.
  if wk_take_state_lock; then locked=1; fi
  wk_json_edit "$WK_HOME_SETTINGS" --arg s "$1" '.site = ((.site // {}) + { repo: $s })' || rc=$?
  if [[ "$locked" -eq 1 ]]; then wk_drop_state_lock; fi
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

# What `~/.workkit/tower` IS, in one word — the answer doctor, publish and the
# summaries step all branch on.
#
#   unset    no home slug configured; nothing has been decided
#   absent   a slug is configured and there is no tower folder — setup clones it
#   clone    the folder is the home repo's clone
#   other    something else is at that path — never adopted, never converted
wk_home_state() {
  local slug
  slug="$(wk_home_slug)"
  [[ -n "$slug" ]] || { printf 'unset'; return 0; }
  if [[ ! -e "$WK_HOME_DIR" ]]; then printf 'absent'; return 0; fi
  if wk_home_matches "$slug"; then printf 'clone'; else printf 'other'; fi
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

# The clone, made the plain way: `git clone` into a path that does not exist.
#
# NOTHING is ever converted or adopted. `~/.workkit/tower` is a name only this
# engine gives, so an absent path is the ordinary case and anything already
# sitting there is somebody else's — a repo pointing elsewhere, or a folder a
# person made. Both stop the home steps rather than being taken over.
#
# `~/.workkit` itself is only ever mkdir'd: it is a plain folder, and a
# `git init` there would make the whole global layer a repo.
#
# Returns 0 (cloned, or already the clone), 1 (could not clone), 3 (something
# else is in the way — the one state that stops the rest of the home steps).
wk_home_clone() {
  local slug="$1" url existing out
  url="$(wk_home_remote_url "$slug")"

  if [[ -e "$WK_HOME_DIR" ]]; then
    if wk_home_matches "$slug"; then
      wk_say_skip "home: $WK_HOME_DIR is the clone of $slug"
      return 0
    fi
    existing="$(wk_home_clone_slug)"
    if [[ -n "$existing" ]]; then
      wk_say_warn "home: $WK_HOME_DIR is a git repo pointing at $existing — leaving it alone; move it aside if $slug should live there"
    else
      wk_say_warn "home: $WK_HOME_DIR already exists and is not a clone of $slug — leaving it alone; move it aside, then run \`workkit setup\` again"
    fi
    return 3
  fi

  mkdir -p "$WK_USER_DIR" 2>/dev/null || { wk_say_warn "home: could not create $WK_USER_DIR"; return 1; }
  # A repo GitHub just created is empty, and git clones it fine — with a warning
  # on stderr about an empty repository and no branch checked out. That warning
  # is the expected first-setup case, so the output is swallowed and only the
  # exit status is read; the seed below gives the clone its first commit.
  out="$(git clone -q "$url" "$WK_HOME_DIR" 2>&1)" || {
    wk_say_warn "home: could not clone $slug into $WK_HOME_DIR — \`git clone $url $WK_HOME_DIR\` reports why"
    return 1
  }
  wk_say_ok "home: cloned $slug into $WK_HOME_DIR"
  return 0
}

# Whether the clone is EMPTY — a repo with no commit of its own, which is the
# only state the seed may write into. A clone that already carries the project
# is another machine's work and is never re-seeded.
wk_home_empty() {
  [[ -d "$WK_HOME_DIR/.git" ]] || return 1
  git -C "$WK_HOME_DIR" rev-parse --verify -q HEAD >/dev/null 2>&1 && return 1
  return 0
}

# Every `file:` dependency spec in one package.json, repointed at the absolute
# path it resolves to from the manifest it was COPIED FROM.
#
# The relative spec is truth in this checkout and nonsense in the clone: it
# counts directories up from `tower/app`, and the clone sits under `~/.workkit`.
# Committing the absolute path is the local-era acceptance the omega brand
# monorepo already makes for itself — the specs flip to registry ranges when
# OMEGA publishes, and that is the day this rewrite stops being needed.
#
# Usage: wk_home_repoint_file_specs <seeded package.json> <source package dir>
wk_home_repoint_file_specs() {
  local pkg="$1" srcdir="$2" specs name spec rel abs
  [[ -f "$pkg" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  specs="$(jq -r '
    [(.dependencies // {}), (.devDependencies // {})]
    | add // {}
    | to_entries[]
    | select(.value | startswith("file:"))
    | "\(.key)\t\(.value)"' "$pkg" 2>/dev/null || true)"

  while IFS="$(printf '\t')" read -r name spec; do
    [[ -n "$name" ]] || continue
    rel="${spec#file:}"
    # `cd` rather than string arithmetic: the target is a real directory on this
    # machine, and only the filesystem can resolve `../..` through symlinks.
    abs="$(cd "$srcdir/$rel" 2>/dev/null && pwd -P || printf '')"
    if [[ -z "$abs" ]]; then
      wk_say_warn "home: the seeded $name still points at $spec — nothing resolves it from $srcdir, so the tower project cannot build until it does"
      continue
    fi
    wk_json_edit "$pkg" --arg n "$name" --arg v "file:$abs" '
      (if (.dependencies // {} | has($n)) then .dependencies[$n] = $v else . end)
      | (if (.devDependencies // {} | has($n)) then .devDependencies[$n] = $v else . end)' \
      >/dev/null 2>&1 || true
  done <<<"$specs"
  return 0
}

# The seed: this checkout's `tower/app` becomes the clone's whole contents.
#
# The app IS the template (the Spec's "no stored second template"), so the copy
# is a plain one minus what a checkout accretes — the installed dependencies,
# the lockfile, the build output and the omega run machinery. The project's own
# AGENTS.md, CLAUDE.md and README.md travel WITH it: they are the tower
# project's docs and the repo they land in is a real repo.
#
# The clone is the app and nothing else (issue #79): the site options are the
# user's and live in the machine settings file, and no `.workkit/` is ever
# written here — the engine treats this path as the home BY PATH, so there is no
# participation flag to seed and no inbox to keep out of the commit. The one
# thing the seed adds on top of the copy is the absolute `file:` specs.
wk_home_seed() {
  local pkg app_pkg

  [[ -n "$WK_TOWER_APP" && -d "$WK_TOWER_APP" ]] || {
    wk_say_warn "home: the tower app is missing at ${WK_TOWER_APP:-this checkout} — nothing to seed the project from"
    return 1
  }

  # `tar` rather than `cp -R` with deletions after: the exclusions have to hold
  # at every depth (a nested node_modules under apps/*), and a copy that landed
  # a gigabyte of dependencies first would be slow before it was wrong.
  (cd "$WK_TOWER_APP" && tar -cf - \
    --exclude './node_modules' --exclude '*/node_modules' \
    --exclude './package-lock.json' --exclude '*/package-lock.json' \
    --exclude './.omega' --exclude '*/.omega' \
    --exclude './.cache' --exclude '*/.cache' \
    --exclude './.temp' --exclude '*/.temp' \
    --exclude './dist' --exclude '*/dist' \
    --exclude './.env' --exclude '*/.env' \
    .) | (cd "$WK_HOME_DIR" && tar -xf -) || {
    wk_say_warn "home: could not copy the tower app into $WK_HOME_DIR"
    return 1
  }

  # The manifests, root first and then every app: each spec resolves from the
  # directory of the manifest it was copied from, never from the clone.
  wk_home_repoint_file_specs "$WK_HOME_DIR/package.json" "$WK_TOWER_APP"
  for pkg in "$WK_HOME_DIR"/apps/*/package.json; do
    [[ -f "$pkg" ]] || continue
    app_pkg="${pkg#"$WK_HOME_DIR"/}"
    wk_home_repoint_file_specs "$pkg" "$WK_TOWER_APP/$(dirname "$app_pkg")"
  done

  # The description says what the manifest now carries, the way the omega brand
  # monorepo's own does — a reader opening this repo on another machine has to
  # learn from the file itself why its dependencies name a path.
  if [[ -f "$WK_HOME_DIR/package.json" ]] && command -v jq >/dev/null 2>&1; then
    wk_json_edit "$WK_HOME_DIR/package.json" \
      --arg note ' Local era: the @omega.js frameworks resolve by absolute file: link into the omega monorepo on the machine that seeded this repo, until OMEGA publishes.' \
      '.description = ((.description // "") + $note)' >/dev/null 2>&1 || true
  fi

  wk_say_ok "home: seeded the tower project in $WK_HOME_DIR from $WK_TOWER_APP"
  return 0
}

# The cloud brief's runner, copied into the clone (issue #91).
#
# Unlike the project seed this runs on EVERY setup, empty clone or not: the
# scripts are the checkout's, they change with it, and a home repo running last
# month's runner is the failure this refresh exists to prevent. Idempotent by
# content — a file already identical is not rewritten, so a second setup writes
# nothing and leaves nothing to commit.
#
# Returns 0 (something changed), 2 (every file was already current), 1 (the
# checkout could not be read — nothing was written).
wk_home_seed_runner() {
  local pair src dest changed=0 missing=''

  [[ -n "$WK_KIT_DIR" && -d "$WK_KIT_DIR" ]] || {
    wk_say_warn "home: the plugin checkout could not be resolved beside this engine — the cloud brief's runner was not seeded"
    return 1
  }

  for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
    src="$WK_KIT_DIR/${pair%%:*}"
    dest="$WK_HOME_DIR/${pair#*:}"
    if [[ ! -f "$src" ]]; then missing="$missing ${pair%%:*}"; continue; fi
    if cmp -s "$src" "$dest" 2>/dev/null; then continue; fi
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    # -p, so a script the runner sources arrives with the mode it was written
    # with rather than whatever this shell's umask would have given it.
    cp -p "$src" "$dest" 2>/dev/null || {
      wk_say_warn "home: could not write ${pair#*:} into $WK_HOME_DIR"
      return 1
    }
    changed=$((changed + 1))
  done

  if [[ -n "$missing" ]]; then
    wk_say_warn "home: this checkout is missing$missing — the cloud brief's runner is incomplete in $WK_HOME_DIR"
  fi
  if [[ "$changed" -eq 0 ]]; then
    wk_say_skip "home: the cloud brief's runner in $WK_HOME_DIR is current"
    return 2
  fi
  wk_say_ok "home: seeded the cloud brief's runner in $WK_HOME_DIR ($changed file(s) from $WK_KIT_DIR)"
  return 0
}

# The project's dependencies, so the daily publish has something to build with.
# Absent tooling is an honest skip: the publish checks for the same binary and
# says the same thing.
#
# Run on BOTH setup paths — the seed and the clone another machine already
# seeded, which arrives with the project and none of its dependencies. An
# installed tree is the gate below: the binary already being there means there
# is nothing to install, so a second setup costs nothing.
wk_home_install() {
  if [[ -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    wk_say_skip "home: the tower project's dependencies are already installed in $WK_HOME_DIR"
    return 0
  fi
  if ! command -v npm >/dev/null 2>&1; then
    wk_say_skip "home: npm is not on this machine — the tower project's dependencies are not installed, so nothing publishes from here yet"
    return 0
  fi
  wk_say_info "home: installing the tower project's dependencies in $WK_HOME_DIR"
  npm --prefix "$WK_HOME_DIR" install >/dev/null 2>&1 || true
  # The exit status proves nothing (probed 2026-07-28: an install with no omega
  # checkout to resolve still exits 0 and leaves dangling symlinks), so the
  # binary itself is the check — the same one publish.sh makes.
  #
  # A second pass when the bin is still missing: on a fresh tree npm's own
  # workspace linking took two runs to put anything but omega-manager in
  # node_modules/.bin (observed on the first real setup, 2026-07-29). The retry
  # is one extra run over an installed tree, never a loop — if the bin is absent
  # after it, the warn below is the genuine failure.
  if [[ ! -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    npm --prefix "$WK_HOME_DIR" install >/dev/null 2>&1 || true
  fi
  if [[ -x "$WK_HOME_DIR/node_modules/.bin/omega" ]]; then
    wk_say_ok "home: the tower project can build here"
  else
    wk_say_warn "home: the tower project's build tooling did not install (no node_modules/.bin/omega) — its @omega.js deps resolve by file: link into the omega monorepo, so nothing publishes until that checkout is reachable"
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

  # `.workkit` is excluded rather than trusted to be absent: the clone carries no
  # participation state of its own, so anything that appeared under that name is
  # scratch, and an unattended daily commit must never push it to the default
  # branch (issue #79).
  git -C "$WK_HOME_DIR" add -A -- ':!.workkit' >/dev/null 2>&1 || true
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

# Pages, serving the built dashboard from the ROOT of the `gh-pages` branch.
#
# The API's `source.path` takes exactly two values, `/` and `/docs` (probed
# against the live schema 2026-07-28, `"enum":["/","/docs"]`) — and a branch
# that carries nothing but the build has no reason to bury it in a folder, so
# the path is `/` and the branch carries the whole answer.
#
# The branch need not exist yet: Pages accepts a source pointing at one that
# does not, and simply serves nothing until the first publish pushes it. That
# order is what keeps setup out of the branch-creating business (issue #71) —
# the publish makes the branch, because pushing output is its job.
#
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
    -f "source[branch]=$WK_HOME_PAGES_BRANCH" -f 'source[path]=/' 2>&1)" || {
    wk_say_warn "home: could not enable GitHub Pages on $slug — a private repo needs a paid plan for Pages; make the repo public or enable it at https://github.com/$slug/settings/pages"
    return 0
  }
  wk_say_ok "home: GitHub Pages serves $slug from $WK_HOME_PAGES_BRANCH /"
  return 0
}

# The whole home half of the wizard, in the Spec's order. Every step is
# idempotent and every failure warns and continues — setup never dies mid-way —
# with one exception: something already sitting at the clone's path stops the
# rest, because every step after it would write into whatever that is.
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
  wk_home_clone "$slug" || rc=$?
  # 3 is something else at the path, 1 is a clone that could not finish. Neither
  # leaves anything the steps below could safely write to.
  [[ "$rc" -eq 0 ]] || return 0

  wk_home_set_slug "$slug" >/dev/null 2>&1 || true

  # An empty clone is a repo GitHub just made, and the only state the seed may
  # write into. A clone that already carries the project came from another
  # machine and is left exactly as it is.
  if wk_home_empty; then
    wk_home_seed || return 0
    wk_home_seed_runner || true
    wk_home_install
    wk_home_discussions "$slug"
    wk_home_pages "$slug"
    wk_home_commit_push 'chore(home): seed the tower project' || true
    return 0
  fi

  wk_say_skip "home: the tower project is already in $WK_HOME_DIR"
  # The second machine's path: the project travelled, its dependencies did not.
  # The runner is refreshed here too, and pushed on its own — the project seed
  # is a one-time write, the runner tracks a checkout that keeps changing.
  rc=0
  wk_home_seed_runner || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    wk_home_commit_push 'chore(home): refresh the cloud brief runner' || true
  fi
  wk_home_install
  wk_home_discussions "$slug"
  wk_home_pages "$slug"
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
      wk_say_info "home: not set — \`workkit setup\` creates the private home repo and clones it into $WK_HOME_DIR"
      return 0 ;;
    absent)
      wk_say_warn "home: $slug is configured but nothing is cloned at $WK_HOME_DIR — run \`workkit setup\` to clone and seed it"
      return 1 ;;
    other)
      local sitting
      sitting="$(wk_home_clone_slug)"
      if [[ -n "$sitting" ]]; then
        wk_say_warn "home: $WK_HOME_DIR is a git repo pointing at $sitting, not $slug — move it aside, then run \`workkit setup\`"
      else
        wk_say_warn "home: $WK_HOME_DIR exists and is not a clone of $slug — move it aside, then run \`workkit setup\`"
      fi
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

# The cloud brief's runner, checked rather than written (issue #91).
#
# `wk_home_seed_runner` runs only from `workkit setup`, so a `git pull` of this
# checkout leaves the home repo running last week's copy with nothing to say so.
# This is the line that says it. It only ever READS: only setup writes into the
# clone, and the fix it names is that same setup.
#
# Returns 1 when the seeded copy is behind, 0 otherwise (current, or a skip).
wk_home_runner_doctor() {
  local pair src dest behind=0 compared=0

  wk_home_ready || {
    wk_say_skip "runner: no home clone at $WK_HOME_DIR — nothing to compare the cloud brief's runner against"
    return 0
  }
  [[ -n "$WK_KIT_DIR" && -d "$WK_KIT_DIR" ]] || {
    wk_say_skip "runner: the plugin checkout could not be resolved beside this engine — the cloud brief's runner cannot be compared"
    return 0
  }

  for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
    src="$WK_KIT_DIR/${pair%%:*}"
    dest="$WK_HOME_DIR/${pair#*:}"
    [[ -f "$src" ]] || continue
    compared=$((compared + 1))
    cmp -s "$src" "$dest" 2>/dev/null || behind=$((behind + 1))
  done

  if [[ "$compared" -eq 0 ]]; then
    wk_say_skip "runner: this checkout carries none of the cloud brief's runner files — nothing to compare"
    return 0
  fi
  if [[ "$behind" -gt 0 ]]; then
    wk_say_warn "runner: the home repo's brief runner is behind this checkout ($behind of $compared file(s) differ) — run \`workkit setup\`"
    return 1
  fi
  wk_say_ok "runner: the cloud brief's runner in $WK_HOME_DIR is current with this checkout"
  return 0
}
