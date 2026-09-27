#!/usr/bin/env bash
# workflow/workkit/links.sh: the two links this command maintains, the
# engine's address (asked of standards.sh, which owns it) and the
# `~/.local/bin/workkit` command itself. Sourced by workkit.sh, functions only;
# every name it reads is the entry's.

# standards.sh owns the engine's address; `--engine-link` runs that step alone.
# Its diagnostics arrive on stderr, so an action line is relayed and silence
# stays silent.
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

  # The relay strips the heal's colors, indent and glyph, and re-says each
  # engine line under this command's own glyph.
  out="$(printf '%s\n' "$out" | sed $'s/\033\\[[0-9;]*m//g' | wk_plain | grep '^engine:' || true)"
  if [[ -n "$out" ]]; then
    while IFS= read -r line; do
      wk_ok "$line"
    done <<<"$out"
  else
    # Silence is either a current address or a refusal to write it, so the
    # address is read back: a refusal must never read as up to date.
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
  # The automatic path creates no ~/.local/bin, the same restraint the engine
  # shows with ~/.claude; a human's setup or update may.
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

  # One atomic maker in lib/flows.sh for both machine-wide links, judged by
  # what the address is afterwards, never by the command's status.
  if [[ "$make" -eq 1 ]] && wk_link "$SCRIPT_DIR/workkit.sh" "$BIN_LINK"; then
    wk_ok "command: $verb $BIN_LINK → $SCRIPT_DIR/workkit.sh"
  fi

  case ":${PATH:-}:" in
    *":$BIN_DIR:"*) ;;
    *) wk_info "command: $BIN_DIR is not on your PATH; add it to your shell rc:
    export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
  esac
}
