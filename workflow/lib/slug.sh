#!/usr/bin/env bash
# workflow/lib/slug.sh: what a repo is called, for the engine and the hooks.
# Sourced, functions only; the hooks source it directly so they never load the
# engine's addresses to read an origin.

# `owner/repo` from a git remote URL or a local path in either separator, since
# git stores a remote exactly as it was typed. The twin of `slugFromRemote` in
# ../slug.js, shape for shape: change one and change the other.
wk_slug_from_remote() {
  local url="${1:-}" trimmed
  # The twin's three trims in its order: whitespace, every trailing separator,
  # then `.git`. Whitespace alone names no repo.
  [[ "$url" =~ ^[[:space:]]*(.*[^[:space:]])[[:space:]]*$ ]] || return 0
  trimmed="${BASH_REMATCH[1]}"
  while [[ "$trimmed" == *[/\\] ]]; do trimmed="${trimmed%?}"; done
  trimmed="${trimmed%.git}"
  [[ "$trimmed" =~ [:/\\]([^:/\\]+)[/\\]([^/\\]+)$ ]] || return 0
  printf '%s/%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
}

# The origin slug of a git working tree, or empty when it has none.
wk_repo_slug() {
  local dir="${1:-.}" url
  url="$(git -C "$dir" remote get-url origin 2>/dev/null || true)"
  wk_slug_from_remote "$url"
}

# Whether <dir> lies in a git working tree whose origin names the workkit repo,
# any owner, any letter case: a clone of the kit itself.
wk_is_kit_checkout() {
  [[ -n "${1:-}" ]] || return 1
  wk_repo_slug "$1" | grep -Eiq '^[^/]+/workkit$'
}

# wk_roster_path <owner/name>: the folder of this machine's roster whose origin
# is that slug, any letter case, enabled entries only; 1 when none is. Loads
# platform.sh beside this when the caller has not, for wk_user_dir and wk_jq.
wk_roster_path() {
  local want key roster
  [[ -n "${1:-}" ]] || return 1
  declare -F wk_user_dir >/dev/null || . "${BASH_SOURCE[0]%/*}/platform.sh"
  command -v jq >/dev/null 2>&1 || return 1
  roster="$(wk_user_dir)/.repos.json"
  [[ -r "$roster" ]] || return 1
  want="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    if [[ "$(wk_repo_slug "$key" | tr '[:upper:]' '[:lower:]')" == "$want" ]]; then
      printf '%s\n' "$key"
      return 0
    fi
  done < <(wk_jq -r '(.repos // {}) | to_entries[] | select(.value == "enabled") | .key' "$roster" 2>/dev/null)
  return 1
}
