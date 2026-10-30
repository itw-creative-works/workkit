#!/bin/bash
# hooks/_lib.sh: the hook library's entry, sourced and never executed, by the
# shell that still needs it: workflow/{review,triage,proof}/*.sh, workflow/prove.sh, snapshot.sh's
# entry and the dotfiles hooks. The constants, the platform seam, hook_jq and the engine sources live
# here; the helper groups live one file per concern under hooks/lib/, sourced
# at the foot. Add a helper only with a second named consumer.

# The hook layer's copy of the state directory name; the engine and the test
# harness hold their own, so change all three together.
WORKKIT_DIR=".workkit"

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
# suite and package records with it too.
hook_sha1() { wk_sha1 "$@"; }

# The participation predicates (wk_is_repo_root, wk_settings_declined,
# wk_settings_enabled) keep their engine names: every hook that loads this
# library, the dotfiles hooks too, calls the one name, and a second name for
# one predicate drifts.
# shellcheck source=../workflow/lib/participation.sh
. "$HOOK_LIB_DIR/../workflow/lib/participation.sh"

# The slug rule (wk_slug_from_remote, wk_repo_slug), engine names for the same
# reason.
# shellcheck source=../workflow/lib/slug.sh
. "$HOOK_LIB_DIR/../workflow/lib/slug.sh"

# The proved-tree records, the suite record and the package record
# (wk_tree_hash, wk_suite_marker_write, wk_has_test_script and the rest),
# engine names for the same reason; workflow/prove.sh reads them through here.
# shellcheck source=../workflow/lib/suite.sh
. "$HOOK_LIB_DIR/../workflow/lib/suite.sh"

# The helper groups: each defines functions and sets nothing, so sourcing runs
# nothing and every name they read is defined above.
# shellcheck source=./lib/markers.sh
. "$HOOK_LIB_DIR/lib/markers.sh"
# shellcheck source=./lib/paths.sh
. "$HOOK_LIB_DIR/lib/paths.sh"
# shellcheck source=./lib/tree.sh
. "$HOOK_LIB_DIR/lib/tree.sh"
# shellcheck source=./lib/snapshot.sh
. "$HOOK_LIB_DIR/lib/snapshot.sh"
