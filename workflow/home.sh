#!/usr/bin/env bash
# workflow/home.sh — the home repo's lifecycle. SOURCED, never executed.
#
# `~/.workkit` is a PLAIN folder holding this machine's own state, and it is
# never a git repo (issue #77). The one git repo in the global layer is
# `~/.workkit/tower` — the clone of a private `<login>/workkit`, seeded from
# this checkout's `tower/app` and shaped like every other omega site project:
# a brand root with `targets/`, `config/` and its own `.gitignore`.
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

# What a copy of that app must never carry — the trees a working checkout
# accretes, which is exactly what `tower/app/.gitignore` names. ONE list, read
# by the seed's tar exclusions and by the sync's walk on both sides (issue
# #129), so the two can never disagree about what "the project" is. Matched by
# NAME at every depth: a nested `node_modules` under `targets/*` is the same
# answer as the one at the root. `.git` and `.DS_Store` ride along beyond the
# gitignore: the app has no `.git` and the clone's is never the sync's to look
# inside, and `.DS_Store` is Finder litter no copy should carry.
WK_TOWER_APP_EXCLUDE=(node_modules package-lock.json .omega .cache .temp dist .env .git .DS_Store)

# The engine's own folder — where standards.sh sits, the script the clone's heal
# is a scoped invocation of. Resolved from this file rather than from the kit
# dir, because the engine travels as a folder and the heal is the engine's.
WK_WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || printf '')"

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
# source, and the copy is refreshed from it by `workkit setup` and by every
# morning run (issue #143), so a checkout that moved on is a day behind at most.
#
# `src:dest` pairs, both relative. Everything but the workflow file lands under
# one folder with its checkout-relative subpath intact, so every relative
# address inside those scripts — `../workflow` for the engine libraries,
# `../tower/api/lib` for the composers' requires — resolves in the clone exactly
# as it does here. The list IS the require closure of brief-payload.js plus what
# morning.sh sources on the cloud path; a new require means a new line here.
WK_HOME_RUNNER_FILES=(
  'workflow/templates/github-workflows/brief.yml:.github/workflows/brief.yml'
  'jobs/morning.sh:brief/jobs/morning.sh'
  'jobs/brief-publish.sh:brief/jobs/brief-publish.sh'
  'jobs/brief-payload.js:brief/jobs/brief-payload.js'
  'jobs/cc-news.js:brief/jobs/cc-news.js'
  'jobs/stats.js:brief/jobs/stats.js'
  'workflow/lib.sh:brief/workflow/lib.sh'
  'workflow/discussions.sh:brief/workflow/discussions.sh'
  'workflow/home.sh:brief/workflow/home.sh'
  'tower/api/lib/repos.js:brief/tower/api/lib/repos.js'
  'tower/api/lib/board.js:brief/tower/api/lib/board.js'
  'tower/api/lib/health.js:brief/tower/api/lib/health.js'
  'tower/api/lib/brief.js:brief/tower/api/lib/brief.js'
  'tower/api/lib/summaries.js:brief/tower/api/lib/summaries.js'
  'tower/api/lib/history.js:brief/tower/api/lib/history.js'
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

# The branch the clone is on — the one `wk_home_commit_push` pushes to, and the
# one the published home pointer names so that every reader of the roster asks
# for the branch the writer actually wrote (issue #112). `main` is the answer
# when there is no clone to ask, since that is what the engine creates.
# symbolic-ref, not rev-parse: on an unborn HEAD rev-parse prints `HEAD` AND
# fails, so the fallback would append a second line into a JSON string.
wk_home_branch() {
  git -C "$WK_HOME_DIR" symbolic-ref --quiet --short HEAD 2>/dev/null || printf 'main'
}

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

# The whole transform ONE manifest gets on its way out of the checkout: the
# `file:` specs repointed absolute, and — for the project root's manifest — the
# note that says why they now name a path.
#
# It is a function rather than two inline blocks because the SYNC has to compose
# the same thing (issue #129): a manifest compared against the RAW source
# differs by construction, so a content sync that compared it that way would
# rewrite it on every run forever. The sync applies this to a scratch copy and
# compares THAT — what would land — against what is already there.
#
# Usage: wk_home_project_manifest <manifest> <source package dir> [--root]
wk_home_project_manifest() {
  local pkg="$1" srcdir="$2" root="${3:-}"
  wk_home_repoint_file_specs "$pkg" "$srcdir"
  [[ "$root" == '--root' ]] || return 0
  [[ -f "$pkg" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  # The description says what the manifest now carries, the way the omega brand
  # monorepo's own does — a reader opening this repo on another machine has to
  # learn from the file itself why its dependencies name a path.
  wk_json_edit "$pkg" \
    --arg note ' Local era: the @omega.js frameworks resolve by absolute file: link into the omega monorepo on the machine that seeded this repo, until OMEGA publishes.' \
    '.description = ((.description // "") + $note)' >/dev/null 2>&1 || true
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
# participation flag to seed and no capture file to keep out of the commit. The one
# thing the seed adds on top of the copy is the absolute `file:` specs.
wk_home_seed() {
  local pkg target_pkg name excludes=()

  [[ -n "$WK_TOWER_APP" && -d "$WK_TOWER_APP" ]] || {
    wk_say_warn "home: the tower app is missing at ${WK_TOWER_APP:-this checkout} — nothing to seed the project from"
    return 1
  }

  # `tar` rather than `cp -R` with deletions after: the exclusions have to hold
  # at every depth (a nested node_modules under targets/*), and a copy that landed
  # a gigabyte of dependencies first would be slow before it was wrong. The
  # names are the shared list, so the seed and the sync exclude the same set.
  for name in "${WK_TOWER_APP_EXCLUDE[@]}"; do
    excludes+=(--exclude "./$name" --exclude "*/$name")
  done
  (cd "$WK_TOWER_APP" && tar -cf - "${excludes[@]}" .) \
    | (cd "$WK_HOME_DIR" && tar -xf -) || {
    wk_say_warn "home: could not copy the tower app into $WK_HOME_DIR"
    return 1
  }

  # The manifests, root first and then every target: each spec resolves from the
  # directory of the manifest it was copied from, never from the clone.
  wk_home_project_manifest "$WK_HOME_DIR/package.json" "$WK_TOWER_APP" --root
  for pkg in "$WK_HOME_DIR"/targets/*/package.json; do
    [[ -f "$pkg" ]] || continue
    target_pkg="${pkg#"$WK_HOME_DIR"/}"
    wk_home_project_manifest "$pkg" "$WK_TOWER_APP/$(dirname "$target_pkg")"
  done

  wk_say_ok "home: seeded the tower project in $WK_HOME_DIR from $WK_TOWER_APP"
  return 0
}

# The clone's project, refreshed from this checkout's `tower/app` (issue #129).
#
# The seed is a ONE-TIME write — a clone that already carries the project is
# never re-seeded, because it is another machine's work — so every tower
# improvement made after the home repo was created stopped at the checkout, and
# the published dashboard stayed at whatever the app looked like on seed day.
# This is the catch-up, and the publish runs it ahead of the build.
#
# BY CONTENT, the way the cloud brief's runner is seeded: a file whose bytes
# already match is not written, so a second run changes nothing and leaves
# nothing to commit. The manifests are compared against what
# `wk_home_project_manifest` would leave rather than against the raw source,
# since the raw one differs by construction.
#
# WHAT IT MAY REMOVE is scoped to the top-level folders the app itself defines
# (`targets/`, `assets/`, `config/` — whatever `tower/app` has). Inside those the
# sync is the only writer, so a file the app stopped shipping is one an older
# copy left behind and the build would still glob. The clone's ROOT is shared
# territory — the runner's `brief/`, the heal's `.github/ISSUE_TEMPLATE/`, the
# roster's `data/repos.json` all sit there — and mirroring it would mean
# enumerating everything this function does NOT own, where the cost of an
# omission is deleting another step's work. So a root-level file the app
# retired is left alone. Emptied directories are left too: git tracks none of
# them, and a sweep that removed them could take a minted `.omega` tree with it.
#
# Returns 0 (something changed), 2 (already current), 1 (there was nothing to
# sync from — a named skip, and the caller builds the clone as it is), 3 (a
# write failed mid-walk and the clone is part-refreshed).
#
# Whether a MANIFEST was among what it wrote comes back in
# WK_HOME_SYNC_MANIFESTS, since the return code is already spoken for and a
# `$(…)` capture would only carry one of the two answers (issue #130). Call it
# DIRECTLY, the way publish.sh does — a sync run in a subshell says nothing.
WK_HOME_SYNC_MANIFESTS=0
wk_home_sync() {
  local src rel dest want tmp top topname found excluded name manifest prune=()
  local copied=0 removed=0 rc=0
  WK_HOME_SYNC_MANIFESTS=0

  wk_home_ready || {
    wk_say_skip "sync: nothing is cloned at $WK_HOME_DIR — the tower project was not refreshed"
    return 1
  }
  [[ -n "$WK_TOWER_APP" && -d "$WK_TOWER_APP" ]] || {
    wk_say_skip "sync: the tower app is not beside this engine (${WK_TOWER_APP:-no tower/app was found}) — $WK_HOME_DIR is left exactly as it is"
    return 1
  }

  # The walk's blindfold, built once and used on both sides. `-prune` is what
  # does it: on a directory it stops the descent, and on a plain file it simply
  # matches, so one list covers `node_modules` and `.env` alike.
  for name in "${WK_TOWER_APP_EXCLUDE[@]}"; do
    [[ "${#prune[@]}" -eq 0 ]] || prune+=(-o)
    prune+=(-name "$name")
  done

  tmp="$(mktemp -d)" || {
    wk_say_warn "sync: could not make a scratch directory — the tower project in $WK_HOME_DIR was not refreshed"
    return 1
  }

  # Everything the app ships, in.
  while IFS= read -r src; do
    rel="${src#"$WK_TOWER_APP"/}"
    dest="$WK_HOME_DIR/$rel"
    want="$src"
    manifest=0
    # A manifest is composed first, so the comparison below is against what
    # would LAND rather than against the checkout's own relative specs.
    if [[ "$(basename "$rel")" == 'package.json' ]]; then
      manifest=1
      want="$tmp/package.json"
      cp -p "$src" "$want" 2>/dev/null || {
        wk_say_warn "sync: could not stage $rel for comparison — the tower project in $WK_HOME_DIR is part-refreshed"
        rc=3
        break
      }
      if [[ "$rel" == 'package.json' ]]; then
        wk_home_project_manifest "$want" "$WK_TOWER_APP" --root
      else
        wk_home_project_manifest "$want" "$(dirname "$src")"
      fi
    fi
    cmp -s "$want" "$dest" 2>/dev/null && continue
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    # -p, so a file the project executes arrives with the mode it was written
    # with rather than whatever this shell's umask would have given it.
    cp -p "$want" "$dest" 2>/dev/null || {
      wk_say_warn "sync: could not write $rel into $WK_HOME_DIR"
      rc=3
      break
    }
    [[ "$manifest" -eq 1 ]] && WK_HOME_SYNC_MANIFESTS=1
    copied=$((copied + 1))
  done < <(find "$WK_TOWER_APP" \( "${prune[@]}" \) -prune -o -type f -print)

  # rc=3 is a PART-refreshed clone — a mid-walk write failed — and the caller
  # must not treat it as the benign "nothing to sync from" skip (rc=1): what
  # landed before the failure is real, and committing or building it publishes
  # half a refresh.
  rm -rf "$tmp"
  [[ "$rc" -eq 0 ]] || return "$rc"

  # And what the app retired, out — inside its own folders and nowhere else.
  for top in "$WK_TOWER_APP"/*/; do
    [[ -d "$top" ]] || continue
    topname="$(basename "$top")"
    excluded=0
    for name in "${WK_TOWER_APP_EXCLUDE[@]}"; do
      [[ "$topname" == "$name" ]] && { excluded=1; break; }
    done
    [[ "$excluded" -eq 0 ]] || continue
    [[ -d "$WK_HOME_DIR/$topname" ]] || continue

    while IFS= read -r found; do
      rel="${found#"$WK_HOME_DIR"/}"
      [[ -f "$WK_TOWER_APP/$rel" ]] && continue
      rm -f "$found" 2>/dev/null || {
        wk_say_warn "sync: could not remove the retired $rel from $WK_HOME_DIR"
        return 3
      }
      removed=$((removed + 1))
    done < <(find "$WK_HOME_DIR/$topname" \( "${prune[@]}" \) -prune -o -type f -print)
  done

  if [[ $((copied + removed)) -eq 0 ]]; then
    wk_say_skip "sync: the tower project in $WK_HOME_DIR is already current with $WK_TOWER_APP"
    return 2
  fi
  wk_say_ok "sync: refreshed the tower project in $WK_HOME_DIR ($copied file(s) from $WK_TOWER_APP, $removed retired)"
  return 0
}

# The cloud brief's runner, copied into the clone (issue #91).
#
# Unlike the project seed this runs on EVERY setup, empty clone or not: the
# scripts are the checkout's, they change with it, and a home repo running last
# month's runner is the failure this refresh exists to prevent. Idempotent by
# content — a file already identical is not rewritten, so a second setup writes
# nothing and leaves nothing to commit — and by SUBTRACTION too: what the
# manifest no longer names is removed (issue #117).
#
# Returns 0 (something changed), 2 (every file was already current), 1 (the
# checkout could not be read — nothing was written).
# The files under the clone's `brief/` that the manifest no longer names — one
# definition shared by the seed (which removes them) and the doctor (which
# counts them), so the two can never disagree on the word "current" (#117).
# Prints one absolute path per line; symlinks are deliberately invisible
# (`-type f` follows nothing), which is also what keeps the walk inside the
# clone.
wk_home_runner_retired() {
  local found rel keep pair
  [[ -d "$WK_HOME_DIR/brief" ]] || return 0
  while IFS= read -r found; do
    rel="${found#"$WK_HOME_DIR"/}"
    keep=0
    for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
      [[ "${pair#*:}" == "$rel" ]] && { keep=1; break; }
    done
    [[ "$keep" -eq 1 ]] && continue
    printf '%s\n' "$found"
  done < <(find "$WK_HOME_DIR/brief" -type f 2>/dev/null)
}

wk_home_seed_runner() {
  local pair src dest found rel changed=0 removed=0 missing=''

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

  # What the manifest stopped naming (issue #117). `brief/` in the clone is
  # ENGINE territory — the clone carries no config of its own under it — so a
  # file there the list does not name is one a rename left behind, and #107's
  # rename of the entry script is exactly that: a clone seeded before it would
  # keep the retired copy forever. Only `brief/` is walked; the workflow file
  # is replaced by content above and everything else in the clone is the
  # project's, never this function's to remove.
  if [[ -d "$WK_HOME_DIR/brief" ]]; then
    while IFS= read -r found; do
      rel="${found#"$WK_HOME_DIR"/}"
      rm -f "$found" 2>/dev/null || {
        wk_say_warn "home: could not remove the retired $rel from $WK_HOME_DIR"
        return 1
      }
      changed=$((changed + 1))
      removed=$((removed + 1))
    done < <(wk_home_runner_retired)
    # And the folders a removal emptied — deepest first, so a nested one goes
    # with its parent; rmdir refusing a folder that still holds something is
    # the check, which is why the failures are the ones ignored here.
    find "$WK_HOME_DIR/brief" -mindepth 1 -depth -type d -exec rmdir {} + >/dev/null 2>&1 || true
  fi

  if [[ -n "$missing" ]]; then
    wk_say_warn "home: this checkout is missing$missing — the cloud brief's runner is incomplete in $WK_HOME_DIR"
  fi
  if [[ "$changed" -eq 0 ]]; then
    wk_say_skip "home: the cloud brief's runner in $WK_HOME_DIR is current"
    return 2
  fi
  wk_say_ok "home: seeded the cloud brief's runner in $WK_HOME_DIR ($((changed - removed)) file(s) from $WK_KIT_DIR, $removed retired)"
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
  # INSIDE the clone, links resolved, and never with `--prefix` (issue #171,
  # the same defect publish.sh carried as #166): `~/.workkit` can be a symlink,
  # and npm given a prefix resolves the project through the link while keying
  # the tree from the CALLER'S cwd — a lockfile with package paths outside the
  # project root, a workspace that reads extraneous, and an arborist crash on
  # the next install. This is the FIRST install a machine ever runs, so the
  # corruption would be there from the start. `cd -P` makes the cwd physical.
  (cd -P "$WK_HOME_DIR" && npm install) >/dev/null 2>&1 || true
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
    (cd -P "$WK_HOME_DIR" && npm install) >/dev/null 2>&1 || true
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

  branch="$(wk_home_branch)"
  if git -C "$WK_HOME_DIR" push -q -u origin "$branch" 2>/dev/null; then
    return 0
  fi
  wk_say_warn "home: could not push $branch to origin — the commit is local; \`git -C $WK_HOME_DIR push\` reports why"
  return 1
}

# The clone's own heal (issue #123): the home repo gets the SAME standard every
# participating repo gets, from the same code, and only the trigger differs —
# the session hook heals a repo somebody opens, and nobody ever opens a session
# in the clone.
#
# Scoped to what makes a repo FILEABLE INTO: the labels every queue reads and
# the issue forms that apply them. None of the session-state scaffolding — the
# clone carries no `.workkit/`, no opt-in and no local files (issue #79) — which
# is why this is `standards.sh --home` rather than the whole heal.
#
# The labels are a REMOTE write and leave nothing in the tree; the forms are
# files. So the commit is asked for only when the FORMS changed, which is what
# makes the second run write nothing, commit nothing and push nothing.
#
# Every failure is a named warning and exit 0: this runs inside the morning, and
# a home repo that could not be healed costs the day nothing.
#
# Usage: wk_home_heal [--quiet]
#   --quiet keeps the heal's own step-by-step lines out of an unattended log,
#   the way the daily publish keeps its own: they are held and printed only when
#   the run failed or actually changed something, which is the only morning
#   where there is anything to read.
wk_home_heal() {
  local quiet=0 rc=0 out changed=0
  [[ "${1:-}" == '--quiet' ]] && quiet=1
  wk_home_ready || {
    wk_say_warn "home: nothing is cloned at $WK_HOME_DIR — the home repo's labels and issue templates were not healed; \`workkit setup\` clones it"
    return 0
  }
  [[ -n "$WK_WORKFLOW_DIR" && -f "$WK_WORKFLOW_DIR/standards.sh" ]] || {
    wk_say_warn "home: the heal is missing at ${WK_WORKFLOW_DIR:-this engine}/standards.sh — the home repo's labels and issue templates were not healed"
    return 0
  }

  # The heal speaks on stderr; it is captured so a quiet run can decide whether
  # this morning has anything worth saying.
  out="$(bash "$WK_WORKFLOW_DIR/standards.sh" --home "$WK_HOME_DIR" 2>&1)" || rc=$?

  # The question is asked of the FORMS and of nothing else: they are the only
  # thing this heal writes into the tree (the labels are a remote write), and a
  # heal that read the whole tree would commit somebody's half-finished edit
  # under a message about templates. Whatever else is dirty still rides the
  # commit when there IS one — that is `wk_home_commit_push`'s contract, the
  # same one the daily roster push already lives with.
  if [[ -n "$(git -C "$WK_HOME_DIR" status --porcelain -- .github/ISSUE_TEMPLATE 2>/dev/null)" ]]; then
    changed=1
  fi

  # A past run whose push failed left a commit stranded local — that is a change
  # too: commit_push skips the empty commit and pushes what stayed behind.
  if [[ "$changed" -eq 0 ]]; then
    local ahead
    ahead="$(git -C "$WK_HOME_DIR" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 0)"
    [[ "${ahead:-0}" -gt 0 ]] && changed=1
  fi

  if [[ -n "$out" ]] && [[ "$quiet" -eq 0 || "$rc" -ne 0 || "$changed" -eq 1 ]]; then
    printf '%s\n' "$out" >&2
  fi
  if [[ "$rc" -ne 0 ]]; then
    wk_say_warn "home: the heal of $WK_HOME_DIR did not finish — see the warning above; it runs again tomorrow"
  fi

  [[ "$changed" -eq 1 ]] || return 0
  # commit_push already names which half failed; the morning carries on either
  # way, and the ahead-of-origin check above pushes what stayed local tomorrow.
  wk_home_commit_push 'chore(home): install the issue templates' || true
  return 0
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
    wk_home_heal
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
  wk_home_heal
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
# Since issue #143 the morning reconciles the copy itself — `jobs/morning.sh`
# calls `wk_home_seed_runner` every day, ahead of the dispatch — so what this
# reports is drift the last morning could not heal: a machine whose job has not
# run yet, or one whose home clone the reconcile named a skip on. It only ever
# READS, and the fix it names is `workkit setup`, the one command that also
# clones and creates.
#
# Returns 1 when the seeded copy is behind, 0 otherwise (current, or a skip).
wk_home_runner_doctor() {
  local pair src dest behind=0 compared=0 retired=0

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

  # Current means what the seed would leave alone — so a retired file awaiting
  # the prune is drift too, counted through the same lister the seed removes
  # from (#117).
  retired=$(wk_home_runner_retired | awk 'END { print NR }')

  if [[ "$behind" -gt 0 || "$retired" -gt 0 ]]; then
    local detail="$behind of $compared file(s) differ"
    [[ "$retired" -gt 0 ]] && detail="$detail, $retired retired file(s) await pruning"
    wk_say_warn "runner: the home repo's brief runner is behind this checkout ($detail) — run \`workkit setup\`"
    return 1
  fi
  wk_say_ok "runner: the cloud brief's runner in $WK_HOME_DIR is current with this checkout"
  return 0
}
