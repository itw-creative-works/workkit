#!/bin/bash
# hooks/lib/snapshot.sh: the repo snapshot scripts/red-proof.sh runs against,
# which workflow/snapshot takes at the claim to status:building: its folder,
# take, add issues, the stale check, drop, and the per-run fill of a copy.
# SOURCED by hooks/_lib.sh, never executed: it defines functions and sets
# nothing. It reads hook_is_* (the entry), hook_working_paths (lib/tree.sh) and
# hook_issues_building (lib/proof.sh).

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

# _hook_snapshot_copy <src> <dest>: every entry of <src> into the folder <dest>,
# `.git` left out and symlinks kept. On Windows every node_modules at any depth
# is left out too (red-proof's fill rebuilds those from the live repo's
# entries). The tools' words go to stderr.
_hook_snapshot_copy() {
  local entry flags=(-pPR)
  if hook_is_windows; then
    (set -o pipefail; cd "$1" && tar -cf - --exclude=./.git --exclude=node_modules . | tar -xf - -C "$2")
    return
  fi
  if hook_is_macos; then
    flags=(-c -pPR)
  elif hook_is_linux; then
    flags=(-a --reflink=auto)
  fi
  while IFS= read -r -d '' entry; do
    cp "${flags[@]}" "$entry" "$2/" || return 1
  done < <(find "$1" -mindepth 1 -maxdepth 1 ! -name .git -print0)
}

# hook_snapshot_take <root> [issue]...: a fresh snapshot of <root>, replacing
# any there. head, paths and issues are written first and the tree last, copied
# under a temporary name and renamed once whole, so a half copy is never found.
# 1 with the error on stderr and nothing left behind.
hook_snapshot_take() {
  local root="$1" dir head part
  shift
  dir=$(hook_snapshot_dir "$root") || { echo "could not name the snapshot folder" >&2; return 1; }
  { rm -rf "$dir" && mkdir -p "$dir"; } || { echo "could not make $dir" >&2; return 1; }
  if ! head=$(git -C "$root" rev-parse --verify -q HEAD) || [ -z "$head" ]; then
    echo "$root has no HEAD commit" >&2
  elif ! printf '%s\n' "$head" >"$dir/head" || ! : >"$dir/issues"; then
    echo "could not write into $dir" >&2
  elif ! hook_working_paths "$root" >"$dir/paths"; then
    echo "could not list the working diff of $root" >&2
  elif ! hook_snapshot_add "$root" "$@"; then
    echo "could not record the issues in $dir" >&2
  elif part=$(mktemp -d "$dir/tree.XXXXXX") \
    && _hook_snapshot_copy "$root" "$part" && mv "$part" "$dir/tree"; then
    return 0
  fi
  rm -rf "$dir"
  return 1
}

# hook_snapshot_add <root> <issue>...: the numbers recorded on the snapshot's
# issues list, each once.
hook_snapshot_add() {
  local dir n
  dir=$(hook_snapshot_dir "$1") || return 1
  shift
  for n in "$@"; do
    grep -qx -- "$n" "$dir/issues" 2>/dev/null && continue
    printf '%s\n' "$n" >>"$dir/issues" || return 1
  done
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
# path inside <dest> instead, and a scope folder is filled one level down.
_hook_snapshot_modules() {
  local root="$1" dest="$2" rel="$3" entry name target plain=()
  mkdir -p "$dest/$rel" || { echo "could not make $rel in the copy" >&2; return 1; }
  for entry in "$root/$rel"/* "$root/$rel"/.[!.]* "$root/$rel"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="${entry##*/}"
    if [ -L "$entry" ] && target=$(cd -P "$entry" 2>/dev/null && pwd -P) \
      && [ "${target#"$root"/}" != "$target" ] && ! _hook_snapshot_in_modules "${target#"$root"/}"; then
      ln -s "$dest/${target#"$root"/}" "$dest/$rel/$name" \
        || { echo "could not link $rel/$name into the copy" >&2; return 1; }
    elif [ $# -eq 3 ] && [ "${name#@}" != "$name" ] && [ -d "$entry" ] && [ ! -L "$entry" ]; then
      _hook_snapshot_modules "$root" "$dest" "$rel/$name" scope || return 1
    else
      plain+=("$entry")
    fi
  done
  [ ${#plain[@]} -eq 0 ] || ln -s "${plain[@]}" "$dest/$rel/" \
    || { echo "could not link $rel's entries into the copy" >&2; return 1; }
}

_hook_snapshot_in_modules() {
  case "/$1/" in */node_modules/*) return 0 ;; esac
  return 1
}

# hook_snapshot_fill <root> <dest>: the folder <dest> filled from the snapshot's
# tree. On Windows each node_modules the live repo holds becomes a real folder
# wherever the copy holds its parent, its entries linked from the live repo and
# its workspace links into <dest> (_hook_snapshot_modules).
hook_snapshot_fill() {
  local root="$1" dest="$2" dir found rel
  dir=$(hook_snapshot_dir "$root") || return 1
  _hook_snapshot_copy "$dir/tree" "$dest" || return 1
  hook_is_windows || return 0
  while IFS= read -r -d '' found; do
    rel="${found#"$root"/}"
    [ -d "$found" ] && [ ! -e "$dest/$rel" ] && [ ! -L "$dest/$rel" ] && [ -d "$(dirname "$dest/$rel")" ] || continue
    _hook_snapshot_modules "$root" "$dest" "$rel" || return 1
  done < <(find "$root" \( -name .git -prune \) -o \( -name node_modules -prune -print0 \))
}
