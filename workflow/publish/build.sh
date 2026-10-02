#!/usr/bin/env bash
# workflow/publish/build.sh: the one home of the commands that turn a tower
# project into a built site. publish.sh and setup's first install run it on the
# home clone, the pages workflow on tower/app; run, never sourced, so it needs
# nothing else loaded.
# Usage: build.sh <install|mint|build> <project dir> [path prefix]

set -euo pipefail

usage() {
  printf 'usage: build.sh <install|mint|build> <project dir> [path prefix]%s\n' "${1:+; $1}" >&2
  exit 2
}

VERB="${1:-}"
DIR="${2:-}"
PREFIX="${3:-}"

case "$VERB" in
  install|mint|build) ;;
  *) usage "unknown verb '$VERB'" ;;
esac
[[ -n "$DIR" ]] || usage 'no project dir'
[[ -d "$DIR" ]] || usage "no folder at $DIR"

case "$VERB" in
  # Inside the project with `cd -P`, never `--prefix`: the folder may be a
  # symlink, and a prefixed npm keys the tree from the caller's cwd.
  install)
    cd -P "$DIR"
    npm install
    ;;

  # At the brand root, the mirror of the build. A call can exit 0 and mint
  # nothing, and the pages reference the minted logo unconditionally.
  mint)
    cd "$DIR"
    ./node_modules/.bin/omega manage --service=assets
    if [[ ! -d .omega/assets/logo ]]; then
      printf 'build: the mint left no logo at %s\n' "$DIR/.omega/assets/logo" >&2
      exit 1
    fi
    ;;

  # In the target, since `omega build` belongs to the web package; the prefix
  # is the path the site serves at.
  build)
    [[ -n "$PREFIX" ]] || usage 'no path prefix'
    OMEGA_PATH_PREFIX="$PREFIX" npm --prefix "$DIR/targets/web" run build
    if [[ ! -d "$DIR/targets/web/dist" ]]; then
      printf 'build: the build left no output at %s\n' "$DIR/targets/web/dist" >&2
      exit 1
    fi
    ;;
esac
