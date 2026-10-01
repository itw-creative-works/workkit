#!/usr/bin/env bash
# workflow/home.sh: the home repo's lifecycle, sourced and never executed.
# Keeps the constants and the cloud runner list; the stages live in home/.
# Only `workkit setup` creates the repo, the clone and its services; see
# workflow/README.md § The home repo's lifecycle. Needs lib.sh and
# discussions.sh sourced first.

# One name, so a second machine running setup finds the repo that exists.
WK_HOME_REPO_NAME='workkit'

# Pages serves this branch's root, so no build output is committed as source.
WK_HOME_PAGES_BRANCH='gh-pages'

# The seed's source: this checkout's tower/app is the template, resolved from
# the engine's own location. The override is the suite's seam.
WK_TOWER_APP="${WORKKIT_TOWER_APP:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../tower/app" 2>/dev/null && pwd -P || printf '')}"

# What a copy of the app never carries: `tower/app/.gitignore` plus `.git` and
# `.DS_Store`, matched by name at every depth. One list for the seed and the
# sync on both sides, so they agree on what the project is.
WK_TOWER_APP_EXCLUDE=(node_modules package-lock.json .omega .cache .temp dist .env '.env.*' logs .git .DS_Store)

# The gitignore's own `!` lines, root names only: what the exclusions would take
# that the copy still needs.
WK_TOWER_APP_KEEP=(.env.example)

# The engine's own folder, where standards.sh (the clone's heal) sits. Resolved
# from this file, since the engine travels as a folder.
WK_WORKFLOW_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P || printf '')"

# The plugin checkout: the source of the cloud brief's runner. The override is
# the suite's seam.
WK_KIT_DIR="${WORKKIT_KIT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd -P || printf '')}"

# The cloud brief's runner, as relative `src:dest` pairs (README § The home
# repo's lifecycle, step 5): the require closure of brief-payload.js plus what
# morning.sh sources on the cloud path. A new require means a new line here.
WK_HOME_RUNNER_FILES=(
  'workflow/templates/github-workflows/brief.yml:.github/workflows/brief.yml'
  'jobs/morning.sh:brief/jobs/morning.sh'
  'jobs/morning/brief-publish.sh:brief/jobs/morning/brief-publish.sh'
  'jobs/morning/brief/brief-payload.js:brief/jobs/morning/brief/brief-payload.js'
  'jobs/morning/brief/cc-news.js:brief/jobs/morning/brief/cc-news.js'
  'jobs/morning/brief/stats.js:brief/jobs/morning/brief/stats.js'
  'workflow/lib/platform.sh:brief/workflow/lib/platform.sh'
  'workflow/lib/participation.sh:brief/workflow/lib/participation.sh'
  'workflow/lib/slug.sh:brief/workflow/lib/slug.sh'
  'workflow/lib/suite.sh:brief/workflow/lib/suite.sh'
  'workflow/lib/changelog.sh:brief/workflow/lib/changelog.sh'
  'workflow/lib/detach.sh:brief/workflow/lib/detach.sh'
  'workflow/slug.js:brief/workflow/slug.js'
  'workflow/user-dir.js:brief/workflow/user-dir.js'
  'workflow/ship/semver.js:brief/workflow/ship/semver.js'
  'workflow/lib.sh:brief/workflow/lib.sh'
  'workflow/lib/voice.sh:brief/workflow/lib/voice.sh'
  'workflow/lib/flows.sh:brief/workflow/lib/flows.sh'
  'workflow/lib/state.sh:brief/workflow/lib/state.sh'
  'workflow/lib/discussions.sh:brief/workflow/lib/discussions.sh'
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
  'tower/app/targets/web/src/assets/js/libs/tower/github/sweep.js:brief/tower/app/targets/web/src/assets/js/libs/tower/github/sweep.js'
  'tower/api/lib/health.js:brief/tower/api/lib/health.js'
  'tower/api/lib/brief.js:brief/tower/api/lib/brief.js'
  'tower/api/lib/summaries.js:brief/tower/api/lib/summaries.js'
  'tower/api/lib/history.js:brief/tower/api/lib/history.js'
)

# The kit version the clone was last written from: one file at the root for
# every writer, since they all seed from one checkout. README § The home repo's
# lifecycle, "The seed never downgrades".
WK_HOME_STAMP='.workkit-version'

# wk_home_sync's second answer (home/seed.sh): 1 when the last sync wrote a
# manifest.
WK_HOME_SYNC_MANIFESTS=0

# The categories the last wk_home_categories_present poll found missing
# (home/services.sh), the pointer wk_home_discussions names when it gives up.
WK_HOME_MISSING_CATEGORIES=''

# One file per stage, functions only, resolved from this file's own folder and
# never from a caller's SCRIPT_DIR.
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
