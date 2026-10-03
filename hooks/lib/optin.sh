#!/bin/bash
# hooks/lib/optin.sh: the repo a hook acts on and whether it opted in, the one
# question hooks/loader.sh asks before it starts a hook. SOURCED by the loader,
# never executed: it defines functions and, at load, sets _HOOK_OPTIN_LIB, its
# own folder. Its functions leave their answers in HOOK_OPTIN_* names (ROOT,
# SLUGS, GH_HERE, GH_ONLY, DIRS, FOLDED). It sources the engine files and
# lib/commit.sh it reads; lib/gh-edit.sh loads only for a command naming a
# gh repo.

_HOOK_OPTIN_LIB="$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)"
# shellcheck source=../../workflow/lib/participation.sh
. "$_HOOK_OPTIN_LIB/../../workflow/lib/participation.sh"
# shellcheck source=../../workflow/lib/slug.sh
. "$_HOOK_OPTIN_LIB/../../workflow/lib/slug.sh"
# shellcheck source=commit.sh
declare -F hook_step_dirs >/dev/null || . "$_HOOK_OPTIN_LIB/commit.sh"

# _hook_optin_root_of <path>: HOOK_OPTIN_ROOT becomes the root of the repo
# holding <path>, walked up from its nearest existing folder (a Write may name a
# file not made yet): as spelled, else from that folder's physical path, since
# a path through a link (~/.claude/skills) names its repo only behind the link.
_hook_optin_root_of() {
  local dir="${1//\\//}" phys
  HOOK_OPTIN_ROOT=""
  # A linked file (~/.claude/settings.json) is in its repo only where it really is.
  if [ -L "$dir" ] && [ ! -d "$dir" ]; then
    phys=$(readlink "$dir") || return 0
    case "$phys" in /*) dir="$phys" ;; *) dir="${dir%/*}/$phys" ;; esac
  fi
  while [ -n "$dir" ] && [ ! -d "$dir" ]; do
    [ "${dir%/*}" != "$dir" ] || return 0
    dir="${dir%/*}"
  done
  _hook_optin_climb "$dir" && return 0
  phys=$(cd -P "$dir" 2>/dev/null && pwd -P) || return 0
  [ "$phys" != "$dir" ] || return 0
  _hook_optin_climb "$phys" || true
}

# _hook_optin_climb <dir>: HOOK_OPTIN_ROOT becomes the first repo root at or
# above the existing folder <dir>, by text; 1 when none is.
_hook_optin_climb() {
  local dir="$1"
  while [ -n "$dir" ]; do
    if wk_is_repo_root "$dir"; then
      HOOK_OPTIN_ROOT="$dir"
      return 0
    fi
    [ "${dir%/*}" != "$dir" ] || return 1
    dir="${dir%/*}"
  done
  return 1
}

# _hook_optin_gh_repos <text>: over every `gh` clause of the heredoc-stripped
# <text>, HOOK_OPTIN_SLUGS becomes each repo one names through hook_gh_repo (a
# quoted span is never a flag), one a line, each spelling once, and
# HOOK_OPTIN_GH_HERE 1 when a clause names none. 1 when a value is unreadable.
_hook_optin_gh_repos() {
  local text clause repo
  declare -F hook_gh_repo >/dev/null || . "$_HOOK_OPTIN_LIB/gh-edit.sh"
  HOOK_OPTIN_SLUGS="" HOOK_OPTIN_GH_HERE=0
  text=$(hook_fold_redirect_amp "$1")
  while IFS= read -r clause; do
    [ -n "$clause" ] || continue
    [[ "$(hook_strip_quotes "$clause")" =~ (^|[^[:alnum:]_./-])gh[[:space:]] ]] || continue
    repo=$(hook_gh_repo "$clause") || return 1
    if [ -z "$repo" ]; then HOOK_OPTIN_GH_HERE=1; continue; fi
    case $'\n'"$HOOK_OPTIN_SLUGS" in *$'\n'"$repo"$'\n'*) continue ;; esac
    HOOK_OPTIN_SLUGS="$HOOK_OPTIN_SLUGS$repo"$'\n'
  done <<EOF
$(hook_gh_clauses "$text")
EOF
}

# _hook_optin_fold <path>: HOOK_OPTIN_FOLDED becomes <path> with its `.` and
# `..` folded away by text, as the shell's own cd folds them, so a walk up from
# it climbs only real parents.
_hook_optin_fold() {
  local p="${1//\\//}" head="" part parts out=""
  case "$p" in
    */.|*/./*|*/..|*/../*) ;;
    *) HOOK_OPTIN_FOLDED="$p"; return 0 ;;
  esac
  case "$p" in [A-Za-z]:/*) head="${p%%/*}"; p="${p#*/}" ;; esac
  IFS=/ read -r -a parts <<<"$p"
  for part in "${parts[@]}"; do
    case "$part" in
      ''|.) ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$part" ;;
    esac
  done
  HOOK_OPTIN_FOLDED="$head${out:-/}"
}

# _hook_optin_may_move <text>: the cheap test sparing most commands the walk:
# could <text> move its folder or repo by a cd/pushd/popd or eval word, a short
# flag cluster holding c or C, git's folder flags or their variables? An empty
# quote pair is dropped first, as the shell drops it (`c''d`).
_hook_optin_may_move() {
  local t="${1//\'\'/}" re='(^|[^[:alnum:]_.-])eval([^[:alnum:]_.-]|$)|[[:space:]]-[[:alpha:]]*[cC]|--git-dir|--work-tree|GIT_DIR=|GIT_WORK_TREE=|CDPATH='
  t="${t//\"\"/}"
  hook_names_dir_change "$t" || [[ $t =~ $re ]]
}

# _hook_optin_moves <step>: does the QUOTE STRIPPED step move its target where
# the cd walk cannot follow: a quoted command word, eval, an interpreter's -c
# string (hook_is_interpreter), or git's -C, --git-dir or --work-tree? Leaves
# HOOK_PEEL_* set for the step.
_hook_optin_moves() {
  local words
  read -r -a words <<<"$1"
  hook_peel_prefixes ${words[@]+"${words[@]}"}
  [ "$HOOK_PEEL_EVAL" -eq 0 ] || return 0
  case "$HOOK_PEEL_WORD" in *_hookq_*) return 0 ;; esac
  set -- ${words[@]+"${words[@]:$((HOOK_PEEL_SKIP + 1))}"}
  if hook_is_interpreter "$HOOK_PEEL_WORD"; then
    while [ $# -gt 0 ]; do
      case "$1" in
        --*|*'>'*|*'<'*) ;;
        -*c*) return 0 ;;
        -*) ;;
        *) return 1 ;;
      esac
      shift
    done
    return 1
  fi
  case "$HOOK_PEEL_WORD" in git|*/git) ;; *) return 1 ;; esac
  while [ $# -gt 0 ]; do
    case "$1" in
      -C*|--git-dir|--git-dir=*|--work-tree|--work-tree=*) return 0 ;;
      -c|--namespace|--exec-path) shift ;;
      -*|*'>'*|*'<'*) ;;
      *) return 1 ;;
    esac
    [ $# -eq 0 ] || shift
  done
  return 1
}

# _hook_optin_walk <text> <cwd>: over the heredoc-stripped <text>,
# HOOK_OPTIN_DIRS becomes every folder a cd step lands in, one per line, and
# HOOK_OPTIN_GH_ONLY 1 when every step is a gh clause. 2 when the command moves
# its target in a way the walk cannot follow.
_hook_optin_walk() {
  local s subs kind dir step re='(^|[^[:alnum:]_])(GIT_DIR|GIT_WORK_TREE|CDPATH)='
  HOOK_OPTIN_DIRS=""
  HOOK_OPTIN_GH_ONLY=1
  s=$(hook_strip_quotes "$1")
  # A substitution the strip hides from the walk: a backtick, or a `$(` inside
  # a quoted span (the strip leaves fewer of them).
  if _hook_optin_may_move "$1"; then
    case "$1" in *'`'*) return 2 ;; esac
    subs="${1//\$\(/}"
    dir="${s//\$\(/}"
    [ $(( ${#1} - ${#subs} )) -eq $(( ${#s} - ${#dir} )) ] || return 2
  fi
  s=$(hook_fold_redirect_amp "$s")
  [[ $s =~ $re ]] && return 2
  while IFS=$'\037' read -r kind dir step; do
    _hook_optin_moves "$step" && return 2
    case "$HOOK_PEEL_WORD" in gh|*/gh) ;; *) HOOK_OPTIN_GH_ONLY=0 ;; esac
    hook_names_dir_change "$step" || continue
    hook_cd_step "$dir" "$step"
    # A quoted folder reads as a placeholder after the strip: not followed.
    case "$HOOK_CD_DIR" in
      '?'|*_hookq_*) return 2 ;;
      /*|[A-Za-z]:/*) dir="$HOOK_CD_DIR" ;;
      *) [ -n "$2" ] || return 2; dir="$2/$HOOK_CD_DIR" ;;
    esac
    _hook_optin_fold "$dir"
    HOOK_OPTIN_DIRS="$HOOK_OPTIN_DIRS$HOOK_OPTIN_FOLDED"$'\n'
  done < <(hook_step_dirs "$s")
  return 0
}

# _hook_optin_roots <dirs>: the root of the repo holding each folder of the
# newline-separated <dirs>, one per line, each root printed once.
_hook_optin_roots() {
  local dir seen=$'\n'
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    _hook_optin_root_of "$dir"
    [ -n "$HOOK_OPTIN_ROOT" ] || continue
    case "$seen" in *$'\n'"$HOOK_OPTIN_ROOT"$'\n'*) continue ;; esac
    seen="$seen$HOOK_OPTIN_ROOT"$'\n'
    printf '%s\n' "$HOOK_OPTIN_ROOT"
  done <<<"$1"
}

# _hook_optin_bash <command> <cwd>: the roots a Bash command acts on: the cwd and
# each folder a cd lands in, and the rostered root of every repo a gh clause
# names. Those decide alone when every step is a gh clause and each names a
# repo. 2 when the command cannot be placed or a gh repo value cannot be read.
_hook_optin_bash() {
  local text gh=0 slug
  HOOK_OPTIN_SLUGS="" HOOK_OPTIN_GH_HERE=0
  case "$1" in
    *--repo*|*-R*|*github.com/*/issues/*|*github.com/*/pull/*) gh=1 ;;
  esac
  if [ "$gh" -eq 0 ] && ! _hook_optin_may_move "$1"; then
    _hook_optin_roots "$2"
    return 0
  fi
  text=$(hook_strip_heredocs "$1")
  if [ "$gh" -eq 1 ]; then _hook_optin_gh_repos "$text" || return 2; fi
  if [ -z "$HOOK_OPTIN_SLUGS" ] && ! _hook_optin_may_move "$text"; then
    _hook_optin_roots "$2"
    return 0
  fi
  _hook_optin_walk "$text" "$2" || return 2
  while IFS= read -r slug; do
    [ -n "$slug" ] || continue
    wk_roster_path "$slug" || true
  done <<<"$HOOK_OPTIN_SLUGS"
  # A gh clause naming no repo acts on the cwd's, so the cwd joins then too.
  if [ -n "$HOOK_OPTIN_SLUGS" ] && [ "$HOOK_OPTIN_GH_ONLY" -eq 1 ] && [ "$HOOK_OPTIN_GH_HERE" -eq 0 ]; then
    return 0
  fi
  _hook_optin_roots "$2"$'\n'"$HOOK_OPTIN_DIRS"
}

# hook_optin_repo <input_json>: prints the root of each repo the hook acts on,
# one per line: an Edit/Write/NotebookEdit's file, else the Bash command's
# (_hook_optin_bash), else the cwd's. 2 when a Bash command cannot be placed; 1
# when it cannot decide (no jq, bad input). Loads platform.sh for wk_jq.
hook_optin_repo() {
  local tool cwd path cmd
  command -v jq >/dev/null 2>&1 || return 1
  declare -F wk_jq >/dev/null || . "$_HOOK_OPTIN_LIB/../../workflow/lib/platform.sh"
  {
    IFS= read -r -d '' tool && IFS= read -r -d '' cwd \
      && IFS= read -r -d '' path && IFS= read -r -d '' cmd
  } < <(printf '%s' "$1" | wk_jq -j '[.tool_name, .cwd,
      (.tool_input.file_path // .tool_input.notebook_path), .tool_input.command]
      | map((. // "" | tostring) + "\u0000") | add' 2>/dev/null) || return 1

  case "$tool" in
    Edit|Write|NotebookEdit)
      if [ -n "$path" ]; then
        case "${path//\\//}" in
          /*|[A-Za-z]:/*) ;;
          *) path="$cwd/$path" ;;
        esac
        _hook_optin_roots "$path"
        return 0
      fi
      ;;
    Bash)
      _hook_optin_bash "$cmd" "$cwd" || return 2
      return 0
      ;;
  esac
  _hook_optin_roots "$cwd"
}

# hook_repo_opted_in <root>: exit 0 when the repo at <root> opted in: a
# settings file not declined, a file with no `enabled` key the legacy yes. The
# folder name's SSOT is WORKKIT_DIR in hooks/_lib.sh; change both together.
hook_repo_opted_in() {
  [ -n "${1:-}" ] && [ -f "$1/.workkit/settings.json" ] || return 1
  ! wk_settings_declined "$1/.workkit/settings.json"
}
