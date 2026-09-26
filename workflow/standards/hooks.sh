#!/usr/bin/env bash
# workflow/standards/hooks.sh: the once-a-day assertion that the hook layer
# beside the engine is alive: every wired hook resolves, is executable and
# parses, and the tools they call are present. SOURCED by standards.sh, never
# executed, and it runs nothing at load: it defines functions and sets
# nothing. HOOKS_DIR, HOOK_TOOLS and the hooks_checked counter are the
# entry's.

# ── 5. The hook layer is alive ──
# Every hook fails OPEN by design (a broken hook must never wedge a session)
# so a chmod-stripped script, a syntax error, or a missing tool disables a
# safety layer with nothing watching (issue #2). The per-event fail-open stays;
# this is the once-a-day assertion that the layer exists at all.
#
# Reports only, in two registers. A hook that cannot run is a BROKEN INSTALL:
# it warns and flags the run, the same as a missing template. A missing TOOL is
# a machine condition, not a repo's fault. It warns just as loudly but does not
# flag the run, so the version stamp and the drift report are not held hostage
# to something no repo can fix.
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
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    check_hook_script "$name" "$HOOKS_DIR/${name//://}/run.sh"
  done < <(hook_names)

  # The extraction's name filter is exact on purpose, so a wired command it
  # cannot parse would silently fall out of the check. Compare against the
  # raw count of loader.sh commands and say so instead.
  local wired
  wired="$(wk_jq -r '.. | objects | select(has("command")) | .command' "$HOOKS_DIR/hooks.json" 2>/dev/null \
    | grep 'loader\.sh' | sort -u | grep -c . || true)"
  if [[ -n "$wired" && "$wired" -gt $((hooks_checked - 1)) ]]; then
    wk_warn "hooks: $wired commands are wired through loader.sh but only $((hooks_checked - 1)) resolved to checkable names; a hook name the checker cannot parse is going unchecked"
  fi

  [[ "$hooks_checked" -gt 0 ]] && wk_skip "hooks: $hooks_checked hook scripts resolve, are executable, and parse"
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
