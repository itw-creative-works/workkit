#!/bin/bash
# hooks/_lib.sh: the helpers every hook sources, never executes:
#   . "${BASH_SOURCE[0]%/*}/../../_lib.sh"   (from a depth-2 hook dir)
# Helpers fail toward the safe side for guards. The constants, the platform
# seam, hook_jq and the engine sources live here; the helper groups live one
# file per concern under hooks/lib/, sourced at the foot. Add a helper only
# with a second named consumer.

# The hook layer's copy of the state directory name; the engine and the test
# harness hold their own, and a test asserts all three agree.
WORKKIT_DIR=".workkit"

# A release subject's version, as an ERE: commit-language and release-taken
# both read it, so one hook never accepts a release the other misses.
readonly HOOK_VERSION_RE='v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?'

# The AGENTS.md budget: board-guard bounces a write past it and state-check
# announces a file past it, both measuring through hook_agents_budget.
readonly HOOK_AGENTS_MAX_LINES=250
readonly HOOK_AGENTS_MAX_BYTES=400

# A system-delivered prompt's shapes, as EREs bash `[[ =~ ]]` and jq `test()`
# both read: hook_prompt_is_system and close-guard's jq pass take them from
# here. An opening tag other than the owner's paste, or a frame line anywhere.
readonly HOOK_PROMPT_TAG_RE='^[[:space:]]*<[A-Za-z][A-Za-z0-9_.:-]*>'
readonly HOOK_PROMPT_PASTE_RE='^[[:space:]]*<pasted_content'
readonly HOOK_PROMPT_FRAME_RE='\[SYSTEM NOTIFICATION - NOT USER INPUT\]|Another Claude session sent a message|<agent-message |\[Subagent hand-back\]'

# This file's physical folder, resolved once for every source line below: each
# lookup is a fork, slow on Windows. A bare `. _lib.sh` has no folder to strip.
HOOK_LIB_DIR="${BASH_SOURCE[0]%/*}"
[ "$HOOK_LIB_DIR" != "${BASH_SOURCE[0]}" ] || HOOK_LIB_DIR="."
HOOK_LIB_DIR="$(cd "$HOOK_LIB_DIR" && pwd -P)"

# The platform split, $OSTYPE first so it costs no fork and needs no PATH
# (docs/hooks.md § Platforms). Cached: a process cannot change platform.
hook_uname_s() {
  [ -n "${HOOK_UNAME_S:-}" ] && return 0
  case "${OSTYPE:-}" in
    darwin*) HOOK_UNAME_S="Darwin" ;;
    msys*|cygwin*) HOOK_UNAME_S="MSYS" ;;
    linux*) HOOK_UNAME_S="Linux" ;;
    *) HOOK_UNAME_S="$(uname -s 2>/dev/null)"; [ -n "$HOOK_UNAME_S" ] || HOOK_UNAME_S="unknown" ;;
  esac
}
hook_is_macos() { hook_uname_s; [ "$HOOK_UNAME_S" = "Darwin" ]; }
hook_is_windows() {
  hook_uname_s
  case "$HOOK_UNAME_S" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac
}
hook_is_linux() { hook_uname_s; [ "$HOOK_UNAME_S" = "Linux" ]; }

# hook_jq: the CRLF-safe jq; the body is wk_jq in workflow/lib/platform.sh
# (docs/hooks.md § Platforms). Sourced unguarded off this file's physical
# path: the two ship together, and a missing engine fails loudly at load.
# shellcheck source=../workflow/lib/platform.sh
. "$HOOK_LIB_DIR/../workflow/lib/platform.sh"
hook_jq() { wk_jq "$@"; }
# hook_jq_default <default> <jq args...>: wk_jq_default under the hook name.
hook_jq_default() { wk_jq_default "$@"; }
# hook_sha1: the one digest; the body is wk_sha1, since the engine keys the
# suite and qa records with it too.
hook_sha1() { wk_sha1 "$@"; }

# The participation predicates (wk_is_repo_root, wk_settings_declined,
# wk_settings_enabled) keep their engine names: every hook that loads this
# library, the dotfiles hooks too, calls the one name, and a second name for
# one predicate drifts.
# shellcheck source=../workflow/lib/participation.sh
. "$HOOK_LIB_DIR/../workflow/lib/participation.sh"

# The slug rule (wk_slug_from_remote, wk_repo_slug), engine names for the same
# reason; release-taken reads it rather than parsing an origin of its own.
# shellcheck source=../workflow/lib/slug.sh
. "$HOOK_LIB_DIR/../workflow/lib/slug.sh"

# The proved-tree records (wk_tree_hash, wk_suite_proved, wk_qa_proved and the
# rest), engine names for the same reason.
# shellcheck source=../workflow/lib/suite.sh
. "$HOOK_LIB_DIR/../workflow/lib/suite.sh"

# The changelog job helpers, engine names; commit-gate's heal-bookkeeping arms
# read them to prove a commit is exactly the heal's output.
# shellcheck source=../workflow/changelog/changelog-job.sh
. "$HOOK_LIB_DIR/../workflow/changelog/changelog-job.sh"

# The CHANGELOG format check (wk_changelog_lint and its linter), engine names;
# commit-gate check 3 and docs/changelog-guard share it with script-shell.sh.
# shellcheck source=../workflow/lib/changelog.sh
. "$HOOK_LIB_DIR/../workflow/lib/changelog.sh"

# The helper groups: each defines functions and sets nothing, so sourcing runs
# nothing and every name they read is defined above.
# shellcheck source=./lib/markers.sh
. "$HOOK_LIB_DIR/lib/markers.sh"
# shellcheck source=./lib/commit.sh
. "$HOOK_LIB_DIR/lib/commit.sh"
# shellcheck source=./lib/manager.sh
. "$HOOK_LIB_DIR/lib/manager.sh"
# shellcheck source=./lib/proof.sh
. "$HOOK_LIB_DIR/lib/proof.sh"
# shellcheck source=./lib/notice.sh
. "$HOOK_LIB_DIR/lib/notice.sh"
# shellcheck source=./lib/deadline.sh
. "$HOOK_LIB_DIR/lib/deadline.sh"
# shellcheck source=./lib/paths.sh
. "$HOOK_LIB_DIR/lib/paths.sh"
# shellcheck source=./lib/suite.sh
. "$HOOK_LIB_DIR/lib/suite.sh"
# shellcheck source=./lib/agents.sh
. "$HOOK_LIB_DIR/lib/agents.sh"
# shellcheck source=./lib/tree.sh
. "$HOOK_LIB_DIR/lib/tree.sh"
# shellcheck source=./lib/gh-edit.sh
. "$HOOK_LIB_DIR/lib/gh-edit.sh"
# shellcheck source=./lib/snapshot.sh
. "$HOOK_LIB_DIR/lib/snapshot.sh"
# shellcheck source=./lib/prompt.sh
. "$HOOK_LIB_DIR/lib/prompt.sh"
