#!/usr/bin/env bash
# workflow/home/repo.sh: the setup steps that make the home. The login, the
# private repo, the clone, the empty-clone check, and the transform a copied
# manifest gets (its `file:` specs repointed absolute). SOURCED by home.sh,
# never executed, and it runs nothing at load: it defines functions and sets
# nothing. It reads lib.sh's WK_HOME_DIR and WK_USER_DIR.

# ── The setup steps ───────────────────────────────────────────────────────────

# The GitHub login, which names the repo. Empty when gh cannot answer.
wk_home_login() {
  command -v gh >/dev/null 2>&1 || return 1
  wk_spin 'reading the gh login' gh api user -q .login 2>/dev/null || return 1
}

# The repo itself. A repo that already exists is CURRENT, never an error: a
# second machine, or a second setup, finds the same home.
# Prints nothing; returns 0 created, 2 already there, 1 could not.
wk_home_ensure_repo() {
  local slug="$1"
  command -v gh >/dev/null 2>&1 || return 1
  if wk_spin "looking for $slug" gh repo view "$slug" --json name >/dev/null 2>&1; then return 2; fi
  wk_spin "creating $slug" gh repo create "$slug" --private >/dev/null 2>&1 || return 1
  return 0
}

# The clone, made the plain way: `git clone` into a path that does not exist.
#
# NOTHING is ever converted or adopted. `~/.workkit/tower` is a name only this
# engine gives, so an absent path is the ordinary case and anything already
# sitting there is somebody else's: a repo pointing elsewhere, or a folder a
# person made. Both stop the home steps rather than being taken over.
#
# `~/.workkit` itself is only ever mkdir'd: it is a plain folder, and a
# `git init` there would make the whole global layer a repo.
#
# Returns 0 (cloned, or already the clone), 1 (could not clone), 3 (something
# else is in the way: the one state that stops the rest of the home steps).
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
  # A repo GitHub just created is empty, and git clones it fine, with a warning
  # on stderr about an empty repository and no branch checked out. That warning
  # is the expected first-setup case, so the output is swallowed and only the
  # exit status is read; the seed below gives the clone its first commit.
  out="$(wk_spin "cloning $slug" git clone -q "$url" "$WK_HOME_DIR" 2>&1)" || {
    wk_warn "home: could not clone $slug into $WK_HOME_DIR; \`git clone $url $WK_HOME_DIR\` reports why"
    return 1
  }
  wk_ok "home: cloned $slug into $WK_HOME_DIR"
  return 0
}

# Whether the clone is EMPTY: a repo with no commit of its own, which is the
# only state the seed may write into. A clone that already carries the project
# is another machine's work and is never re-seeded.
wk_home_empty() {
  wk_is_repo_root "$WK_HOME_DIR" || return 1
  git -C "$WK_HOME_DIR" rev-parse --verify -q HEAD >/dev/null 2>&1 && return 1
  return 0
}

# Every `file:` dependency spec in one package.json, repointed at the absolute
# path it resolves to from the manifest it was COPIED FROM.
#
# The relative spec is truth in this checkout and nonsense in the clone: it
# counts directories up from `tower/app`, and the clone sits under `~/.workkit`.
# Committing the absolute path is the local-era acceptance the omega brand
# monorepo already makes for itself: the specs flip to registry ranges when
# OMEGA publishes, and that is the day this rewrite stops being needed.
#
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
    # `cd` rather than string arithmetic: the target is a real directory on this
    # machine, and only the filesystem can resolve `../..` through symlinks.
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

# The whole transform ONE manifest gets on its way out of the checkout: the
# `file:` specs repointed absolute, and (for the project root's manifest) the
# note that says why they now name a path.
#
# It is a function rather than two inline blocks because the SYNC has to compose
# the same thing (issue #129): a manifest compared against the RAW source
# differs by construction, so a content sync that compared it that way would
# rewrite it on every run forever. The sync applies this to a scratch copy and
# compares THAT (what would land) against what is already there.
#
# Usage: wk_home_project_manifest <manifest> <source package dir> [--root]
wk_home_project_manifest() {
  local pkg="$1" srcdir="$2" root="${3:-}"
  wk_home_repoint_file_specs "$pkg" "$srcdir"
  [[ "$root" == '--root' ]] || return 0
  [[ -f "$pkg" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0

  # The description says what the manifest now carries, the way the omega brand
  # monorepo's own does: a reader opening this repo on another machine has to
  # learn from the file itself why its dependencies name a path.
  wk_json_edit "$pkg" \
    --arg note ' Local era: the @omega.js frameworks resolve by absolute file: link into the omega monorepo on the machine that seeded this repo, until OMEGA publishes.' \
    '.description = ((.description // "") + $note)' >/dev/null 2>&1 || true
  return 0
}
