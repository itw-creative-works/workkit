#!/usr/bin/env bash
# workflow/home/repo.sh: the setup steps that make the home, and the transform a
# copied manifest gets. Sourced by home.sh, functions only. Reads lib.sh's
# WK_HOME_DIR and WK_USER_DIR.

# ── The setup steps ───────────────────────────────────────────────────────────

# The GitHub login, which names the repo. Empty when gh cannot answer.
wk_home_login() {
  command -v gh >/dev/null 2>&1 || return 1
  wk_spin 'reading the gh login' gh api user -q .login 2>/dev/null || return 1
}

# An existing repo is current, never an error: a second machine finds the same
# home. Prints nothing; returns 0 created, 2 already there, 1 could not.
wk_home_ensure_repo() {
  local slug="$1"
  command -v gh >/dev/null 2>&1 || return 1
  if wk_spin "looking for $slug" gh repo view "$slug" --json name >/dev/null 2>&1; then return 2; fi
  wk_spin "creating $slug" gh repo create "$slug" --private >/dev/null 2>&1 || return 1
  return 0
}

# A plain `git clone` into a path that does not exist: anything already there
# is somebody else's and is never adopted. `~/.workkit` itself is only mkdir'd.
# Returns 0 (cloned, or already the clone), 1 (could not clone), 3 (something
# else is in the way, which stops the rest of the home steps).
wk_home_clone() {
  local slug="$1" url existing out
  url="$(wk_home_remote_url "$slug")"

  if [[ -e "$WK_HOME_DIR" ]]; then
    if wk_home_matches "$slug"; then
      wk_skip "home: $WK_HOME_DIR is the clone of $slug"
      return 0
    fi
    existing="$(wk_home_clone_slug)"
    if [[ -n "$existing" ]]; then
      wk_warn "home: $WK_HOME_DIR is a git repo pointing at $existing; leaving it alone; move it aside if $slug should live there"
    else
      wk_warn "home: $WK_HOME_DIR already exists and is not a clone of $slug; leaving it alone; move it aside, then run \`workkit setup\` again"
    fi
    return 3
  fi

  mkdir -p "$WK_USER_DIR" 2>/dev/null || { wk_warn "home: could not create $WK_USER_DIR"; return 1; }
  # A fresh repo is empty and git warns about it: the expected first-setup case,
  # so only the exit status is read.
  out="$(wk_spin "cloning $slug" git clone -q "$url" "$WK_HOME_DIR" 2>&1)" || {
    wk_warn "home: could not clone $slug into $WK_HOME_DIR; \`git clone $url $WK_HOME_DIR\` reports why"
    return 1
  }
  wk_ok "home: cloned $slug into $WK_HOME_DIR"
  return 0
}

# A clone with no commit of its own, the only state the seed may write into.
wk_home_empty() {
  wk_is_repo_root "$WK_HOME_DIR" || return 1
  git -C "$WK_HOME_DIR" rev-parse --verify -q HEAD >/dev/null 2>&1 && return 1
  return 0
}

# Every `file:` spec in one package.json, repointed at the absolute path it
# resolves to from the manifest it was copied from, since a relative one means
# nothing in the clone. Only a maintainer tree left in local mode carries one.
# The seed applies it, and the sync applies it to a scratch copy to compare.
# Usage: wk_home_repoint_file_specs <seeded package.json> <source package dir>
wk_home_repoint_file_specs() {
  local pkg="$1" srcdir="$2" specs name spec rel abs
  [[ -f "$pkg" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  specs="$(wk_jq -r '
    [(.dependencies // {}), (.devDependencies // {})]
    | add // {}
    | to_entries[]
    | select(.value | startswith("file:"))
    | "\(.key)\t\(.value)"' "$pkg" 2>/dev/null || true)"

  while IFS="$(printf '\t')" read -r name spec; do
    [[ -n "$name" ]] || continue
    rel="${spec#file:}"
    # `cd`, since only the filesystem can resolve `../..` through symlinks.
    abs="$(cd "$srcdir/$rel" 2>/dev/null && pwd -P || printf '')"
    if [[ -z "$abs" ]]; then
      wk_warn "home: the seeded $name still points at $spec; nothing resolves it from $srcdir, so the tower project cannot build until it does"
      continue
    fi
    wk_json_edit "$pkg" --arg n "$name" --arg v "file:$abs" '
      (if (.dependencies // {} | has($n)) then .dependencies[$n] = $v else . end)
      | (if (.devDependencies // {} | has($n)) then .devDependencies[$n] = $v else . end)' \
      >/dev/null 2>&1 || true
  done <<<"$specs"
  return 0
}
