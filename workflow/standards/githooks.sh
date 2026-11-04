#!/usr/bin/env bash
# workflow/standards/githooks.sh: git's client-side hooks for a repo, the kit's
# githooks folder set as its core.hooksPath (workflow/README.md, the githooks/
# row). Sourced by standards.sh, by workkit setup and doctor for their This
# repo line and by script-shell.sh after an install-time script, each after
# lib.sh; functions only. SCRIPT_DIR is the sourcing entry's, the workflow folder.

# wk_githooks_address: the folder core.hooksPath should name, through the
# engine link when it points at this engine, so a plugin update that moves the
# kit leaves the path good; the kit's own folder where the link is missing.
wk_githooks_address() {
  local link="${ENGINE_LINK:-${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}/workkit}" target here
  here="$(cd -P "$SCRIPT_DIR" 2>/dev/null && pwd -P)"
  if [[ -L "$link" ]] && target="$(cd -P "$link" 2>/dev/null && pwd -P)" && [[ -n "$here" && "$target" == "$here" ]]; then
    printf '%s' "$link/githooks"
    return 0
  fi
  printf '%s' "$SCRIPT_DIR/githooks"
}

# git_hooks_installed <root>: prints the folder core.hooksPath names, read with
# --path so a ~/ spelling is expanded, 0 when it is a kit's hooks folder
# (wk_githooks_kit, lib/participation.sh); 1 for any other value or none.
git_hooks_installed() {
  local path
  path="$(git -C "$1" config --local --path core.hooksPath 2>/dev/null)" || return 1
  wk_githooks_kit "$1" "$path" >/dev/null || return 1
  printf '%s' "$path"
}

# ── 1c. git runs the kit's commit hooks, in git's spelling of the path ──
# The repo's own folder (husky's) is saved once to workkit.hooksPath for the
# chain; a kit-like one (wk_githooks_kitlike) is repointed, unless that kit is a
# workkit clone, which outranks the plugin cache.
ensure_git_hooks() {
  local root="$1" ours current kit saved verb=set kept=""
  ours="$(wk_native_path "$(wk_githooks_address)")"
  current="$(git -C "$root" config --local --path core.hooksPath 2>/dev/null)" || current=""
  if [[ "$current" == "$ours" ]]; then
    wk_skip "git hooks: installed ($ours)"
    return 0
  fi
  if kit="$(wk_githooks_kit "$root" "$current")"; then
    if [[ "$kit" != "$(cd -P "$SCRIPT_DIR/.." && pwd -P)" ]] && wk_clone_outranks "$SCRIPT_DIR/.." "$kit"; then
      wk_skip "git hooks: installed ($current), the workkit clone, which outranks the plugin cache"
      return 0
    fi
    verb=repointed
  elif wk_githooks_kitlike "$root" "$current"; then
    verb=repointed
  elif [[ -n "$current" ]]; then
    saved="$(git -C "$root" config --local workkit.hooksPath 2>/dev/null)" || saved=""
    if [[ -z "$saved" ]] && ! git -C "$root" config --local workkit.hooksPath "$current"; then
      wk_warn "git hooks: could not save core.hooksPath ($current) to workkit.hooksPath in $(wk_native_path "$root"), so ours were not set; run \`workkit heal\` again"
      needs_attention=1
      return 0
    fi
    kept="; the repo's own hooks in ${saved:-$current} run after ours"
  fi
  if ! git -C "$root" config --local core.hooksPath "$ours"; then
    wk_warn "git hooks: could not set core.hooksPath in $(wk_native_path "$root"); run \`git -C $(wk_native_path "$root") config core.hooksPath $ours\`"
    needs_attention=1
    return 0
  fi
  wk_ok "git hooks: $verb core.hooksPath → $ours$kept"
}
