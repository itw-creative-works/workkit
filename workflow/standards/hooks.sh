#!/usr/bin/env bash
# workflow/standards/hooks.sh: the once-a-day assertion that the hook layer
# beside the engine is alive (`workflow/README.md` § The hook layer
# self-check). Sourced by standards.sh, functions only; HOOKS_DIR, HOOK_TOOLS
# and the hooks_checked counter are the entry's.

# ── 5. The hook layer is alive ──
# A dead hook flags the run; a missing tool warns without flagging it, since no
# repo can fix it.
hook_names() {
  # Each wired command is `…/loader.sh <prefix>:<name>`; the name is what
  # resolves to a directory on disk.
  wk_jq -r '.. | objects | select(has("command")) | .command' "$HOOKS_DIR/hooks.json" 2>/dev/null \
    | sed -E 's|.*loader\.sh[[:space:]]+||; s|[[:space:]].*||' \
    | grep -E '^[a-z]+[:/][a-z-]+$' | sort -u || true
}

check_hook_layer() {
  local manifest="$HOOKS_DIR/hooks.json" name missing=""

  # No hook layer beside the engine: this is the engine installed on its own,
  # not a broken install.
  [[ -f "$manifest" ]] || return 0

  local entry spelling found
  for entry in $HOOK_TOOLS; do
    found=0
    for spelling in ${entry//|/ }; do
      command -v "$spelling" >/dev/null 2>&1 && { found=1; break; }
    done
    [[ $found -eq 1 ]] || missing="$missing ${entry//|/ or }"
  done
  if [[ -n "$missing" ]]; then
    wk_warn "hooks: the hook layer needs$missing; without them the hooks exit 0 and their checks silently do not run"
  fi

  # Everything below reads the manifest, which needs jq. Without it the tool
  # warning above has already said what is wrong.
  command -v jq >/dev/null 2>&1 || return 0

  # The router every wired command goes through is checked first: unusable here
  # means no hook runs at all, whatever the scripts behind it look like.
  check_hook_script "loader.sh" "$HOOKS_DIR/loader.sh"
  local pieces=("$HOOKS_DIR/_lib.sh" "$HOOKS_DIR"/lib/*.sh)
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    check_hook_script "$name" "$HOOKS_DIR/${name//://}/run.sh"
    pieces+=("$HOOKS_DIR/${name//://}"/checks/*.sh)
  done < <(hook_names)

  # `bash -n` on a run.sh never follows its `source`, so the pieces it sources
  # are parsed on their own. Counted apart: hooks_checked is the wired count.
  local piece pieces_checked=0
  for piece in "${pieces[@]}"; do
    [[ -f "$piece" ]] || continue
    pieces_checked=$((pieces_checked + 1))
    if ! bash -n "$piece" 2>/dev/null; then
      wk_warn "hooks: ${piece#"$HOOKS_DIR"/} has a syntax error; every hook that sources it exits non-zero before doing anything (bash -n $piece)"
      needs_attention=1
    fi
  done

  # The extraction's name filter is exact on purpose, so a wired command it
  # cannot parse would silently fall out of the check. Compare against the
  # raw count of loader.sh commands and say so instead.
  local wired
  wired="$(wk_jq -r '.. | objects | select(has("command")) | .command' "$HOOKS_DIR/hooks.json" 2>/dev/null \
    | grep 'loader\.sh' | sort -u | grep -c . || true)"
  if [[ -n "$wired" && "$wired" -gt $((hooks_checked - 1)) ]]; then
    wk_warn "hooks: $wired commands are wired through loader.sh but only $((hooks_checked - 1)) resolved to checkable names; a hook name the checker cannot parse is going unchecked"
  fi

  [[ "$hooks_checked" -gt 0 ]] && wk_skip "hooks: $hooks_checked hook scripts resolve, are executable, and parse; $pieces_checked sourced pieces parse"
  return 0
}

# One wired hook, by the three ways it can be dead. Counts into hooks_checked.
check_hook_script() {
  local name="$1" script="$2"
  hooks_checked=$((hooks_checked + 1))
  if [[ ! -f "$script" ]]; then
    wk_warn "hooks: $name is wired in hooks.json but there is no script at $script; reinstall the workkit plugin"
    needs_attention=1
    return 0
  fi
  if [[ ! -x "$script" ]]; then
    wk_warn "hooks: $name is not executable; the loader skips it and its checks never run (chmod +x $script)"
    needs_attention=1
    return 0
  fi
  if ! bash -n "$script" 2>/dev/null; then
    wk_warn "hooks: $name has a syntax error; it exits non-zero before doing anything (bash -n $script)"
    needs_attention=1
    return 0
  fi
  return 0
}
