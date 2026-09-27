#!/usr/bin/env bash
# workflow/lib.sh: the engine's shared helpers, sourced and never executed.
# Keeps the addresses and every line that runs at load; the function groups
# live in lib/. Sets no shell options, since a sourced `set -e` would change
# its caller.

# ── Platform ──────────────────────────────────────────────────────────────────
# Sourced first, so every caller has `wk_jq` before it reads any JSON.
# shellcheck source=./lib/platform.sh
. "${BASH_SOURCE[0]%/*}/lib/platform.sh"

# ── Participation ─────────────────────────────────────────────────────────────
# shellcheck source=./lib/participation.sh
. "${BASH_SOURCE[0]%/*}/lib/participation.sh"

# ── Slugs ─────────────────────────────────────────────────────────────────────
# shellcheck source=./lib/slug.sh
. "${BASH_SOURCE[0]%/*}/lib/slug.sh"

# ── The addresses ─────────────────────────────────────────────────────────────
# The user's workflow folder: a plain folder of this machine's own state, never
# a git repo. The suite points WORKFLOW_HOME at a fixture.
WK_USER_DIR="${WORKFLOW_HOME:-${HOME:-}/.workkit}"

# Three files, split by who writes them: README § The two settings files.
WK_HOME_SETTINGS="$WK_USER_DIR/settings.json"
WK_HOME_REPOS="$WK_USER_DIR/.repos.json"
WK_HOME_CACHE="$WK_USER_DIR/.cache.json"

# The one git repo in the global layer: the clone of `<login>/workkit`.
WK_HOME_DIR="$WK_USER_DIR/tower"
# `omega build` resolves only inside the target, not at the brand root
# (README § Publishing the dashboard).
WK_HOME_TARGET="$WK_HOME_DIR/targets/web"
WK_HOME_DIST="$WK_HOME_TARGET/dist"

# ── Style ─────────────────────────────────────────────────────────────────────
# Sourced before anything below calls one; what the functions read is set after.
# shellcheck source=./lib/voice.sh
. "${BASH_SOURCE[0]%/*}/lib/voice.sh"

# Backslash literals, not real escapes: each is expanded by the printf format
# string it is used in, and a no-color run interpolates the empty string.
WK_C_GREEN='' WK_C_YELLOW='' WK_C_RED='' WK_C_CYAN='' WK_C_MAGENTA='' WK_C_DIM='' WK_C_BOLD='' WK_C_OFF=''

# The indent a level line carries: a title or a section sets it, and a script
# that prints neither sets it itself.
WK_LOG_INDENT=''

# omega's spinner frames (that monorepo's `packages/devkit/src/flows.js`).
WK_SPIN_FRAMES=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

# ── Browser flows ─────────────────────────────────────────────────────────────
# shellcheck source=./lib/flows.sh
. "${BASH_SOURCE[0]%/*}/lib/flows.sh"

# The draw job wk_poll started, a global so the interrupt trap reaches it too.
WK_POLL_PID=''

wk_palette

# ── Real symlinks on Windows ──────────────────────────────────────────────────
# Git Bash makes `ln -s` a copy unless MSYS says otherwise (docs/hooks.md
# § Platforms). Appended once to MSYS's space-separated list, however many
# times this is sourced.
case "${OSTYPE:-}" in
  msys*|cygwin*)
    [[ " ${MSYS:-} " == *" winsymlinks:nativestrict "* ]] \
      || export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"
    ;;
esac

# ── JSON ──────────────────────────────────────────────────────────────────────
# shellcheck source=./lib/state.sh
. "${BASH_SOURCE[0]%/*}/lib/state.sh"

# ── The state mutex ───────────────────────────────────────────────────────────
# One lock for all three files, taken by every writer: each edit is a
# whole-file read-modify-write, and two at once keep only the last change.
WK_STATE_LOCK="$WK_USER_DIR/.state.lock"
