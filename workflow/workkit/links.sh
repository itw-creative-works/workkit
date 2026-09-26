#!/usr/bin/env bash
# workflow/workkit/links.sh: the two links this command maintains, the
# engine's address (asked of standards.sh, which owns it) and the
# `~/.local/bin/workkit` command itself. SOURCED by workkit.sh, never executed,
# and it runs nothing at load: it defines functions and sets nothing. Every
# name it reads (SCRIPT_DIR, KIT_DIR, STANDARDS, ENGINE_LINK, BIN_DIR, BIN_LINK,
# QUIET) is the entry's.

# The engine's address is standards.sh's own to maintain: it points
# ~/.claude/workkit at the folder it is running from, when that folder is a real
# workkit checkout. `--engine-link` is that step on its own, which is how this
# command triggers it without owning a second copy of it. Its diagnostics arrive
# on stderr, so an action line is relayed and silence stays silent.
refresh_engine_link() {
  local out rc=0
  # A missing engine is a broken checkout, never a machine that is up to date:
  # the two must not read the same, or a half-installed kit reports all-clear.
  if [[ ! -f "$STANDARDS" ]]; then
    wk_warn "engine: standards.sh is missing at $STANDARDS; this checkout is incomplete, so the engine address cannot be maintained"
    return 0
  fi

  out="$(bash "$STANDARDS" --engine-link "$KIT_DIR" 2>&1 >/dev/null)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    wk_warn "engine: the address step could not run (exit $rc); run \`bash $STANDARDS --engine-link $KIT_DIR\` to see why"
    return 0
  fi

  # The heal speaks in the same voice this command does (issue #237), so the
  # relay strips the colors, then the indent and the glyph, and keeps the engine
  # lines: an action line is re-said here under this command's own glyph rather
  # than repeated with the heal's.
  out="$(printf '%s\n' "$out" | sed $'s/\033\\[[0-9;]*m//g' | wk_plain | grep '^engine:' || true)"
  if [[ -n "$out" ]]; then
    while IFS= read -r line; do
      wk_ok "$line"
    done <<<"$out"
  else
    # Silence is two different outcomes: the address already resolves here, or
    # the engine REFUSED to write it (no ~/.claude, no git, a checkout that is
    # not the machine's engine). Only the first is "current", so the address is
    # read back rather than assumed: a refusal that reads as up to date is the
    # one report this command must not print (verifier finding, 2026-07-29).
    if [[ -L "$ENGINE_LINK" && "$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)" == "$SCRIPT_DIR" ]]; then
      wk_skip "engine: $ENGINE_LINK is current"
    else
      wk_skip "engine: $ENGINE_LINK was left as it is; this checkout does not take the engine's address"
    fi
  fi
}

# ~/.local/bin/workkit → workkit.sh. A link pointing somewhere else is
# repointed (a moved checkout is the ordinary case); a real file is a human's
# and is only reported.
link_command() {
  local current verb=linked make=1
  # The automatic path CREATES nothing on a machine that has no ~/.local/bin:
  # the same restraint the engine shows with ~/.claude. A directory convention a
  # machine has not adopted is not a session start's to introduce; a human
  # running `setup` or `update` is asking for it.
  if [[ "$QUIET" -eq 1 && ! -d "$BIN_DIR" ]]; then
    return 0
  fi

  if [[ -L "$BIN_LINK" ]]; then
    current="$(readlink "$BIN_LINK" || true)"
    if [[ "$current" == "$SCRIPT_DIR/workkit.sh" ]]; then
      wk_skip "command: $BIN_LINK is current"
      make=0
    else
      verb=repointed
    fi
  elif [[ -e "$BIN_LINK" ]]; then
    wk_warn "command: $BIN_LINK is a real file; move it aside, then re-run \`workkit update\`"
    return 0
  else
    mkdir -p "$BIN_DIR"
  fi

  # The engine's address and this command are the two links the engine makes,
  # both of them one path for the whole machine, so both are written by the one
  # atomic maker in lib/flows.sh and judged the same way: by what the address IS
  # afterwards, never by the status of the command that wrote it.
  if [[ "$make" -eq 1 ]] && wk_link "$SCRIPT_DIR/workkit.sh" "$BIN_LINK"; then
    wk_ok "command: $verb $BIN_LINK → $SCRIPT_DIR/workkit.sh"
  fi

  case ":${PATH:-}:" in
    *":$BIN_DIR:"*) ;;
    *) wk_info "command: $BIN_DIR is not on your PATH; add it to your shell rc:
    export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
}
