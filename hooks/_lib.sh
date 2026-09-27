#!/bin/bash
# hooks/_lib.sh: the helpers every hook sources, never executes:
#   . "${BASH_SOURCE[0]%/*}/../../_lib.sh"   (from a depth-2 hook dir)
# Helpers fail toward the safe side for guards. The constants, the platform
# seam, hook_jq and the engine sources live here; the helper groups live one
# file per concern under hooks/lib/, sourced at the foot. Add a helper only
# with a second named consumer, or for name-for-name parity with the personal
# hooks' _lib.sh.

# The hook layer's copy of the state directory name; the engine and the test
# harness hold their own, and a test asserts all three agree.
WORKKIT_DIR=".workkit"

# A release subject's version, as an ERE: commit-language and release-taken
# both read it, so one hook never accepts a release the other misses.
readonly HOOK_VERSION_RE='v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?'

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
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/lib/platform.sh"
hook_jq() { wk_jq "$@"; }
# hook_jq_default <default> <jq args...>: wk_jq_default under the hook name.
hook_jq_default() { wk_jq_default "$@"; }

# The participation predicates (wk_is_repo_root, wk_settings_declined,
# wk_settings_enabled) keep their engine names: they have no personal-hooks
# twin to match, and a second name for one predicate drifts.
# shellcheck source=../workflow/lib/participation.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/lib/participation.sh"

# The slug rule (wk_slug_from_remote, wk_repo_slug), engine names for the same
# reason; release-taken reads it rather than parsing an origin of its own.
# shellcheck source=../workflow/lib/slug.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/lib/slug.sh"

# The changelog job helpers, engine names; commit-gate's heal-bookkeeping arms
# read them to prove a commit is exactly the heal's output.
# shellcheck source=../workflow/changelog/changelog-job.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/changelog/changelog-job.sh"

# The helper groups: each defines functions and sets nothing, so sourcing runs
# nothing and every name they read is defined above.
# shellcheck source=./lib/markers.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/markers.sh"
# shellcheck source=./lib/commit.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/commit.sh"
# shellcheck source=./lib/manager.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/manager.sh"
# shellcheck source=./lib/proof.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/proof.sh"
# shellcheck source=./lib/notice.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/notice.sh"
# shellcheck source=./lib/deadline.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/deadline.sh"
# shellcheck source=./lib/paths.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/paths.sh"
# shellcheck source=./lib/suite.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/suite.sh"
