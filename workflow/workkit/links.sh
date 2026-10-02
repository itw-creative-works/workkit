#!/usr/bin/env bash
# workflow/workkit/links.sh: the three pointers this command maintains, the
# engine's address (asked of standards.sh, which owns it), the
# `~/.local/bin/workkit` command itself, and npm's script-shell (on Windows,
# the executable it names). Sourced by workkit.sh, functions only; every name it
# reads is the entry's.

# standards.sh owns the engine's address; `--engine-link` runs that step alone.
# Its diagnostics arrive on stderr, so an action line is relayed and silence
# stays silent.
refresh_engine_link() {
  local out rc=0
  # A missing engine is a broken checkout, never a machine that is up to date:
  # the two must not read the same, or a half-installed kit reports all-clear.
  if [[ ! -f "$STANDARDS" ]]; then
    wk_warn "engine: standards.sh is missing at $STANDARDS; the kit is incomplete, so the engine address cannot be maintained"
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
    local linked
    linked="$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)"
    if [[ -L "$ENGINE_LINK" && "$linked" == "$SCRIPT_DIR" ]]; then
      wk_skip "engine: $ENGINE_LINK is current"
    elif [[ -L "$ENGINE_LINK" && -n "$linked" ]] && wk_clone_outranks "$KIT_DIR" "$linked"; then
      wk_skip "engine: $ENGINE_LINK is current: it names the workkit clone at $linked, which outranks the plugin cache"
    else
      wk_skip "engine: $ENGINE_LINK was left as it is; this engine does not take the address"
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
    elif wk_clone_outranks "$KIT_DIR" "${current%/*/*}"; then
      wk_skip "command: $BIN_LINK is current: it names the workkit clone's $current, which outranks the plugin cache"
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

# The Windows script shell is current when it exists and its source is not newer.
script_shell_exe_current() {
  local exe
  exe="$(wk_script_shell_exe)" || return 1
  [[ -f "$exe" && ! "$SCRIPT_DIR/script-shell.cs" -nt "$exe" ]]
}

# npm on Windows starts its shell as a plain program, so there it is an
# executable built from script-shell.cs with the compiler every Windows ships,
# into the machine's own folder; built when missing or older than its source.
script_shell_exe() {
  local csc="${SYSTEMROOT:-${SystemRoot:-C:/Windows}}/Microsoft.NET/Framework64/v4.0.30319/csc.exe"
  local src="$SCRIPT_DIR/script-shell.cs" out
  out="$(wk_script_shell_exe)" || return 1
  script_shell_exe_current && return 0
  if [[ ! -f "$csc" ]]; then
    wk_skip "npm: no C# compiler at $csc, so the Windows script shell cannot be built and script-shell stays unset"
    return 1
  fi
  local -a build=("$csc" -nologo -optimize -target:exe "-out:$(cygpath -w "$out")" "$(cygpath -w "$src")")
  mkdir -p "${out%/*}"
  if MSYS_NO_PATHCONV=1 "${build[@]}" >/dev/null 2>&1; then
    wk_ok "npm: built $out from script-shell.cs"
  else
    wk_warn "npm: could not build $out; run \`${build[*]}\` to see why"
    return 1
  fi
}

# npm's script-shell → the engine's script-shell.sh, named through the engine
# address, or on Windows the executable that hands the call to it. Only a
# human's run sets it (never --auto); someone else's value is reported, never
# replaced; `doctor` reports and returns 1 on attention.
script_shell() {
  local want="$ENGINE_LINK/script-shell.sh" have note exe have_path want_path
  case "${OSTYPE:-}" in
    msys*|cygwin*)
      exe="$(wk_script_shell_exe)" || return 0
      want="$(wk_git_path "$exe")" || return 0
      if [[ "${1:-}" == doctor ]]; then
        if ! script_shell_exe_current; then
          wk_warn "npm: $exe is missing or older than script-shell.cs; run \`workkit update\`"
          return 1
        fi
      elif [[ "$QUIET" -ne 1 ]]; then
        script_shell_exe || return 0
      fi ;;
  esac
  if ! command -v npm >/dev/null 2>&1; then
    wk_skip "npm: not on this machine, so there is no script-shell to point at the kit"
    return 0
  fi
  if ! have="$(wk_npm_script_shell)"; then
    wk_warn "npm: \`npm config get script-shell\` failed; run it to see why"
    [[ "${1:-}" == doctor ]] && return 1
    return 0
  fi
  # The kit's own shell reached through a linked folder is current too, by the
  # gate's physical compare; the npmrc keeps the spelling it has.
  if [[ "$have" != "$want" ]] && have_path="$(wk_physical_path "$have")" \
    && want_path="$(wk_physical_path "$want")" && [[ "$have_path" == "$want_path" ]]; then
    have="$want"
  fi
  case "$have" in
    "$want")
      if [[ "${1:-}" == doctor ]]; then
        wk_ok "npm: script-shell is current"
      else
        wk_skip "npm: script-shell is current"
      fi ;;
    ''|null|undefined)
      if [[ "${1:-}" == doctor ]]; then
        wk_warn "npm: script-shell is not set, so a root \`npm test\` records nothing; run \`workkit update\`"
        return 1
      fi
      [[ "$QUIET" -eq 1 ]] && return 0
      if npm config set script-shell "$want" >/dev/null 2>&1; then
        wk_ok "npm: script-shell set to $want (a root npm test now records the tree it proved)"
      else
        wk_warn "npm: could not set script-shell; run \`npm config set script-shell $want\`"
      fi ;;
    *)
      # An exported npm_config_script_shell outranks every npmrc, so the fix
      # named is the export; --auto stays silent here, as it does when unset.
      note="npm: script-shell is $have, set by someone else, and left as it is; \`npm config set script-shell $want\` points it at the kit"
      if [[ -n "${npm_config_script_shell:-}" ]]; then
        note="npm: script-shell is $have, exported as npm_config_script_shell by your shell, and left as it is; drop that export so \`workkit update\` can point npm at the kit"
      fi
      [[ "$QUIET" -eq 1 ]] || wk_warn "$note"
      [[ "${1:-}" == doctor ]] && return 1 ;;
  esac
  return 0
}
