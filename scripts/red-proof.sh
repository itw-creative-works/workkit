#!/bin/bash
# scripts/red-proof.sh <path>... -- <command>...: prove the tests check the
# source. The command runs in a detached worktree of HEAD carrying every working
# change except the named paths, which stay as HEAD has them (absent when
# untracked). Red (the command failed) exits 0; green exits 1; any other stop,
# a command that cannot run included, exits 2 with a `red-proof:` line on
# stderr. The verdict is stdout's last line.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../hooks/_lib.sh"

fail() {
  echo "red-proof: $1" >&2
  exit 2
}

usage() {
  fail "$1 (usage: red-proof.sh <path>... -- <command>...)"
}

paths=()
while [ $# -gt 0 ] && [ "$1" != -- ]; do
  paths+=("$1")
  shift
done
[ $# -gt 0 ] || usage "no -- between the paths and the command"
shift
[ ${#paths[@]} -gt 0 ] || usage "no path before --"
[ $# -gt 0 ] || usage "no command after --"
cmd=("$@")

cdup=$(git rev-parse --show-cdup 2>/dev/null) \
  || usage "not inside a git repository, so there is no HEAD to copy"
# Both spelled by pwd -P, so a named path compares with the root on every platform.
root=$(cd "./$cdup" && pwd -P) || fail "could not enter the repo root"
here=$(pwd -P)
prefix=$(git rev-parse --show-prefix)

# root_relative <path>: the path as the root spells it, from here, absolute or
# with ../. The nearest folder that exists resolves physically, the rest
# lexically, so a deleted path still resolves. 1 when it lies outside the root.
root_relative() {
  local abs norm="" part parts head tail="" phys
  case "$1" in /*) abs="$1" ;; *) abs="$here/$1" ;; esac
  IFS=/ read -r -a parts <<<"$abs"
  for part in ${parts[@]+"${parts[@]}"}; do
    case "$part" in
      ''|.) ;;
      ..) norm="${norm%/*}" ;;
      *) norm="$norm/$part" ;;
    esac
  done
  head="$norm"
  while [ -n "$head" ] && [ ! -d "$head" ]; do
    tail="/${head##*/}$tail"
    head="${head%/*}"
  done
  phys="$(cd "${head:-/}" && pwd -P)" || return 1
  phys="${phys%/}$tail"
  case "$phys" in
    "$root") printf '\n' ;;
    "$root"/*) printf '%s\n' "${phys#"$root"/}" ;;
    *) return 1 ;;
  esac
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/red-proof.XXXXXX") || fail "could not make a temp folder"
copy="$tmp/copy"
added=0
cleanup() {
  cd "$root" 2>/dev/null || cd /
  if [ "$added" -eq 1 ]; then
    git worktree remove --force "$copy" \
      || echo "red-proof: could not remove the worktree at $copy (git worktree prune clears it)" >&2
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

hook_working_paths "$root" >"$tmp/paths" || fail "could not list the working diff"

# is_listed <rel>: the path, or a folder holding one, is in the working diff.
is_listed() {
  local l
  while IFS= read -r -d '' l; do
    case "$l" in "$1"|"$1"/*) return 0 ;; esac
  done <"$tmp/paths"
  return 1
}

# The named paths as the root spells them, so they compare with git's list; the
# root itself is empty, and names everything.
named=()
for p in "${paths[@]}"; do
  if ! rel=$(root_relative "$p") \
    || { [ -n "$rel" ] && ! git -C "$root" cat-file -e "HEAD:$rel" 2>/dev/null && ! is_listed "$rel"; }; then
    fail "$p is not in this repo's tree or working diff"
  fi
  named+=("$rel")
done

is_named() {
  local n
  for n in "${named[@]}"; do
    [ -n "$n" ] || return 0
    case "$1" in "$n"|"$n"/*) return 0 ;; esac
  done
  return 1
}

# Another add or prune racing on the repo's worktree list fails an add, so it
# is tried three times; the last failure carries git's own words.
for try in 1 2 3; do
  if add_err=$(git -C "$root" worktree add -q --detach "$copy" HEAD 2>&1); then
    added=1
    break
  fi
  [ "$try" -eq 3 ] || sleep 1
done
[ "$added" -eq 1 ] || fail "could not add a worktree of HEAD at $copy: $add_err"

while IFS= read -r -d '' rel; do
  is_named "$rel" && continue
  if [ -e "$root/$rel" ] || [ -L "$root/$rel" ]; then
    mkdir -p "$(dirname "$copy/$rel")" || fail "could not make the folder for $rel in the copy"
    cp -pP "$root/$rel" "$copy/$rel" || fail "could not copy $rel into the copy"
  else
    rm -f "$copy/$rel" || fail "could not delete $rel in the copy"
  fi
done <"$tmp/paths"

# fill_modules <rel> [scope]: <rel> becomes a real folder in the copy, each root
# entry linked in absolutely; a workspace link (resolving inside the root and
# outside every node_modules) points at the same path inside the copy instead,
# and a scope folder is filled the same way, one level down.
fill_modules() {
  local rel="$1" entry name target plain=()
  mkdir -p "$copy/$rel" || fail "could not make $rel in the copy"
  for entry in "$root/$rel"/* "$root/$rel"/.[!.]* "$root/$rel"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name="${entry##*/}"
    if [ -L "$entry" ] && target=$(cd -P "$entry" 2>/dev/null && pwd -P) \
      && [ "${target#"$root"/}" != "$target" ] && ! in_modules "${target#"$root"/}"; then
      ln -s "$copy/${target#"$root"/}" "$copy/$rel/$name" || fail "could not link $rel/$name into the copy"
    elif [ $# -eq 1 ] && [ "${name#@}" != "$name" ] && [ -d "$entry" ] && [ ! -L "$entry" ]; then
      fill_modules "$rel/$name" scope
    else
      plain+=("$entry")
    fi
  done
  [ ${#plain[@]} -eq 0 ] || ln -s "${plain[@]}" "$copy/$rel/" || fail "could not link $rel's entries into the copy"
}

in_modules() {
  case "/$1/" in */node_modules/*) return 0 ;; esac
  return 1
}

# Every node_modules whose folder is up to three levels down, never one inside
# another, unless the copy already holds it or lacks the folder it sits in.
while IFS= read -r -d '' dir; do
  rel="${dir#"$root"/}"
  [ -d "$dir" ] && [ ! -e "$copy/$rel" ] && [ ! -L "$copy/$rel" ] && [ -d "$(dirname "$copy/$rel")" ] || continue
  fill_modules "$rel"
done < <(find "$root" -maxdepth 4 \( -name .git -prune \) -o \( -name node_modules -prune -print0 \))

cd "$copy/$prefix" 2>/dev/null \
  || fail "could not enter ${prefix:-the root} in the copy: HEAD and the working diff hold nothing there"
# node_test_files: the files a node command names, one a line: every positional
# under --test, else the script alone (an -e/-p script names none). Flags, the
# module a loader flag takes, and globs are skipped; only a word that reads as a
# path (a slash, a .js/.mjs/.cjs end) counts.
node_test_files() {
  local w test=0 skip=0 first=1
  for w in "$@"; do [ "$w" = --test ] && test=1; done
  for w in "$@"; do
    if [ "$skip" -eq 1 ]; then skip=0; continue; fi
    case "$w" in
      -e|--eval|-p|--print) return 0 ;;
      -r|--require|--import|--loader|--env-file|--test-reporter|--test-reporter-destination|--test-name-pattern|--test-skip-pattern)
        skip=1; continue ;;
      -*|*'*'*|*'?'*|*'['*) continue ;;
    esac
    [ "$first" -eq 1 ] || [ "$test" -eq 1 ] || return 0
    first=0
    case "$w" in */*|*.js|*.mjs|*.cjs) printf '%s\n' "$w" ;; esac
  done
}

if [ "${cmd[0]}" = node ]; then
  while IFS= read -r f; do
    [ -e "$f" ] || fail "test file not in the copy: $f"
  done < <(node_test_files "${cmd[@]:1}")
fi

rc=0
"${cmd[@]}" || rc=$?
case "$rc" in
  0)
    echo "red-proof: green: the tests pass without ${paths[*]}"
    exit 1
    ;;
  126|127) fail "command not runnable: ${cmd[0]}" ;;
esac
echo "red-proof: red"
