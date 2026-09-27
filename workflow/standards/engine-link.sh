#!/usr/bin/env bash
# workflow/standards/engine-link.sh: the engine's public address
# (~/.claude/workkit → the workflow folder): whether this checkout may take it,
# writing it, and clearing the copy a shell that cannot make symlinks leaves
# there instead. Sourced by standards.sh, functions only; SCRIPT_DIR,
# CLAUDE_HOME and ENGINE_LINK are the entry's.

# Only the machine's real engine may take the address: a checkout whose origin
# names the workkit repo. A fixture copy or an archive is a quiet skip.
is_canonical_checkout() {
  local top url
  command -v git >/dev/null 2>&1 || return 1
  top="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [[ -n "$top" ]] || return 1
  url="$(git -C "$top" remote get-url origin 2>/dev/null)" || return 1
  # `wk_slug_from_remote` reads every remote form alike, a Windows path
  # included; the owner's letter case is not the engine's business.
  wk_slug_from_remote "$url" | grep -Eiq '^[^/]+/workkit$'
}

# A real directory at the address is the copy Git Bash makes when it cannot
# symlink, so it goes; a symlink is never removed, since it is another
# session's win of the same race (`workflow/README.md` § How it is reached).
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

  # `wk_link` answers for the address, not the command: losing the race to a
  # session writing the same link is not a failure.
  if wk_link "$SCRIPT_DIR" "$ENGINE_LINK"; then
    wk_ok "engine: $verb $ENGINE_LINK → $SCRIPT_DIR"
    return 0
  fi
  clear_engine_copy
  return 0
}
