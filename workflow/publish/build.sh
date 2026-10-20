#!/usr/bin/env bash
# workflow/publish/build.sh: the one home of the commands that turn a tower
# project into a built site. publish.sh and setup's first install run it on the
# home clone, the pages workflow on tower/app; run, never sourced, loading the
# engine's lib.sh and home.sh itself.
# Usage: build.sh <install|mint|build> <project dir> [path prefix]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=../lib.sh
. "$SCRIPT_DIR/../lib.sh"
# shellcheck source=../home.sh
. "$SCRIPT_DIR/../home.sh"

SIDEBAR_REL='targets/web/src/_includes/backend/sections/sidebar.json'

# jq: each row in the app file's own style, bare keys, single quotes, trailing
# commas. tojson's escapes hold in a single-quoted string once \" is unescaped.
SIDEBAR_JSON5='
  def q: tojson | .[1:-1] | gsub("\\\\\""; "\"") | gsub("'"'"'"; "\\'"'"'") | "'"'"'\(.)'"'"'";
  .[] | "    {",
    (to_entries[] | "      \(.key | if test("^[A-Za-z_$][A-Za-z0-9_$]*$") then . else q end): \(.value | if type == "string" then q else tojson end),"),
    "    },"'

usage() {
  printf 'usage: build.sh <install|mint|build> <project dir> [path prefix]%s\n' "${1:+; $1}" >&2
  exit 2
}

# The rows before the links list's closing bracket, the app's text kept: the
# file is JSON5, which jq cannot parse. Fails when the list is not last.
# Usage: SIDEBAR_ITEMS=<rows> wk_sidebar_splice <app text>
wk_sidebar_splice() {
  printf '%s\n' "$1" | awk '
    { line[NR] = $0 }
    END {
      for (i = NR; i > 0; i--) if (line[i] ~ /^[[:space:]]*\],?[[:space:]]*$/) { close_at = i; break }
      if (!close_at) exit 1
      for (i = close_at + 1; i <= NR; i++) if (line[i] !~ /^[[:space:]]*(\}[[:space:]]*)?$/) exit 1
      for (prev = close_at - 1; prev > 1 && line[prev] ~ /^[[:space:]]*(\/\/.*)?$/; prev--) ;
      if (line[prev] !~ /[,[][[:space:]]*$/) line[prev] = line[prev] ","
      n = split(ENVIRON["SIDEBAR_ITEMS"], items, "\n")
      for (i = 1; i < close_at; i++) print line[i]
      for (i = 1; i <= n; i++) if (items[i] != "") print items[i]
      for (i = close_at; i <= NR; i++) print line[i]
    }'
}

# The app's copy back over the merged file, byte for byte, so the next sync and
# mint see no change: the merged sidebar exists only for the build.
# Usage: wk_sidebar_restore <clone>
wk_sidebar_restore() {
  wk_home_file "$WK_TOWER_APP" "$SIDEBAR_REL" >"$1/$SIDEBAR_REL" \
    || wk_warn "sidebar: could not put the app's $SIDEBAR_REL back in $1"
}

# site.sidebar's groups after the built-in ones, rebuilt from the app's copy on
# every run so a second build holds them once. The app itself is never touched:
# the central copy builds it and never reads the setting.
# Usage: wk_sidebar_merge <clone>
wk_sidebar_merge() {
  local clone="$1" raw items app out
  [[ "$(cd -P "$clone" && pwd)" == "$WK_TOWER_APP" ]] && return 0
  raw="$(wk_json_get "$WK_HOME_SETTINGS" '.site.sidebar')"
  [[ -n "$raw" ]] || return 0
  items="$(printf '%s\n' "$raw" | wk_jq -c '
    if type == "array" and all(.[]; type == "object" and (.header | type) == "string"
      and (.links | type) == "array" and all(.links[]; type == "object"))
    then [.[] | {header: true, label: .header}, .links[]] else error("not a list of groups") end' 2>/dev/null)" || {
    wk_warn 'sidebar: site.sidebar is not a list of groups; the built-in sidebar is published'
    return 0
  }
  if [[ -z "$WK_TOWER_APP" ]] || ! app="$(wk_home_file "$WK_TOWER_APP" "$SIDEBAR_REL")"; then
    wk_warn "sidebar: the app's $SIDEBAR_REL could not be read; $clone keeps its own sidebar"
    return 0
  fi

  # A JSON copy takes the items through jq; the shipped JSON5 one is spliced.
  if printf '%s\n' "$app" | wk_jq empty >/dev/null 2>&1; then
    out="$(printf '%s\n' "$app" | wk_jq --argjson items "$items" '.links += $items')"
  elif ! out="$(SIDEBAR_ITEMS="$(printf '%s\n' "$items" | wk_jq -r "$SIDEBAR_JSON5")" wk_sidebar_splice "$app")"; then
    wk_warn "sidebar: the app's $SIDEBAR_REL does not end in its links list; the built-in sidebar is published"
    return 0
  fi
  # shellcheck disable=SC2064  # expand $clone now: the trap runs after this call
  trap "wk_sidebar_restore $(printf '%q' "$clone")" EXIT
  printf '%s\n' "$out" >"$clone/$SIDEBAR_REL"
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
    wk_sidebar_merge "$DIR"
    OMEGA_PATH_PREFIX="$PREFIX" npm --prefix "$DIR/targets/web" run build
    if [[ ! -d "$DIR/targets/web/dist" ]]; then
      printf 'build: the build left no output at %s\n' "$DIR/targets/web/dist" >&2
      exit 1
    fi
    ;;
esac
