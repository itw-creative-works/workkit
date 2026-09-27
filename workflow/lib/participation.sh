#!/usr/bin/env bash
# workflow/lib/participation.sh: what the kit means by a repo root and by a
# repo's answer, for the engine and the hooks. Sourced, functions only; the
# hooks source it directly so they never load the engine's addresses.

# wk_is_repo_root <dir>: `-e`, never `-d`, since `.git` is a file in a worktree
# and in a submodule. Asked of the directory, so a walk needs no git call apiece.
wk_is_repo_root() {
  [ -e "$1/.git" ]
}

# wk_settings_declined <file> / wk_settings_enabled <file>: the `enabled` key,
# read without jq. An unreadable file answers 1, never grep's 2. Not each
# other's negation: a file with no key is the legacy opt-in, so declined is the
# only no.
wk_settings_declined() {
  [ -r "$1" ] || return 1
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$1" 2>/dev/null
}

wk_settings_enabled() {
  [ -r "$1" ] || return 1
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*true' "$1" 2>/dev/null
}
