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
