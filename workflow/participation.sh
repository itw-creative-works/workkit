#!/usr/bin/env bash
# workflow/participation.sh: the two questions every reader of a repo's
# participation asks, for the engine and for the hooks beside it. SOURCED,
# never executed, and it runs nothing at load: it defines functions and sets
# nothing.
#
# The sibling of platform.sh, reached the same way and for the same reason: the
# HOOK layer asks both questions too, and a hook has no business loading the
# engine's addresses, its palette and its mutex to ask whether a directory is a
# repo. platform.sh is the one home of what the PLATFORMS spell differently;
# this is the one home of what the KIT means by a repo root and by a repo's
# answer, so a walk, a heal, a guard and a session start cannot read the same
# file and disagree.

# wk_is_repo_root <dir>: is <dir> the root of a git repo?
#
# `-e`, never `-d`: `.git` is a DIRECTORY in an ordinary checkout and a FILE in
# a worktree and in a submodule, so a `-d` reading answers no for a repo that is
# working perfectly and whatever asked it skips that repo.
#
# The question is asked of the DIRECTORY, which is the form a walk can ask of
# every level above it without a git call apiece. A caller that already holds a
# toplevel from git holds the answer with it and needs nothing here.
wk_is_repo_root() {
  [ -e "$1/.git" ]
}

# wk_settings_declined <file> and wk_settings_enabled <file>: what the `enabled`
# key of a settings file says, read without jq.
#
# The committed `.workkit/settings.json` carries a repo's own answer, and a
# reader on a machine without jq still has to honor it, so the reading is a grep
# and the pattern lives here rather than in each reader.
#
# A file that is absent or unreadable answers NO to both, in one code and not
# grep's own two: there is no answer to honor, and a caller asking a yes or no
# question gets one. The readability test is what makes the two cases one
# answer, since grep says 2 for the file it cannot open and 1 for the one that
# simply does not match.
#
# The two are not each other's negation. A file with NO `enabled` key is neither
# declined nor enabled: it is the legacy opt-in, written before the key existed,
# and every reader takes it as a yes by taking DECLINED as the only no.
wk_settings_declined() {
  [ -r "$1" ] || return 1
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$1" 2>/dev/null
}

wk_settings_enabled() {
  [ -r "$1" ] || return 1
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*true' "$1" 2>/dev/null
}
