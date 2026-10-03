#!/bin/bash
# scripts/red-proof.sh <path>... -- <command>...: prove the tests check the
# source. The command runs in a detached worktree of HEAD filled from the repo's
# snapshot (workflow:snapshot takes it at the claim, gitignored files included),
# every path changed since laid on live, save the named paths, which stay as the
# snapshot holds them. Red (the command failed) exits 0; green exits 1; any other
# stop (no snapshot, a command that cannot run, a module that fails to load)
# exits 2 with a `red-proof:` line on stderr. The verdict is stdout's last line.

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

git rev-parse --show-cdup >/dev/null 2>&1 \
  || usage "not inside a git repository, so there is no HEAD to copy"
# Both spelled by pwd -P, so a named path compares with the root on every platform.
root=$(hook_snapshot_root "$PWD") || fail "could not enter the repo root"
here=$(pwd -P)
prefix=$(git rev-parse --show-prefix)
snap=$(hook_snapshot_dir "$root") || fail "could not name the snapshot folder"
[ -d "$snap/tree" ] || fail "not runnable: no snapshot for this repo (the claim to status:building takes it)"

# lexical <abs>: the absolute path with its . and .. parts resolved by name.
lexical() {
  local norm="" part parts
  IFS=/ read -r -a parts <<<"$1"
  for part in ${parts[@]+"${parts[@]}"}; do
    case "$part" in
      ''|.) ;;
      ..) norm="${norm%/*}" ;;
      *) norm="$norm/$part" ;;
    esac
  done
  printf '%s\n' "$norm"
}

# root_relative <path>: the path as the root spells it, from here, absolute or
# with ../. The nearest folder that exists resolves physically, the rest
# lexically, so a deleted path still resolves. 1 when it lies outside the root.
root_relative() {
  local abs norm head tail="" phys
  case "$1" in /*) abs="$1" ;; *) abs="$here/$1" ;; esac
  norm=$(lexical "$abs")
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
    || { [ -n "$rel" ] && [ ! -e "$snap/tree/$rel" ] && [ ! -L "$snap/tree/$rel" ] \
      && ! git -C "$root" cat-file -e "HEAD:$rel" 2>/dev/null && ! is_listed "$rel"; }; then
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
  if add_err=$(git -C "$root" worktree add -q --no-checkout --detach "$copy" HEAD 2>&1); then
    added=1
    break
  fi
  [ "$try" -eq 3 ] || sleep 1
done
[ "$added" -eq 1 ] || fail "could not add a worktree of HEAD at $copy: $add_err"
# The index as HEAD has it, so git in the copy reads the copy's files against HEAD.
git -C "$copy" read-tree HEAD || fail "could not read HEAD into the copy's index"

fill_err=$(hook_snapshot_fill "$root" "$copy" 2>&1) \
  || fail "could not fill the copy from the snapshot at $snap: $fill_err"

# Every path changed since the snapshot, from three lists: the working diff now,
# the one at the snapshot, and the commits since its HEAD. Each carries its live
# version, or is removed when the live tree lacks it; a named path stays.
snap_head=$(cat "$snap/head" 2>/dev/null) && [ -n "$snap_head" ] && [ -f "$snap/paths" ] \
  || fail "the snapshot at $snap records no head or no paths"
git -C "$root" diff --name-only --no-renames -z "$snap_head" HEAD >"$tmp/since" \
  || fail "could not list the files changed since the snapshot's commit $snap_head"
cat "$tmp/paths" "$snap/paths" "$tmp/since" | sort -zu >"$tmp/changed" \
  || fail "could not merge the changed-path lists"
while IFS= read -r -d '' rel; do
  [ -n "$rel" ] || continue
  is_named "$rel" && continue
  rm -rf "${copy:?}/$rel" || fail "could not clear $rel in the copy"
  [ -e "$root/$rel" ] || [ -L "$root/$rel" ] || continue
  mkdir -p "$(dirname "$copy/$rel")" || fail "could not make the folder for $rel in the copy"
  cp -pP "$root/$rel" "$copy/$rel" || fail "could not copy $rel into the copy"
done <"$tmp/changed"

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

# Each stream prints live and is kept, so a failure can be read for a load error.
rc=0
{ { "${cmd[@]}" 2>&1 1>&3 3>&- | tee "$tmp/err" >&2 3>&-; } 3>&1 | tee "$tmp/out"; } || rc=$?
case "$rc" in
  0)
    echo "red-proof: green: the tests pass without ${paths[*]}"
    exit 1
    ;;
  126|127) fail "command not runnable: ${cmd[0]}" ;;
esac
# load_failures: each module node could not load, one `<specifier>TAB<from>` a
# line, <from> the requiring file node names (empty when it names none). Node's
# message is the one signal: `Cannot find module|package '<specifier>'`, which
# MODULE_NOT_FOUND and ERR_MODULE_NOT_FOUND both print.
load_failures() {
  awk -v q="'" '
    { sub(/\r$/, ""); sub(/^[#[:space:]]+/, "") }
    match($0, "Cannot find (module|package) " q) {
      if (want) print spec "\t"
      s = substr($0, RSTART + RLENGTH); i = index(s, q); want = 0; stack = 0
      if (!i) next
      spec = substr(s, 1, i - 1); rest = substr(s, i + 1)
      if (index(rest, " imported from ") == 1) print spec "\t" substr(rest, 16)
      else want = 1
      next
    }
    want && /^Require stack:/ { stack = 1; next }
    want && stack && /^- / { print spec "\t" substr($0, 3); want = 0 }
    END { if (want) print spec "\t" }
  ' "$tmp/out" "$tmp/err"
}

# module_path <specifier> <from>: the module's absolute path, a relative one
# read against the requiring file; 1 for a package name. Windows paths read with /.
module_path() {
  local s="${1//\\//}" f="${2//\\//}"
  case "$s" in
    .|..|./*|../*) [ -n "$f" ] || return 1; lexical "${f%/*}/$s" ;;
    /*|[A-Za-z]:/*) lexical "$s" ;;
    *) return 1 ;;
  esac
}

# The copy's own folder, unique to this run, so another run's copy never matches.
marker="/${tmp##*/}/copy/"

# in_copy <specifier> <from>: the failure happened in this run's copy, its
# requiring file or its module path lying inside it; text a test only prints
# about another run never matches.
in_copy() {
  local f="${2//\\//}" p
  case "$f" in *"$marker"*) return 0 ;; esac
  p=$(module_path "$1" "$2") || return 1
  case "$p" in *"$marker"*) return 0 ;; esac
  return 1
}

# held_module <specifier> <from>: the module resolves to a named path in the
# copy (the path, the path less its extension, or a file in a named folder),
# so its absence is the red the proof wants.
held_module() {
  local p rel n
  p=$(module_path "$1" "$2") || return 1
  case "$p" in *"$marker"*) rel="${p#*"$marker"}" ;; *) return 1 ;; esac
  is_named "$rel" && return 0
  for n in "${named[@]}"; do
    case "${n##*/}" in *.*) [ "${n%.*}" = "$rel" ] && return 0 ;; esac
  done
  return 1
}

# A red from a module that never loaded in the copy proves nothing, unless the
# module is a named path the copy lacks by design.
while IFS=$'\t' read -r spec from; do
  in_copy "$spec" "$from" || continue
  held_module "$spec" "$from" || fail "not runnable: a module failed to load: $spec"
done < <(load_failures)
echo "red-proof: red"
