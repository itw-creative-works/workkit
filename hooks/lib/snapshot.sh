#!/bin/bash
# hooks/lib/snapshot.sh: the repo snapshot scripts/red-proof.sh runs against,
# which workflow:snapshot takes at the claim to status:building: its folder,
# take, add issues, the stale check, drop, and the per-run copy's worktree and
# fill, which workflow/prove.sh shares.
# SOURCED by hooks/_lib.sh, where it defines functions and sets nothing. It
# reads hook_is_* and hook_jq (the entry) and hook_working_paths (lib/tree.sh).
# RUN directly, the hooks module's entry: `bash snapshot.sh
# take|add|stale|drop <root> [args]` (the foot of the file).

# hook_snapshot_root <dir>: the root of the repo holding <dir>, spelled by
# pwd -P, the one key the hook and red-proof both find a snapshot by; 1 when
# <dir> lies in no git repository.
hook_snapshot_root() {
  local cdup
  cdup=$(git -C "$1" rev-parse --show-cdup 2>/dev/null) || return 1
  (cd -P "$1" 2>/dev/null && cd -P "./$cdup" 2>/dev/null && pwd -P)
}

# hook_snapshot_dir <root>: the snapshot folder of that root, holding `tree/`,
# `head` (one sha line), `paths` (NUL-separated, as hook_working_paths prints)
# and `issues` (one number a line). A snapshot is live while `tree` exists.
hook_snapshot_dir() { wk_marker_path claude-red-snapshot "$1"; }

# _hook_snapshot_modules_list <dir>: each package's node_modules folder in
# <dir>, one ./-led path a line: beside every package.json git lists there,
# tracked or untracked and not ignored, none under a node_modules. Empty
# outside a git work tree (a snapshot tree holds no package's node_modules).
_hook_snapshot_modules_list() {
  [ "$(git -C "$1" rev-parse --is-inside-work-tree 2>/dev/null)" = true ] || return 0
  (
    set -o pipefail
    git -C "$1" ls-files -z --cached --others --exclude-standard -- ':(glob)**/package.json' \
      | while IFS= read -r -d '' file; do
        ! _hook_snapshot_in_modules "$file" || continue
        case "$file" in */*) file="./${file%/*}/node_modules" ;; *) file="./node_modules" ;; esac
        [ ! -d "$1/$file" ] || printf '%s\n' "$file"
      done
  )
}

# _hook_snapshot_is_held <held> <rel>: whether ./<rel> is a line of <held>.
_hook_snapshot_is_held() { case $'\n'"$1"$'\n' in *$'\n'"./$2"$'\n'*) return 0 ;; esac; return 1; }

# _hook_snapshot_held_under <held> <rel>: whether a line of <held> lies under
# ./<rel>/.
_hook_snapshot_held_under() { case $'\n'"$1" in *$'\n'"./$2/"*) return 0 ;; esac; return 1; }

# _hook_snapshot_copy <src> <dest> [rel]...: every entry of <src> (or each rel
# whose parent <dest> holds) into <dest>, `.git` and each package's
# node_modules left out (the fill rebuilds those from the live repo), symlinks
# kept. The tools' words go to stderr.
_hook_snapshot_copy() {
  local src="$1" dest="$2" entry rel held anchor="" flags=(-pPR) rels=() excludes=(--exclude=./.git)
  shift 2
  held=$(_hook_snapshot_modules_list "$src") \
    || { echo "could not list the package node_modules folders under $src" >&2; return 1; }
  for rel in "$@"; do
    rel="${rel%/}"
    ! _hook_snapshot_is_held "$held" "$rel" || continue
    case "$rel" in */*) [ -d "$dest/${rel%/*}" ] || continue ;; esac
    rels+=("$rel")
  done
  [ $# -eq 0 ] || [ ${#rels[@]} -gt 0 ] || return 0
  if hook_is_windows; then
    # Every member streams ./-led, so GNU tar, which tries a pattern after each
    # slash, matches a ./-led one only at the start; bsdtar needs ^ to anchor.
    case "$(tar --version 2>/dev/null)" in *bsdtar*) anchor="^" ;; esac
    while IFS= read -r entry; do
      [ -z "$entry" ] || excludes+=("--exclude=$anchor$(_hook_snapshot_glob_quote "$entry")")
    done <<<"$held"
    if [ ${#rels[@]} -gt 0 ]; then rels=("${rels[@]/#/./}"); else rels=(.); fi
    (set -o pipefail; cd "$src" && tar -cf - "${excludes[@]}" -- "${rels[@]}" | tar -xf - -C "$dest")
    return
  fi
  if hook_is_macos; then
    flags=(-c -pPR)
  elif hook_is_linux; then
    flags=(-a --reflink=auto)
  fi
  if [ ${#rels[@]} -eq 0 ]; then
    while IFS= read -r -d '' entry; do
      rels+=("${entry##*/}")
    done < <(find "$src" -mindepth 1 -maxdepth 1 ! -name .git -print0)
    [ ${#rels[@]} -gt 0 ] || return 0
  fi
  for rel in "${rels[@]}"; do
    _hook_snapshot_put "$src" "$dest" "$rel" "$held" "${flags[@]}" || return 1
  done
}

# _hook_snapshot_glob_quote <path>: <path> with each wildcard character
# backslashed, so a tar pattern matches it literally.
_hook_snapshot_glob_quote() {
  local p="${1//\\/\\\\}"
  p="${p//\*/\\*}"
  p="${p//\?/\\?}"
  printf '%s\n' "${p//\[/\\[}"
}

# _hook_snapshot_put <src> <dest> <rel> <held> <cp flag>...: <rel> copied whole
# into <dest> by cp, unless it is a package's node_modules (in <held>, the
# ./-led list: left out) or a folder holding one, which is made and walked
# entry by entry.
_hook_snapshot_put() {
  local src="$1" dest="$2" rel="$3" held="$4" entry
  shift 4
  ! _hook_snapshot_is_held "$held" "$rel" || return 0
  if _hook_snapshot_held_under "$held" "$rel"; then
    mkdir -p "$dest/$rel" || return 1
    while IFS= read -r -d '' entry; do
      _hook_snapshot_put "$src" "$dest" "$rel/${entry##*/}" "$held" "$@" || return 1
    done < <(find "$src/$rel" -mindepth 1 -maxdepth 1 -print0)
    return 0
  fi
  case "$rel" in */*) entry="$dest/${rel%/*}/" ;; *) entry="$dest/" ;; esac
  cp "$@" "$src/$rel" "$entry"
}

# hook_snapshot_take <root> [issue]...: a fresh snapshot of <root>, replacing
# any there. The whole folder (head, paths, issues, then the tree) is built in a
# sibling <dir>.XXXXXX and moved into place last, so a half snapshot is never
# found. 1 with the error on stderr, the sibling gone and any snapshot kept.
hook_snapshot_take() {
  local root="$1" dir head part aside
  shift
  dir=$(hook_snapshot_dir "$root") || { echo "could not name the snapshot folder" >&2; return 1; }
  mkdir -p "${dir%/*}" || { echo "could not make ${dir%/*}" >&2; return 1; }
  # A sibling older than the hook's 600s timeout is a killed take's, never a live one.
  find "${dir%/*}" -maxdepth 1 -name "${dir##*/}.??????" -mmin +10 -exec rm -rf {} + 2>/dev/null || true
  part=$(mktemp -d "$dir.XXXXXX") || { echo "could not make a folder beside $dir" >&2; return 1; }
  if ! head=$(git -C "$root" rev-parse --verify -q HEAD) || [ -z "$head" ]; then
    echo "$root has no HEAD commit" >&2
  elif ! printf '%s\n' "$head" >"$part/head" || ! : >"$part/issues"; then
    echo "could not write into $part" >&2
  elif ! hook_working_paths "$root" >"$part/paths"; then
    echo "could not list the working diff of $root" >&2
  elif ! _hook_snapshot_record "$part/issues" "$@"; then
    echo "could not record the issues in $part" >&2
  elif mkdir "$part/tree" && _hook_snapshot_copy "$root" "$part/tree"; then
    # What a failed remove leaves goes aside under a stale take's name, which the
    # sweep above clears at a later take.
    if ! rm -rf "$dir" 2>/dev/null; then
      if aside=$(mktemp -u "$dir.XXXXXX") && mv "$dir" "$aside"; then
        echo "the old snapshot at $dir could not be removed and was moved aside to $aside" >&2
      else
        rm -rf "$part"
        echo "could not replace the snapshot at $dir" >&2
        return 1
      fi
    fi
    mv "$part" "$dir" 2>/dev/null || true
    # A racing take that moved its folder in first holds ours nested inside it;
    # drop that, and record this take's numbers on whichever snapshot won.
    rm -rf "${dir:?}/${part##*/}" "$part"
    if [ -d "$dir/tree" ]; then
      hook_snapshot_add "$root" "$@" && return 0
      echo "could not record the issues in $dir" >&2
      return 1
    fi
    echo "could not move $part into place at $dir" >&2
  fi
  rm -rf "$part"
  return 1
}

# hook_snapshot_add <root> <issue>...: the numbers recorded on the snapshot's
# issues list, each once.
hook_snapshot_add() {
  local dir
  dir=$(hook_snapshot_dir "$1") || return 1
  shift
  _hook_snapshot_record "$dir/issues" "$@"
}

_hook_snapshot_record() {
  local file="$1" n
  shift
  for n in "$@"; do
    grep -qx -- "$n" "$file" 2>/dev/null && continue
    printf '%s\n' "$n" >>"$file" || return 1
  done
}

# hook_issues_building [repo]: the open issues at status:building, run in the
# current directory: one line each, the number, a tab and the matching label;
# 2 when gh cannot answer. Never agent:claimed: an agent:ok item keeps that
# claim through the park. Consumer: hook_snapshot_stale. Its gh argv changes
# together with buildingList in hooks/mods/gh.js.
hook_issues_building() {
  local repo="${1:-}" list
  command -v gh >/dev/null 2>&1 || return 2
  command -v jq >/dev/null 2>&1 || return 2
  if [ -n "$repo" ]; then
    list=$(gh issue list --repo "$repo" --state open --label status:building --limit 1000 --json number,labels 2>/dev/null) || return 2
  else
    list=$(gh issue list --state open --label status:building --limit 1000 --json number,labels 2>/dev/null) || return 2
  fi
  [ -n "$list" ] || return 2
  hook_jq -r '.[] | [.number, ([.labels[]?.name // "" | select(. == "status:building")] | join(","))]
    | select(.[1] != "") | "\(.[0])\t\(.[1])"' <<<"$list" 2>/dev/null || return 2
}

# hook_snapshot_stale <root> [repo]: 0 when none of the snapshot's issues is
# still at status:building, 1 while one is or none is recorded (a claim whose
# numbers could not be read), 2 when GitHub cannot answer. The read runs in
# <root>, against [repo] when one is given.
hook_snapshot_stale() {
  local dir building n
  dir=$(hook_snapshot_dir "$1") || return 2
  grep -q '[^[:space:]]' "$dir/issues" 2>/dev/null || return 1
  building=$(cd "$1" 2>/dev/null && hook_issues_building "${2:-}") || return 2
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    printf '%s\n' "$building" | cut -f1 | grep -qx -- "$n" && return 1
  done <"$dir/issues"
  return 0
}

# hook_snapshot_drop <root>: the snapshot removed, whole.
hook_snapshot_drop() {
  local dir
  dir=$(hook_snapshot_dir "$1") || return 1
  rm -rf "$dir"
}

# _hook_snapshot_modules <root> <dest> <rel> [scope]: <rel> becomes a real
# folder in <dest>, each live entry linked in absolutely; a workspace link
# (resolving inside the root and outside every node_modules) points at the same
# path inside <dest> instead, and a scope folder or .bin is filled one level down.
_hook_snapshot_modules() {
  local root="$1" dest="$2" rel="$3" entry name target plain=()
  mkdir -p "$dest/$rel" || { echo "could not make $rel in the copy" >&2; return 1; }
  for entry in "$root/$rel"/* "$root/$rel"/.[!.]* "$root/$rel"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="${entry##*/}"
    if [ -L "$entry" ] && target=$(_hook_snapshot_target "$entry") \
      && [ "${target#"$root"/}" != "$target" ] && ! _hook_snapshot_in_modules "${target#"$root"/}"; then
      ln -s "$dest/${target#"$root"/}" "$dest/$rel/$name" \
        || { echo "could not link $rel/$name into the copy" >&2; return 1; }
    elif [ $# -eq 3 ] && { [ "${name#@}" != "$name" ] || [ "$name" = .bin ]; } \
      && [ -d "$entry" ] && [ ! -L "$entry" ]; then
      _hook_snapshot_modules "$root" "$dest" "$rel/$name" scope || return 1
    else
      plain+=("$entry")
    fi
  done
  [ ${#plain[@]} -eq 0 ] || ln -s "${plain[@]}" "$dest/$rel/" \
    || { echo "could not link $rel's entries into the copy" >&2; return 1; }
}

# _hook_snapshot_target <link>: the physical path <link> resolves to, a
# folder's by cd -P, a file's (a .bin entry) through its folder's.
_hook_snapshot_target() {
  local t
  (cd -P "$1" 2>/dev/null && pwd -P) && return 0
  t=$(readlink "$1") || return 1
  case "$t" in /*) ;; *) t="${1%/*}/$t" ;; esac
  (cd -P "${t%/*}" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "${t##*/}")
}

_hook_snapshot_in_modules() {
  case "/$1/" in */node_modules/*) return 0 ;; esac
  return 1
}

# hook_snapshot_worktree_add <root> <copy>: a detached worktree of <root>'s HEAD
# at <copy>, nothing checked out. Another add or prune racing on the repo's
# worktree list fails an add, so it is tried three times; 1 with the last
# failure's words from git on stderr.
hook_snapshot_worktree_add() {
  local try err
  for try in 1 2 3; do
    err=$(git -C "$1" worktree add -q --no-checkout --detach "$2" HEAD 2>&1) && return 0
    [ "$try" -eq 3 ] || sleep 1
  done
  printf '%s\n' "$err" >&2
  return 1
}

# hook_snapshot_worktree_remove <root> <copy>: the worktree at <copy> gone from
# <root>'s list; when git cannot remove it, the folder is deleted first so the
# prune drops its entry. 1 when the prune fails too.
hook_snapshot_worktree_remove() {
  git -C "$1" worktree remove --force "$2" 2>/dev/null && return 0
  rm -rf "$2"
  git -C "$1" worktree prune 2>/dev/null
}

# hook_snapshot_fill <tree> <root> <dest> [rel]...: the folder <dest> filled from
# the folder <tree> (only the rels, given any; _hook_snapshot_copy). Each
# package's node_modules the live repo <root> holds then becomes a real folder
# wherever the copy holds its parent (_hook_snapshot_modules).
hook_snapshot_fill() {
  local tree="$1" root="$2" dest="$3" held rel
  shift 3
  _hook_snapshot_copy "$tree" "$dest" "$@" || return 1
  held=$(_hook_snapshot_modules_list "$root") \
    || { echo "could not list the package node_modules folders under $root" >&2; return 1; }
  while IFS= read -r rel; do
    rel="${rel#./}"
    [ -n "$rel" ] && [ ! -e "$dest/$rel" ] && [ ! -L "$dest/$rel" ] && [ -d "$(dirname "$dest/$rel")" ] || continue
    _hook_snapshot_modules "$root" "$dest" "$rel" || return 1
  done <<<"$held"
}

# The entry the hooks module runs: `take <root> [issue]...`, `add <root>
# <issue>...`, `stale <root> [repo]` and `drop <root>`, each the function of
# that name, its exit status passed through. Run as a file only: sourced, from
# _lib.sh or under it, this does nothing.
if [ "${BASH_SOURCE[0]}" = "$0" ] && [ "${#BASH_SOURCE[@]}" -eq 1 ]; then
  set -uo pipefail
  set -f
  snapshot_dir="${BASH_SOURCE[0]%/*}"
  [ "$snapshot_dir" != "${BASH_SOURCE[0]}" ] || snapshot_dir="."
  # shellcheck source=../_lib.sh
  . "$snapshot_dir/../_lib.sh"
  [ $# -ge 2 ] && [ -n "$2" ] || { echo "snapshot.sh: usage: take|add|stale|drop <root> [args]" >&2; exit 64; }
  mode="$1"
  shift
  case "$mode" in
    take) hook_snapshot_take "$@" ;;
    add) hook_snapshot_add "$@" ;;
    stale) hook_snapshot_stale "$@" ;;
    drop) hook_snapshot_drop "$@" ;;
    *) echo "snapshot.sh: unknown mode $mode (take, add, stale or drop)" >&2; exit 64 ;;
  esac
fi
