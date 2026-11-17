#!/usr/bin/env bash
# workflow/lib/platform.sh: the spellings that differ per platform and the read
# shapes built on them, for the engine and the hooks. Sourced: functions, plus the
# one MSYS export, WK_NODE_FLOOR, MARKER_KEEP_DAYS and PROOF_KEEP_DAYS below. The shell twin of
# test/lib/platform.js, with lib/run.js as its Node twin; on macOS and Linux every
# function is the plain POSIX spelling. What each answers: workflow/README.md, the lib/platform.sh row.

# Git Bash makes `ln -s` a copy unless MSYS says otherwise (docs/hooks.md
# § Platforms). Appended once to MSYS's space-separated list, however many
# times this is sourced; the engine and every hook source this file.
case "${OSTYPE:-}" in
  msys*|cygwin*)
    [[ " ${MSYS:-} " == *" winsymlinks:nativestrict "* ]] \
      || export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"
    ;;
esac

# wk_jq: jq on Windows writes CRLF (docs/hooks.md § Platforms). Every jq call
# goes through this, and jq's own exit status comes back, so a predicate still
# answers.
wk_jq() {
  jq "$@" | tr -d '\r'
  return "${PIPESTATUS[0]}"
}

# wk_jq_default <default> <jq args...>: jq's answer, or <default> when it wrote
# nothing. Never `|| printf <default>`: jq writes what it parsed before failing,
# and the default would be stuck on the end. Always exits 0.
wk_jq_default() {
  local default="$1" out
  shift
  out="$(wk_jq "$@" 2>/dev/null || true)"
  [ -n "$out" ] || out="$default"
  printf '%s' "$out"
}

# wk_in_plugin_cache <kit dir>: whether the kit is the workkit plugin's copy in
# Claude's plugin cache: its manifest names workkit and its physical path lies
# under the PHYSICAL <claude home>/plugins/cache/, since ~/.claude may be a
# symlink. WORKFLOW_CLAUDE_HOME is the tests' seam, as everywhere it is read.
wk_in_plugin_cache() {
  local kit home manifest
  kit="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  manifest="$kit/.claude-plugin/plugin.json"
  [[ -f "$manifest" ]] && command -v jq >/dev/null 2>&1 || return 1
  [[ "$(wk_jq -r '.name // empty' "$manifest" 2>/dev/null)" == 'workkit' ]] || return 1
  home="$(cd "${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}" 2>/dev/null && pwd -P)" || return 1
  [[ -n "$home" && "$kit" == "$home/plugins/cache/"* ]]
}

# wk_clone_outranks <kit dir> <linked dir>: a clone outranks the plugin cache,
# so a machine-wide link a cached kit finds naming a workkit clone is current.
# The clone test is wk_is_kit_checkout in lib/slug.sh, sourced beside this.
wk_clone_outranks() {
  wk_in_plugin_cache "$1" && wk_is_kit_checkout "${2:-}"
}

# wk_mv_link: rename onto an address that may be a symlink without following
# it, or the source lands inside the directory it points at. GNU spells it -T
# and BSD -h, so `mv` itself is asked which it is.
wk_mv_link() {
  local flag=-T
  mv --version 2>/dev/null | grep -qi 'GNU coreutils' || flag=-h
  mv -f "$flag" "$1" "$2"
}

# wk_native_path <path>: the native spelling (`D:/a/x`, never `/d/a/x`), git's
# own: `cygpath -m` on Windows, keeping the letter case it is handed, the path
# unchanged elsewhere. Every path a kit shell line prints for a person, hands to
# a native program, or keys the roster by goes through it. A failure is passed
# on: an empty key is worse than none.
wk_native_path() {
  local p="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*) p="$(cygpath -m "$p")" || return 1 ;;
  esac
  printf '%s' "$p"
}

# wk_posix_path <path>: the Git Bash spelling (`/d/a/x`, never `D:/a/x`), the
# inverse of wk_native_path: `cygpath -u` on Windows, the path unchanged
# elsewhere. A failure is passed on.
wk_posix_path() {
  local p="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*) p="$(cygpath -u "$p")" || return 1 ;;
  esac
  printf '%s' "$p"
}

# wk_user_dir: the machine's own workkit folder, ~/.workkit, which WORKFLOW_HOME
# moves. Every engine script, hook and job reads the folder through this one;
# its Node twin is ../user-dir.js, shape for shape.
wk_user_dir() {
  printf '%s\n' "${WORKFLOW_HOME:-${HOME:-}/.workkit}"
}

# wk_cache_dir: the kit's cache folder, ~/.cache/workkit, short and with no
# crowded parent, home of the proof run folders and the red-proof snapshots.
# HOME moves it; WORKFLOW_HOME does not, since ~/.workkit can be a link into a repo.
wk_cache_dir() {
  printf '%s\n' "${HOME:-}/.cache/workkit"
}

# wk_proof_base: the folder every proof run folder lives under, proof/ in
# wk_cache_dir's folder.
wk_proof_base() {
  printf '%s\n' "$(wk_cache_dir)/proof"
}

# wk_proof_dir: a new run folder, <wk_proof_base>/<id>, printed. Each run folder
# there last changed over PROOF_KEEP_DAYS ago is removed first, since no system
# cleaner reaches the cache folder; one holding `live` (a --live run's only copy
# of the live files) or one it cannot remove is left. 1 when none is made.
wk_proof_dir() {
  local base run
  base="$(wk_proof_base)"
  mkdir -p "$base" || return 1
  while IFS= read -r -d '' run; do
    [ -e "$run/live" ] || rm -rf "$run" 2>/dev/null || true
  done < <(find "$base" -mindepth 1 -maxdepth 1 -type d -mmin "+$((PROOF_KEEP_DAYS * 1440))" -print0 2>/dev/null)
  mktemp -d "$base/XXXXXX"
}

# wk_script_shell_exe: npm's script shell on Windows, the executable setup
# builds into the machine's own folder. Setup writes it; the commit gate reads it.
wk_script_shell_exe() {
  printf '%s\n' "$(wk_user_dir)/script-shell.exe"
}

# wk_hooks_log: sets WK_HOOKS_LOG, the log the hooks module writes a line to per
# hook fire, in wk_user_dir's folder.
wk_hooks_log() {
  WK_HOOKS_LOG="$(wk_user_dir)/hooks.log"
}

# wk_is_cloud: a claude.ai/code cloud session, which Claude Code marks with
# CLAUDE_CODE_REMOTE=true. Setup's --cloud and doctor read it.
wk_is_cloud() {
  [[ "${CLAUDE_CODE_REMOTE:-}" == 'true' ]]
}

# The oldest node the gh gate and the git hooks' judge run under: they require()
# the ES modules in hooks/mods, which Node allows from 22.12.
WK_NODE_FLOOR=22.12

# _wk_node_fits <node>: whether <node> runs and its --version reaches
# WK_NODE_FLOOR, part by part as numbers, a suffix (`-nightly`, a `\r`) dropped.
_wk_node_fits() {
  local version have want i a b
  version="$("$1" --version 2>/dev/null)" || return 1
  IFS=. read -r -a have <<<"${version#v}"
  IFS=. read -r -a want <<<"$WK_NODE_FLOOR"
  for i in 0 1 2; do
    a="${have[i]:-0}"; a="${a%%[!0-9]*}"; a="${a:-0}"
    b="${want[i]:-0}"
    (( 10#$a > 10#$b )) && return 0
    (( 10#$a < 10#$b )) && return 1
  done
  return 0
}

# _wk_nvm_newest: the node of nvm's highest installed version, nothing when none.
_wk_nvm_newest() {
  local node
  for node in "${HOME:-}"/.nvm/versions/node/v*/bin/node; do
    [ -x "$node" ] || continue
    node="${node%/bin/node}"
    printf '%s %s\n' "${node##*/v}" "$node/bin/node"
  done | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1 | cut -d' ' -f2-
}

# wk_node: prints the first node that fits, of $WORKKIT_NODE, PATH's node, the
# dotfiles pin ~/.nvm/default-bin/node and nvm's newest install; prints
# nothing and returns 1 when none does.
wk_node() {
  local candidate found
  for candidate in "${WORKKIT_NODE:-}" node "${HOME:-}/.nvm/default-bin/node" newest; do
    [ "$candidate" != newest ] || candidate="$(_wk_nvm_newest)"
    [ -n "$candidate" ] || continue
    found="$(command -v "$candidate" 2>/dev/null)" || continue
    if _wk_node_fits "$found"; then
      printf '%s\n' "$found"
      return 0
    fi
  done
  return 1
}

# wk_npm_script_shell: npm's script-shell value. npm on Windows ends it with a
# CRLF a command substitution keeps half of; npm's own exit status comes back.
wk_npm_script_shell() {
  npm config get script-shell 2>/dev/null | tr -d '\r'
  return "${PIPESTATUS[0]}"
}

# wk_physical_path <path>: <path> with its folder resolved through every link
# and its file name kept as written, so a link to the file itself stays its own
# path. The one compare of npm's script shell, for setup, doctor and the gate.
wk_physical_path() {
  local dir
  dir="$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s' "$dir" "$(basename "$1")"
}

# wk_port_pids: the pids listening on a TCP port, one per line, nothing when it
# is free. netstat matches the `:<port>` suffix on either stack (`:18693` is not
# 8693), each pid once; lsof `-b` skips stat() on every mount, which a stalled
# network share blocks 15s a call. Neither tool: nothing, the port reads free.
wk_port_pids() {
  local port="$1"
  case "${OSTYPE:-}" in
    msys*|cygwin*)
      netstat -ano | tr -d '\r' | awk -v suffix=":$port" '
        $1 == "TCP" && $4 == "LISTENING" &&
        index($2, suffix) == length($2) - length(suffix) + 1 &&
        !seen[$5]++ { print $5 }'
      ;;
    *) lsof -bti "tcp:$port" -sTCP:LISTEN 2>/dev/null ;;
  esac
}

# wk_end_pid [-9] <pid>: end a pid `wk_port_pids` answered with, never a shell's
# own child (`$!`), which on Windows is an MSYS id. `env` skips bash's builtin
# for the `kill.exe` that takes a Windows pid, and that path is always forceful:
# Windows has no polite end for a windowless process.
wk_end_pid() {
  local signal=''
  case "$1" in
    -*) signal="$1"; shift ;;
  esac
  case "${OSTYPE:-}" in
    msys*|cygwin*) env kill -f -W "$1" ;;
    *) kill ${signal:+"$signal"} "$1" ;;
  esac
}

# _wk_group_gone <pgid>: wait up to 1.5s for a process group to empty.
_wk_group_gone() {
  local waited=0
  while kill -0 -- "-$1" 2>/dev/null; do
    [ "$waited" -lt 15 ] || return 1
    sleep 0.1
    waited=$(( waited + 1 ))
  done
}

# wk_end_run <pid>: end a detached run's supervisor <pid> and its process group.
# Windows ends its process tree through `tree.js end` under wk_node, returning
# its code, or 1 where no node fits. Elsewhere the supervisor leads its own group:
# INT first, so the body logs its own code, then TERM, then KILL, 1.5s apart; 0.
wk_end_run() {
  local node
  case "${OSTYPE:-}" in
    msys*|cygwin*)
      if ! node=$(wk_node); then
        printf 'wk_end_run: no node at or above %s is installed, so the tree of %s was not ended\n' "$WK_NODE_FLOOR" "$1" >&2
        return 1
      fi
      "$node" "$(cd "${BASH_SOURCE[0]%/*}" && pwd -P)/tree.js" end "$1"
      return
      ;;
  esac
  kill -INT -- "-$1" 2>/dev/null || return 0
  _wk_group_gone "$1" && return 0
  kill -TERM -- "-$1" 2>/dev/null || return 0
  _wk_group_gone "$1" && return 0
  kill -KILL -- "-$1" 2>/dev/null || true
}

# wk_pid_alive <pid>: <pid> answers kill -0 and its state does not start with Z
# (ended, waiting for its parent to collect it): /proc's where it exists, an entry
# gone since then read as ended; else ps's, no line leaving kill -0's answer.
# On Windows bash's kill cannot see the Windows pid Node printed, so Node is asked.
wk_pid_alive() {
  local state
  case "${OSTYPE:-}" in
    msys*|cygwin*) node -e 'process.kill(Number(process.argv[1]), 0)' "$1" 2>/dev/null ;;
    *)
      kill -0 "$1" 2>/dev/null || return
      if [ -r /proc/self/stat ]; then
        # The state follows the command name, which may hold spaces and brackets.
        [ -e "/proc/$1/stat" ] || return 1
        IFS= read -r state 2>/dev/null <"/proc/$1/stat" || state=
        state="${state##*') '}"
      else
        state=$(ps -o stat= -p "$1" 2>/dev/null)
      fi
      [[ ! "$state" =~ ^[[:space:]]*Z ]]
      ;;
  esac
}

# _wk_lock_files <lock> [<skip>]: the names of the files in <lock> but <skip>, on
# one line, one space apart, in glob order; a lock file's name holds no space.
_wk_lock_files() {
  local f names=()
  for f in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "$f" ] && [ "${f##*/}" != "${2:-}" ] && names+=("${f##*/}")
  done
  printf '%s\n' "${names[*]-}"
}

# wk_claim_dir <dir> [<tag>]: 0 only for the one caller that creates <dir>/claim
# create-only (noclobber), since a `mkdir` may answer 0 to two racing callers.
# With a tag (a run lock): only into an empty folder, id.<tag> before the claim
# that holds <tag> and once more after; a lost claim takes its id.<tag> back.
wk_claim_dir() {
  mkdir "$1" 2>/dev/null || return 1
  if [ -z "${2:-}" ]; then
    ( set -C; : > "$1/claim" ) 2>/dev/null
    return
  fi
  [ -z "$(_wk_lock_files "$1")" ] || return 1
  { : > "$1/id.$2"; } 2>/dev/null || return 1
  if ! ( set -C; printf '%s\n' "$2" > "$1/claim" ) 2>/dev/null; then
    rm -f "$1/id.$2"
    return 1
  fi
  # A removal still running in this folder may have deleted the mark.
  { : > "$1/id.$2"; } 2>/dev/null
}

# _wk_lock_tag: sets WK_LOCK_TAG to a tag no other take on this machine holds:
# this shell's own pid as wk_pid_alive reads it (a subshell's too; bash 3.2 has
# no BASHPID, so a child asked for its PPID), a count of the tags it made, and a
# random part against a pid used again later.
_wk_lock_tag() {
  local pid
  pid=${BASHPID:-$(exec sh -c 'echo "$PPID"')}
  # Git Bash: wk_pid_alive asks Windows, so the tag holds this shell's Windows pid.
  if [ -r "/proc/$pid/winpid" ]; then read -r pid < "/proc/$pid/winpid"; fi
  _WK_LOCK_TAGS=$(( ${_WK_LOCK_TAGS:-0} + 1 ))
  WK_LOCK_TAG="$pid.$_WK_LOCK_TAGS.$RANDOM"
}

# wk_tag_pid <tag>: the pid that is a lock tag's first field, printed; 1 for a
# tag with none (orphan, x).
wk_tag_pid() {
  local pid="${1%%.*}"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s\n' "$pid"
}

# wk_remover_lives <mark>: 0 while the remover that made a gone.<tag> mark lives,
# by its tag's pid; a tag with no pid (gone.x) is gone.
wk_remover_lives() {
  local pid
  pid=$(wk_tag_pid "${1#gone.}") || return 1
  wk_pid_alive "$pid"
}

# wk_lock_mark <lock>: a run lock's mark, printed: the id.<tag> its `claim` names
# when that file is there, else its gone.<tag>, else id.orphan; 1, nothing
# printed, for none. Any other id.* is a taker's leftover from a lost claim.
wk_lock_mark() {
  local tag="" mark
  { IFS= read -r tag < "$1/claim"; } 2>/dev/null || :
  if [ -n "$tag" ] && [ -f "$1/id.$tag" ]; then
    printf 'id.%s\n' "$tag"
    return 0
  fi
  for mark in "$1"/gone.* "$1/id.orphan"; do
    if [ -f "$mark" ]; then
      printf '%s\n' "${mark##*/}"
      return 0
    fi
  done
  return 1
}

# wk_retire_lock <lock> <mark>: the one removal of a run lock. It renames that
# exact mark to gone.<tag>, one caller alone; then it deletes the other files,
# `claim`, the gone file, the folder, so a cut-off removal leaves its gone mark or
# nothing. 1, the folder as it was, without <mark> or on a live remover's gone mark.
wk_retire_lock() {
  local gone f names=() others=()
  case "$2" in id.?*|gone.?*) ;; *) return 1 ;; esac
  [ -f "$1/$2" ] || return 1
  case "$2" in gone.*) ! wk_remover_lives "$2" || return 1 ;; esac
  _wk_lock_tag
  gone="gone.$WK_LOCK_TAG"
  mv -f "$1/$2" "$1/$gone" 2>/dev/null || return 1
  IFS=' ' read -r -a names <<<"$(_wk_lock_files "$1")"
  for f in ${names[@]+"${names[@]}"}; do
    case "$f" in
      claim|"$gone") ;;
      *) others+=("$1/$f") ;;
    esac
  done
  rm -f ${others[@]+"${others[@]}"}
  rm -f "$1/claim"
  rm -f "$1/$gone"
  rmdir "$1" 2>/dev/null
}

# wk_adopt_lock <lock> <seen>: a folder with no mark, once its run is over; <seen>
# is its _wk_lock_files line as read with the absent mark. Empty: rmdir. Else
# id.orphan create-only, then a look: no mark but id.orphan and exactly <seen>
# besides, retired by id.orphan; else 1, its own id.orphan taken back.
wk_adopt_lock() {
  local made=0 mark
  rmdir "$1" 2>/dev/null && return 0
  [ -d "$1" ] || return 1
  if ( set -C; : > "$1/id.orphan" ) 2>/dev/null; then made=1; fi
  mark=$(wk_lock_mark "$1") || mark=""
  # A folder made in its place differs: a new taker's first file is its id.<tag>.
  if [ "$mark" != id.orphan ] || [ "$(_wk_lock_files "$1" id.orphan)" != "${2:-}" ]; then
    [ "$made" -eq 0 ] || rm -f "$1/id.orphan"
    return 1
  fi
  wk_retire_lock "$1" id.orphan
}

# wk_retire_judged <lock> <judge> [args...]: the steps every remover shares. The
# mark (with none, the file names) is read first, then `<judge> <lock> [args...]`
# judges; on its 0 the lock is retired by that mark, or adopted against those
# names. Any other answer of the judge comes back; 4, unjudged, is a live remover's.
wk_retire_judged() {
  local lock="$1" judge="$2" mark seen=""
  shift 2
  mark=$(wk_lock_mark "$lock") || mark=""
  case "$mark" in gone.*) ! wk_remover_lives "$mark" || return 4 ;; esac
  [ -n "$mark" ] || seen=$(_wk_lock_files "$lock")
  "$judge" "$lock" "$@" || return
  if [ -n "$mark" ]; then
    wk_retire_lock "$lock" "$mark"
  else
    wk_adopt_lock "$lock" "$seen"
  fi
}

# wk_take_lock <dir>: a mutex taken by wk_claim_dir of <dir>, its parent made first.
# Returns 0 holding it, 1 after a 5s wait. Callers proceed either way, and only
# a caller that took it drops it (wk_drop_lock), or a third writer races the holder.
wk_take_lock() {
  local waited=0
  mkdir -p "$(dirname "$1")" 2>/dev/null || return 1
  while [ "$waited" -lt 50 ]; do
    if wk_claim_dir "$1"; then return 0; fi
    sleep 0.1
    # Never `(( waited++ ))`: its first pass evaluates to 0, a non-zero status
    # that errexit ends the run on under bash 4.1 and later.
    waited=$(( waited + 1 ))
  done
  return 1
}

# The claim goes first, then the folder, never both at once: a taker may claim
# the folder between the two, and the rmdir then fails and leaves it holding.
wk_drop_lock() {
  rm -f "$1/claim" 2>/dev/null || true
  rmdir "$1" 2>/dev/null || true
}

# wk_sha1: the hex sha1 of STDIN, through shasum or sha1sum, so every key is
# made by one rule. No tool is a loud refusal, never an empty key; parameter
# expansion strips the ` -` to spare a fork.
wk_sha1() {
  local out
  if command -v shasum >/dev/null 2>&1; then
    out=$(shasum)
  elif command -v sha1sum >/dev/null 2>&1; then
    out=$(sha1sum)
  else
    printf 'wk_sha1: neither shasum nor sha1sum is on PATH\n' >&2
    return 1
  fi
  printf '%s\n' "${out%% *}"
}

# The days a marker outlives its last write; wk_sweep_markers removes older.
MARKER_KEEP_DAYS=7

# The days a proof run folder outlives its last change; wk_proof_dir removes older.
PROOF_KEEP_DAYS=1

# wk_markers_dir: the folder every marker lives under, markers/ in wk_user_dir's
# folder, where no system temp cleaner reaches.
wk_markers_dir() {
  printf '%s\n' "$(wk_user_dir)/markers"
}

# wk_tower_dir: the one git repo in the global layer, the clone of `<login>/workkit`.
wk_tower_dir() {
  printf '%s\n' "$(wk_user_dir)/tower"
}

# wk_keyed_path <folder> <anchor>: the path <folder> holds for <anchor>, keyed
# by its wk_sha1; 1 when no digest comes out.
wk_keyed_path() {
  local key
  key=$(printf '%s' "$2" | wk_sha1) || return 1
  [ -n "$key" ] || return 1
  printf '%s\n' "$1/$key"
}

# wk_marker_path <dir> <anchor>: the marker file <markers dir>/<dir> holds for
# <anchor> (wk_keyed_path). Every marker name is derived here, so a writer and
# its readers never drift apart.
wk_marker_path() {
  wk_keyed_path "$(wk_markers_dir)/$1" "$2"
}

# wk_sweep_markers: remove each regular file one folder under the markers dir
# whose mtime is older than MARKER_KEEP_DAYS. A folder there (a run lock) is
# never entered. Every shell marker writer calls it; it never fails one.
wk_sweep_markers() {
  local dir
  dir=$(wk_markers_dir)
  [ -d "$dir" ] || return 0
  find "$dir" -mindepth 2 -maxdepth 2 -type f -mmin "+$((MARKER_KEEP_DAYS * 1440))" -exec rm -f {} + 2>/dev/null || true
}
