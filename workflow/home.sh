#!/usr/bin/env bash
# workflow/home.sh: the home repo's lifecycle. SOURCED, never executed.
#
# `~/.workkit` is a PLAIN folder holding this machine's own state, and it is
# never a git repo (issue #77). The one git repo in the global layer is
# `~/.workkit/tower`: the clone of a private `<login>/workkit`, seeded from
# this checkout's `tower/app` and shaped like every other omega site project:
# a brand root with `targets/`, `config/` and its own `.gitignore`.
#
# The boundary is the folder, not a .gitignore:
#   ~/.workkit/          settings.json (the site options, hand-edited),
#                        .repos.json (the roster and the declines) and
#                        .cache.json (the ids and cursors), one machine's own
#                        knowledge, never travelling
#   ~/.workkit/tower/    the project, and only the project: engine territory,
#                        never hand-edited and carrying no `.workkit/` of its own
#
# The built site never lands on main at all: it is pushed to the repo's
# `gh-pages` branch, which Pages serves from the branch root.
#
# WHO CREATES WHAT. Creating the repo, cloning it, seeding it (the tower
# project, and since issue #91 the cloud brief's runner and its workflow),
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
# is no stored second template: the app IS the template. The override is the
# suite's seam.
WK_TOWER_APP="${WORKKIT_TOWER_APP:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../tower/app" 2>/dev/null && pwd -P || printf '')}"

# What a copy of that app must never carry: the trees a working checkout
# accretes, which is exactly what `tower/app/.gitignore` names. ONE list, read
# by the seed's tar exclusions and by the sync's walk on both sides (issue
# #129), so the two can never disagree about what "the project" is. Matched by
# NAME at every depth: a nested `node_modules` under `targets/*` is the same
# answer as the one at the root. `.git` and `.DS_Store` ride along beyond the
# gitignore: the app has no `.git` and the clone's is never the sync's to look
# inside, and `.DS_Store` is Finder litter no copy should carry.
WK_TOWER_APP_EXCLUDE=(node_modules package-lock.json .omega .cache .temp dist .env '.env.*' logs .git .DS_Store)

# What the exclusions would take that the copy still needs: the gitignore's own
# `!` lines. `.env.*` is every environment overlay, and the example beside them
# is the template the README points at, a secret in shape and not in content.
# Root names only: the exclusions hold at every depth, the keeps at the top.
WK_TOWER_APP_KEEP=(.env.example)

# The engine's own folder: where standards.sh sits, the script the clone's heal
# is a scoped invocation of. Resolved from this file rather than from the kit
# dir, because the engine travels as a folder and the heal is the engine's.
WK_WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || printf '')"

# The plugin checkout this engine is part of: the source of the cloud brief's
# runner, the way tower/app is the source of the project. Resolved the same way,
# and overridden the same way for the suite.
WK_KIT_DIR="${WORKKIT_KIT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd -P || printf '')}"

# The cloud brief's runner, seeded into the home repo (issue #91).
#
# `.github/workflows/brief.yml` and its secrets cannot live on the plugin repo:
# that repo is distributed to everyone who installs the kit, and a consumer
# cannot set secrets on a repo they do not own. So the workflow runs on the
# HOME repo, and the code it runs is copied there: the checkout stays the one
# source, and the copy is refreshed from it by `workkit setup` and by every
# morning run (issue #143), so a checkout that moved on is a day behind at most.
#
# `src:dest` pairs, both relative. Everything but the workflow file lands under
# one folder with its checkout-relative subpath intact, so every relative
# address inside those scripts, `../workflow` for the engine libraries,
# `../tower/api/lib` for the composers' requires, and board.js's reach across
# into the app's shared sweep module (issue #195), resolves in the clone
# exactly as it does here. The list IS the require closure of brief-payload.js
# plus what morning.sh sources on the cloud path; a new require means a new
# line here.
WK_HOME_RUNNER_FILES=(
  'workflow/templates/github-workflows/brief.yml:.github/workflows/brief.yml'
  'jobs/morning.sh:brief/jobs/morning.sh'
  'jobs/morning/summaries.sh:brief/jobs/morning/summaries.sh'
  'jobs/morning/runner.sh:brief/jobs/morning/runner.sh'
  'jobs/morning/brief.sh:brief/jobs/morning/brief.sh'
  'jobs/morning/publish.sh:brief/jobs/morning/publish.sh'
  'jobs/morning/marker.sh:brief/jobs/morning/marker.sh'
  'jobs/brief-publish.sh:brief/jobs/brief-publish.sh'
  'jobs/brief-payload.js:brief/jobs/brief-payload.js'
  'jobs/cc-news.js:brief/jobs/cc-news.js'
  'jobs/stats.js:brief/jobs/stats.js'
  'workflow/platform.sh:brief/workflow/platform.sh'
  'workflow/participation.sh:brief/workflow/participation.sh'
  'workflow/slug.sh:brief/workflow/slug.sh'
  'workflow/slug.js:brief/workflow/slug.js'
  'workflow/semver.js:brief/workflow/semver.js'
  'workflow/lib.sh:brief/workflow/lib.sh'
  'workflow/lib/voice.sh:brief/workflow/lib/voice.sh'
  'workflow/lib/flows.sh:brief/workflow/lib/flows.sh'
  'workflow/lib/state.sh:brief/workflow/lib/state.sh'
  'workflow/discussions.sh:brief/workflow/discussions.sh'
  'workflow/home.sh:brief/workflow/home.sh'
  'workflow/home/options.sh:brief/workflow/home/options.sh'
  'workflow/home/repo.sh:brief/workflow/home/repo.sh'
  'workflow/home/stamp.sh:brief/workflow/home/stamp.sh'
  'workflow/home/seed.sh:brief/workflow/home/seed.sh'
  'workflow/home/runner.sh:brief/workflow/home/runner.sh'
  'workflow/home/install.sh:brief/workflow/home/install.sh'
  'workflow/home/services.sh:brief/workflow/home/services.sh'
  'workflow/home/wizard.sh:brief/workflow/home/wizard.sh'
  'workflow/home/doctor.sh:brief/workflow/home/doctor.sh'
  'tower/api/lib/repos.js:brief/tower/api/lib/repos.js'
  'tower/api/lib/board.js:brief/tower/api/lib/board.js'
  'tower/app/targets/web/src/assets/js/libs/tower/sweep.js:brief/tower/app/targets/web/src/assets/js/libs/tower/sweep.js'
  'tower/api/lib/health.js:brief/tower/api/lib/health.js'
  'tower/api/lib/brief.js:brief/tower/api/lib/brief.js'
  'tower/api/lib/summaries.js:brief/tower/api/lib/summaries.js'
  'tower/api/lib/history.js:brief/tower/api/lib/history.js'
)

# The kit version the clone was last written FROM, in one file at its root.
#
# Every writer below seeds content this checkout owns over the clone's, so two
# machines seeding one clone race, and before the stamp the winner was simply
# whichever ran last, which is how a machine on an older kit put a month-old
# runner and a pre-rename app back on the home repo three mornings running
# (issue #200). The stamp rides in the same commit as the content it describes,
# so the clone always says which kit wrote what is in it, and a checkout OLDER
# than the stamp writes nothing at all.
#
# ONE file for all of them, because they all seed from one checkout: a stamp per
# writer would let the answer to "which kit is this clone at?" disagree with
# itself. It sits at the ROOT, which is shared territory the project sync never
# prunes.
WK_HOME_STAMP='.workkit-version'

# wk_home_sync's second answer (home/seed.sh): 1 when a manifest was among what
# the last sync wrote. Its comment there says why it is not the return code.
WK_HOME_SYNC_MANIFESTS=0

# The categories the last wk_home_categories_present poll found missing
# (home/services.sh), the pointer wk_home_discussions names when it gives up.
WK_HOME_MISSING_CATEGORIES=''

# The functions, one file per stage under home/. Each defines functions and sets
# nothing, so every constant above is still this file's own, defined before
# anything calls into a piece. Resolved from WK_WORKFLOW_DIR, this file's own
# folder, never from a caller's SCRIPT_DIR. Sourcing runs nothing.
# shellcheck source=./home/options.sh
. "$WK_WORKFLOW_DIR/home/options.sh"
# shellcheck source=./home/repo.sh
. "$WK_WORKFLOW_DIR/home/repo.sh"
# shellcheck source=./home/stamp.sh
. "$WK_WORKFLOW_DIR/home/stamp.sh"
# shellcheck source=./home/seed.sh
. "$WK_WORKFLOW_DIR/home/seed.sh"
# shellcheck source=./home/runner.sh
. "$WK_WORKFLOW_DIR/home/runner.sh"
# shellcheck source=./home/install.sh
. "$WK_WORKFLOW_DIR/home/install.sh"
# shellcheck source=./home/services.sh
. "$WK_WORKFLOW_DIR/home/services.sh"
# shellcheck source=./home/wizard.sh
. "$WK_WORKFLOW_DIR/home/wizard.sh"
# shellcheck source=./home/doctor.sh
. "$WK_WORKFLOW_DIR/home/doctor.sh"
