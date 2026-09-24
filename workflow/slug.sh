#!/usr/bin/env bash
# workflow/slug.sh: what a repo is CALLED, for the engine and for the hooks
# beside it. SOURCED, never executed, and it runs nothing at load: it defines
# functions and sets nothing.
#
# The sibling of platform.sh and participation.sh, reached the same way and for
# the same reason: the HOOK layer names a repo too, and a hook has no business
# loading the engine's addresses, its palette and its mutex to read an origin
# URL. platform.sh is the one home of what the PLATFORMS spell differently and
# participation.sh of what the KIT means by a repo; this is the one home of the
# NAME, so a roster, a project list and a guard's bounce cannot read the same
# remote and disagree about which repo it is.

# `owner/repo` from a git remote URL, in either form git writes it, and from a
# local path in either separator: git stores a remote exactly as it was given,
# so a path typed natively on Windows comes back with backslashes and a reader
# that took only a forward slash answered nothing about it. The trims and the
# regex are `slugFromRemote` in slug.js beside this file, shape for shape, so the
# roster and the home repo's project list can never disagree about what a repo
# is called.
wk_slug_from_remote() {
  local url="${1:-}" trimmed
  # The three trims the Node twin makes, in the same order: the whitespace
  # around the URL, then EVERY trailing separator, then the `.git` a path that
  # ended in one is still wearing. A string with nothing in it but whitespace
  # names no repo and stops here.
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
