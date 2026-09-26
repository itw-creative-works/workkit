#!/bin/bash
# hooks/_lib.sh: helpers shared by hook scripts. Source it, never execute:
#   . "${BASH_SOURCE[0]%/*}/../../_lib.sh"   (from a depth-2 hook dir)
# Every helper fails toward the SAFE side for guards (visible text gates;
# missing tools degrade, never crash the hook).
#
# Consumers: safety/commit-gate, safety/commit-language, safety/release-taken
# (the git-commit detection trio in lib/commit.sh); safety/proof-guard + safety/tree-guard +
# safety/suite-guard + safety/release-taken (the two text strips); safety/commit-gate + docs/changelog-guard (hook_changelog_linter);
# safety/proof-guard + safety/commit-gate (hook_issue_has_proof);
# safety/tree-guard + safety/suite-guard (hook_has_escape);
# manager/resolver + manager/profile (hook_session_model, hook_model_tier,
# hook_manager_config); safety/commit-language + safety/release-taken
# (HOOK_VERSION_RE); every hook that keys a marker or a cache file
# (hook_sha1 and the two marker paths in lib/markers.sh, plus scripts/review-marker.sh and
# scripts/triage-marker.sh); every hook's payload read, hook_session_model's two model reads + safety/release-taken (hook_jq);
# safety/release-taken (wk_repo_slug, off the slug seam); safety/commit-gate
# (wk_linter_copies, wk_workflows_run_copy, wk_changelog_job_rewrite and
# wk_checks_template, off the changelog-job seam); no
# caller here yet for the platform seam (hook_uname_s, hook_is_macos,
# hook_is_windows, hook_is_linux).
#
# Add helpers only with a second named consumer. PARITY with the personal hooks'
# _lib.sh (~/.claude/hooks/_lib.sh) is the standing exemption: the seam and
# hook_jq are carried here so both files read name for name, since a reader who
# knows one is reading the other, and a helper missing on one side is where the
# two start to drift.
#
# hook_session_model also exists in those personal hooks, where
# claude/session/context needs it. The duplication is deliberate: a plugin
# directory is not a stable import target for the personal hooks, so neither
# side sources the other. Change both together.
#
# The helper groups live one file per concern under hooks/lib/ (markers.sh,
# commit.sh, manager.sh, proof.sh), sourced at the foot of this file. The
# constants, the platform seam, hook_jq and the engine sources stay here, so a
# hook still sources this one file and gets the whole library.

# The workflow state directory's name, for the HOOK layer: one string so a
# rename is one edit here. The other two layers hold their own copy for the
# same reason (the engine, workflow/standards.sh, and the test harness,
# tests/lib/harness.js); a test asserts all three still say the same thing.
# Hooks that do not source this file keep the literal and point back here.
WORKKIT_DIR=".workkit"

# The version a RELEASE subject may carry, as an ERE: `1.2.3`, a leading `v`,
# and an optional pre-release or build suffix. Consumers: safety/commit-language
# (the one subject allowed to name a version) and safety/release-taken (the same
# subject, read for the version it is about to release). Two spellings of it
# would let one hook accept a release the other never sees.
readonly HOOK_VERSION_RE='v?[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?'

# hook_uname_s / hook_is_macos / hook_is_windows / hook_is_linux: the platform
# split, for hooks. The kit runs on macOS, on Windows under Git Bash and on
# Linux, and where a spelling differs between them the branch is taken here
# rather than in each hook that needs it. The personal hooks
# (~/.claude/hooks/_lib.sh) carry the same four names and the same shape: one
# mechanism, so a reader of either side recognises it.
#
# Bash's own $OSTYPE is read FIRST: the shell itself sets it (darwin* on the
# Mac, msys/cygwin under Git Bash, linux-gnu on Linux), so it costs no fork and
# needs no PATH. A PATH without `uname` is a real case, not a hypothetical (a
# hook is launched with whatever the session hands it), and a platform that read
# as "not macOS" there would silently take the wrong branch. `uname -s` answers
# only when $OSTYPE is empty or a name this split does not know; Git Bash
# reports MINGW64_NT-10.0-19045 and an MSYS2 build MSYS_NT-….
#
# The reading is cached: a process cannot change platform mid-run.
#
# The two spellings that already branch WITHOUT this seam, because their own
# fallback chain is the portable form: hook_file_mtime in lib/markers.sh (BSD `stat -f`
# against GNU `stat -c`, each accepted only when its output is digits) and
# docs/checkpoint's `date -r` against `date -d @` chain. Both stay as they are.
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

# hook_jq: the CRLF-safe jq, under the name the hooks call it by. The BODY
# lives once, in the engine beside this layer (workflow/platform.sh, `wk_jq`),
# which is where the rule and the reason for it are written down; the hook-facing
# name stays hook_* so this library reads the way every other helper here does,
# and so the personal hooks' _lib.sh reads name for name with it.
# Consumers: every hook that reads its JSON payload, hook_session_model's two model reads, safety/release-taken.
#
# The engine is resolved from this file's PHYSICAL location (`pwd -P` resolves
# any symlink in the path before the `..` walk), and from that alone: the two
# files ship together in one plugin, so this one is beside that one or the
# install is broken. WORKFLOW_DIR, which hook_changelog_linter honors, is the
# pointer at an engine that may be ELSEWHERE OR MISSING, and the strip has no
# business following a pointer a caller aims at a partial engine on purpose.
# No fork either: this runs at LOAD time, in hooks whose PATH may hold nothing
# at all, and `cd`/`pwd` are builtins where `dirname` is a program.
#
# UNGUARDED, the way the engine's own two sources of the same file are: a file
# that is not there says so once, at load, in the shell's own words, and the
# loader still fails open. Guarded, it would leave `wk_jq` undefined, every read
# through it empty, and the caller blaming the file it was reading.
# shellcheck source=../workflow/platform.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/platform.sh"
hook_jq() { wk_jq "$@"; }
# hook_jq_default <default> <jq args...>: the same read with a default beside
# it, under the hook-facing name. The body and the reason are the engine's
# (`wk_jq_default`), exactly as hook_jq's are.
hook_jq_default() { wk_jq_default "$@"; }

# The participation predicates, from the same engine beside this layer and
# resolved the same way (workflow/participation.sh): `wk_is_repo_root <dir>`,
# which is `-e` on `.git` because a worktree's is a FILE, and
# `wk_settings_declined <file>` / `wk_settings_enabled <file>`, the `enabled`
# key read without jq. They keep their ENGINE names here, where hook_jq takes a
# hook-facing one: that wrapper exists so this library reads name for name with
# the personal hooks' _lib.sh, and these two have no twin there to match. A
# second name for one predicate is the drift the one home was built to end.
# Consumers: workflow/standards (the declined read on a broken install), and
# safety/vendor-guard + docs/session, which source the file directly.
# shellcheck source=../workflow/participation.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/participation.sh"

# The slug rule, from the same engine beside this layer and resolved the same
# way (workflow/slug.sh): `wk_slug_from_remote <url>` and `wk_repo_slug <dir>`,
# `owner/repo` out of a remote in either form git writes it and either separator
# a path is typed in. It keeps its ENGINE name here for the reason the
# predicates above do: a second name for one rule is the drift the one home was
# built to end, and a hand-rolled parse beside it is the same drift spelled
# shorter. Consumers: safety/release-taken (the repo its github-release bounce
# names).
# shellcheck source=../workflow/slug.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/slug.sh"

# The changelog job in a repo's checks.yml and the retired linter copies, from
# the same engine beside this layer and resolved the same way
# (workflow/changelog-job.sh): the copies' names, whether a workflow still runs
# one, and the rewrite the heal writes over an old job. Engine names, for the
# reason the predicates above keep theirs. Consumers: safety/commit-gate (its
# heal-bookkeeping arms, which prove a commit is exactly the heal's output).
# shellcheck source=../workflow/changelog-job.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/../workflow/changelog-job.sh"

# The helper groups, one file per concern under lib/ beside this file, resolved
# the same way and UNGUARDED for the same reason: they are this library's own
# body. Each defines functions and sets nothing, so every constant and engine
# name a piece reads is defined above before any caller runs one. Sourcing runs
# nothing.
# shellcheck source=./lib/markers.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/markers.sh"
# shellcheck source=./lib/commit.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/commit.sh"
# shellcheck source=./lib/manager.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/manager.sh"
# shellcheck source=./lib/proof.sh
. "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/lib/proof.sh"
