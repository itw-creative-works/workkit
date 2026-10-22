#!/usr/bin/env bash
# workflow/standards/hooks.sh: the once-a-day assertion that the hook layer
# beside the engine is alive (`workflow/README.md` § The hook layer
# self-check). Sourced by standards.sh, functions only; HOOKS_DIR and
# HOOK_TOOLS are the entry's.

# ── 5. The hook layer is alive ──
# The hooks module loads, the shell pieces the scripts source parse, and the
# tools both call are present. A dead piece flags the run; a missing tool warns
# without flagging it, since no repo can fix it.
check_hook_layer() {
  # No hook layer beside the engine: this is the engine installed on its own,
  # not a broken install.
  [[ -f "$HOOKS_DIR/hooks.json" ]] || return 0

  local entry spelling found missing=""
  for entry in $HOOK_TOOLS; do
    found=0
    for spelling in ${entry//|/ }; do
      command -v "$spelling" >/dev/null 2>&1 && { found=1; break; }
    done
    [[ $found -eq 1 ]] || missing="$missing ${entry//|/ or }"
  done
  if [[ -n "$missing" ]]; then
    wk_warn "hooks: the hook layer needs$missing; without them the hooks stand aside and their checks silently do not run"
  fi

  local module=""
  check_hook_module && module="; the hooks module loads"

  # The shell the scripts still source (scripts/*.sh, workflow/prove.sh, the
  # snapshot entry): `bash -n` on each piece, since a sourcing script never
  # parses what it sources until it runs.
  local piece pieces_checked=0
  for piece in "$HOOKS_DIR/_lib.sh" "$HOOKS_DIR"/lib/*.sh; do
    [[ -f "$piece" ]] || continue
    pieces_checked=$((pieces_checked + 1))
    if ! bash -n "$piece" 2>/dev/null; then
      wk_warn "hooks: ${piece#"$HOOKS_DIR"/} has a syntax error; every script that sources it exits non-zero before doing anything (bash -n $piece)"
      needs_attention=1
    fi
  done

  [[ "$pieces_checked" -gt 0 || -n "$module" ]] && wk_skip "hooks: $pieces_checked shell pieces parse$module"
  return 0
}

# The hooks module, loaded the way node loads it, which pulls in every
# module under hooks/mods/. 0 when it loads; 1 when there is no module or no node to try
# it with (the tool warning names a missing node), or when it fails, flagged.
check_hook_module() {
  local module="$HOOKS_DIR/register.js" err line
  [[ -f "$module" ]] && command -v node >/dev/null 2>&1 || return 1
  # The path rides argv, so node builds the file URL and no quoting reaches it.
  if err="$(node --no-warnings --input-type=module \
    -e 'const { pathToFileURL } = await import("node:url"); await import(pathToFileURL(process.argv[1]).href);' \
    "$module" 2>&1 >/dev/null)"; then
    return 0
  fi
  # The error's own line names the cause; a missing import's first line is node's internals.
  line="$(printf '%s\n' "$err" | tr -d '\r' | grep -m 1 -E '^[A-Za-z]*Error( \[[A-Z_]+\])?:' || true)"
  [[ -n "$line" ]] || line="$(printf '%s\n' "$err" | tr -d '\r' | head -n 1)"
  wk_warn "hooks: the hooks module fails to load: $line"
  needs_attention=1
  return 1
}
