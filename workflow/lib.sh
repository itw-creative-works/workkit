#!/usr/bin/env bash
# workflow/lib.sh: the engine's shared helpers. SOURCED, never executed.
#
# Three things every part of the home-repo machinery needs and none of them owns:
# where the user's workflow folder is, how to edit a JSON file without losing it,
# and how to say something in whatever voice the caller already speaks.
#
# It sets no shell options: a sourced file that turned on `set -e` would change
# the behavior of the script that sourced it. Two things happen at load, both of
# them reading the environment and writing only their own answer: `wk_palette`,
# so a caller speaks in the right colors from its very first line, and the MSYS
# symlink flag below, so every `ln -s` the engine makes is a link on Windows.
#
# The functions live in lib/, one file per group, each sourced where its
# section sits below: lib/voice.sh (the style and the voice), lib/flows.sh (the
# browser flows and the link maker) and lib/state.sh (the JSON edit and the
# state mutex). This file keeps the addresses and every line that runs at load,
# each after the source that defines what it calls.

# ── Platform ──────────────────────────────────────────────────────────────────
# The spellings that differ per platform, sourced FIRST so every script that
# sources this file has `wk_jq` before it reads any JSON. They sit in their own
# file rather than here because the HOOKS need the same answers and source that
# file directly (hooks/_lib.sh), and a hook has no business loading the engine's
# addresses, its palette and its mutex to strip a carriage return.
# shellcheck source=./platform.sh
. "${BASH_SOURCE[0]%/*}/platform.sh"

# ── Participation ─────────────────────────────────────────────────────────────
# Is a directory a repo root, and what does a settings file's `enabled` key say:
# the two predicates every reader of a repo's participation asks. Its own file
# beside platform.sh, and for the same reason: the hooks ask both questions too
# and source it directly, and a hook has no business loading the addresses below
# to test a path for `.git`.
# shellcheck source=./participation.sh
. "${BASH_SOURCE[0]%/*}/participation.sh"

# ── Slugs ─────────────────────────────────────────────────────────────────────
# What a repo is called: `owner/repo` out of a remote URL, and out of a working
# tree's origin. Its own file beside the two above, and for the same reason: a
# HOOK names a repo too (safety/release-taken's bounce) and sources it directly,
# and a hook has no business loading the addresses below to read an origin.
# shellcheck source=./slug.sh
. "${BASH_SOURCE[0]%/*}/slug.sh"

# ── The addresses ─────────────────────────────────────────────────────────────
# The user's workflow folder: a PLAIN folder and never a git repo (issue #77).
# It holds this machine's own state and nothing versioned: the site options, the
# roster, the declines, the id cache, and the job state under jobs/.
# WORKFLOW_HOME is the same override the rest of the engine honors. The suite
# points it at a fixture, so nothing here ever reaches the real one.
WK_USER_DIR="${WORKFLOW_HOME:-${HOME:-}/.workkit}"

# Three files, split by WHO WRITES THEM (issue #80).
#
# settings.json is HAND-EDITED: `version` and one nested `site` key, the home
# repo's slug (`site.repo`), the all-or-nothing publish switch (`site.publish`)
# and the custom domain (`site.url`). The site options live here rather than in
# the clone because the clone is engine territory and is never hand-edited
# (issue #79); setup writes `site.repo` once and nothing else in this file is
# ever written by a machine.
WK_HOME_SETTINGS="$WK_USER_DIR/settings.json"
# .repos.json is MACHINE-MAINTAINED: the roster the heal registers and the
# declines the CLI records, under one `repos` map. Dot-named because it is not
# the owner's to edit. The engine rewrites it on contact.
WK_HOME_REPOS="$WK_USER_DIR/.repos.json"
# .cache.json is DISPOSABLE: the Discussions GraphQL ids, and since issue #86
# nothing else. The upstream-news cursor moved onto the board, where a job that
# runs from anywhere can read it. Deleting the file costs one round trip; every
# reader rebuilds what it does not find.
WK_HOME_CACHE="$WK_USER_DIR/.cache.json"

# The ONE git repo in the global layer: the clone of `<login>/workkit`, seeded
# from this checkout's tower/app and shaped like every other omega site project.
# Everything versioned lives inside it, so the folder above stays a plain one.
WK_HOME_DIR="$WK_USER_DIR/tower"
# The one target in the brand root, and the build output it leaves. Proved
# against the real tower/app 2026-07-29: `omega build` is a command of
# @omega.js/web and resolves only inside the TARGET (at the brand root the
# `omega` bin dispatches to @omega.js/manager, which has no build), and it
# writes `dist/` beside src/.
WK_HOME_TARGET="$WK_HOME_DIR/targets/web"
WK_HOME_DIST="$WK_HOME_TARGET/dist"

# ── Style ─────────────────────────────────────────────────────────────────────
# The color gate (`wk_color_on`), the palette, the line shape and its levels,
# the headings, the relay strip and the spinner are functions in lib/voice.sh,
# sourced here, BEFORE anything below calls one. What they read is set right
# after it: the palette variables, the indent and the spinner frames.
# shellcheck source=./lib/voice.sh
. "${BASH_SOURCE[0]%/*}/lib/voice.sh"

# The codes are BACKSLASH literals rather than real escapes: each is used inside
# a printf FORMAT string, which is what expands them, and the empty string is
# what a no-color run interpolates instead.
WK_C_GREEN='' WK_C_YELLOW='' WK_C_RED='' WK_C_CYAN='' WK_C_MAGENTA='' WK_C_DIM='' WK_C_BOLD='' WK_C_OFF=''

# The indent a level line carries. A title or a section sets it to two spaces,
# so the steps that follow sit under the heading they belong to; a script that
# prints neither (the heal, the jobs) sets it itself where it wants one.
WK_LOG_INDENT=''

# omega's spinner frames (that monorepo's `packages/devkit/src/flows.js`): an
# animation on a terminal, redrawn in place and erased when the call returns, so
# it never reaches a log file, a pipe or a captured payload.
WK_SPIN_FRAMES=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

# ── Browser flows ─────────────────────────────────────────────────────────────
# The Enter gate, the poll and its countdown, and the link maker the next
# section's flag serves are functions in lib/flows.sh.
# shellcheck source=./lib/flows.sh
. "${BASH_SOURCE[0]%/*}/lib/flows.sh"

# WK_POLL_PID is the draw job wk_poll started, a global so the interrupt trap
# reaches it too.
WK_POLL_PID=''

wk_palette

# ── Real symlinks on Windows ──────────────────────────────────────────────────
# Git Bash answers a plain `ln -s` with a COPY and exit 0 unless the MSYS
# runtime is told otherwise, and a copy of the engine at `~/.claude/workkit` is
# worse than no address at all: the marker scripts the skills call sit one level
# ABOVE the engine folder (#245), so a copy hides them. Every `ln -s` the engine
# makes goes through a script that sources this file (the engine address in
# standards.sh, the `~/.local/bin/workkit` command in workkit.sh), so the flag
# has one home here rather than one copy per call.
# MSYS reads a space-separated flag list, so the flag is appended to whatever
# the environment already set, and only once however many times this is sourced.
# The dotfiles' setup/lib/helpers.sh carries the same three lines for the same
# reason: same mechanism, both sides.
case "${OSTYPE:-}" in
  msys*|cygwin*)
    [[ " ${MSYS:-} " == *" winsymlinks:nativestrict "* ]] \
      || export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"
    ;;
esac

# ── JSON ──────────────────────────────────────────────────────────────────────
# The safe jq write (`wk_json_edit`), the one-value read (`wk_json_get`) and the
# mutex's take and drop are functions in lib/state.sh.
# shellcheck source=./lib/state.sh
. "${BASH_SOURCE[0]%/*}/lib/state.sh"

# ── The state mutex ───────────────────────────────────────────────────────────
# Every machine-written file here is edited by a whole-file read-modify-write,
# and two runs doing that at once keep only the last writer's change. A
# decline, a roster registration, the cached node ids, the home slug: whichever
# lost is simply gone. mkdir is the atomic mutex, and EVERY writer takes this
# one, which is why it lives here rather than in any of them. ONE lock covers
# all three files: the writers are the same handful of runs, and a lock per file
# would only trade a rare wait for three ways to get the pairing wrong.
WK_STATE_LOCK="$WK_USER_DIR/.state.lock"
