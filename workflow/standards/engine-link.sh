#!/usr/bin/env bash
# workflow/standards/engine-link.sh: the engine's public address
# (~/.claude/workkit → the workflow folder): whether this checkout is the one
# allowed to take it, writing it, and clearing the copy a shell that cannot
# make symlinks leaves there instead. SOURCED by standards.sh, never executed,
# and it runs nothing at load: it defines functions and sets nothing. Every
# name it reads (SCRIPT_DIR, CLAUDE_HOME, ENGINE_LINK) is the entry's.

# Only the machine's REAL engine may take the address. A fixture copy, an
# archive, or a partial checkout running this script is not the engine every
# other session resolves. One of them repointing the link stole it from the
# whole machine (verify finding, 2026-07-29). Canonical means: the script sits
# in a git checkout whose origin names the workkit repo. Anything else is a
# quiet skip, not a fault.
is_canonical_checkout() {
  local top url
  command -v git >/dev/null 2>&1 || return 1
  top="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [[ -n "$top" ]] || return 1
  url="$(git -C "$top" remote get-url origin 2>/dev/null)" || return 1
  # The slug is what identifies it, read through the engine's one rule
  # (`wk_slug_from_remote`, workflow/slug.sh, sourced with lib.sh above): https,
  # ssh, a local path in EITHER separator and a trailing .git all read the same,
  # so a checkout cloned from a path typed natively on Windows is the machine's
  # engine there too. A remote naming no owner names no repo and is not the kit.
  # The owner's letter case is not the engine's business.
  wk_slug_from_remote "$url" | grep -Eiq '^[^/]+/workkit$'
}

# What is at the address when the link did not land, judged by what IS there
# and never by a command's status. A real DIRECTORY is the copy Git Bash
# answers a plain `ln -s` with on a shell that may not make symlinks: lib.sh
# exports MSYS=winsymlinks:nativestrict so that shell refuses instead, and the
# result is checked anyway rather than the flag trusted, because a copy of the
# engine at this address is worse than no address at all. The marker scripts
# the skills call sit one level ABOVE the engine folder, so a copy hides them
# and every skill's fallback resolves into $CLAUDE_HOME. What is there is this
# run's own fresh copy, so it goes, and the Windows sentence says what to turn
# on.
#
# A SYMLINK is never removed here: the one case that reaches this function with
# a symlink at the address is a session that lost the race to another session
# writing the SAME link, and deleting it would leave the machine with no
# address at all. Anything else is a failure `ln` or `mv` already named on
# stderr, so this says nothing and the heal goes on.
clear_engine_copy() {
  [[ -L "$ENGINE_LINK" ]] && return 0
  [[ -d "$ENGINE_LINK" ]] || return 0
  rm -rf "$ENGINE_LINK"
  wk_warn "engine: $ENGINE_LINK came back a copy instead of a symlink, so it was removed; this shell cannot make symlinks (on Windows, turn on Developer Mode or run as administrator), then re-run \`workkit update\`"
  return 0
}

ensure_engine_link() {
  [[ -d "$CLAUDE_HOME" ]] || return 0
  is_canonical_checkout || return 0

  local current verb=linked
  if [[ -L "$ENGINE_LINK" ]]; then
    current="$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)"
    [[ "$current" == "$SCRIPT_DIR" ]] && return 0
    verb=repointed
  elif [[ -e "$ENGINE_LINK" ]]; then
    wk_warn "engine: $ENGINE_LINK is a real file or directory; move it aside so the engine's address can be linked"
    return 0
  fi

  # One address for the whole machine, so sessions opening at once in several
  # repos all write this one path. `wk_link` makes it atomically and answers
  # for the ADDRESS rather than for one command, which is what a session that
  # lost that race needs: losing it is not failing, since the winner wrote the
  # same link. Under `set -e` the bare `ln` this replaced ended the heal one
  # line above the roster registration, leaving the repo that session stood in
  # off this machine's roster until the next day.
  if wk_link "$SCRIPT_DIR" "$ENGINE_LINK"; then
    wk_ok "engine: $verb $ENGINE_LINK → $SCRIPT_DIR"
    return 0
  fi
  clear_engine_copy
  return 0
}
