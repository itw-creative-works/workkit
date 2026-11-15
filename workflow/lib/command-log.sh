#!/usr/bin/env bash
# workflow/lib/command-log.sh: the command log. A `workkit` command that does
# work runs again as a child whose two streams reach the terminal as they come
# and its log file plain, one whole run each. Sourced by workkit.sh, functions
# only; reads wk_user_dir and wk_native_path (platform.sh), wk_log_path
# (suite.sh) and SHIP_VERBS (workkit/ship.sh).

# _wk_machine_command <name>: a command that logs to ~/.workkit/logs/, since it
# may run outside any repo.
_wk_machine_command() {
  case "$1" in
    setup|update|doctor|publish) return 0 ;;
  esac
  return 1
}

# wk_command_log_name <args...>: the name a `workkit` call logs under (`setup`,
# `ship plan`, `proof red`), or nothing for a command that writes no log.
wk_command_log_name() {
  local verb
  if _wk_machine_command "${1:-}"; then
    printf '%s\n' "$1"
    return 0
  fi
  case "${1:-}" in
    proof) [ "${2:-}" != red ] || printf 'proof red\n' ;;
    ship)
      # The CI watch keeps its own log, ci.log.
      [ "${2:-}" != watch ] || return 0
      for verb in "${SHIP_VERBS[@]}"; do
        [ "$verb" != "${2:-}" ] || printf 'ship %s\n' "$verb"
      done
      ;;
  esac
  return 0
}

# wk_command_log_path <name>: a machine command's file under ~/.workkit/logs/,
# a repo command's in the log folder of the repo holding $PWD (wk_log_path),
# its space a dash; nothing outside a repo, 1 on a bad log folder (said).
wk_command_log_path() {
  local root
  if _wk_machine_command "$1"; then
    printf '%s/logs/%s.log\n' "$(wk_user_dir)" "$1"
    return 0
  fi
  root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
  wk_log_path "$root" "${1// /-}.log"
}

# wk_command_log_plain: stdin as a terminal leaves it: each line's text after
# its last carriage return (a spinner's frames, a CRLF's end), its color and
# link codes removed, a line of blanks empty.
wk_command_log_plain() {
  LC_ALL=C awk '{
    n = split($0, part, "\r")
    while (n > 1 && part[n] == "") n--
    line = part[n]
    gsub(/\033\[[0-9;?]*[A-Za-z]/, "", line)
    gsub(/\033\][^\007\033]*(\007|\033\\)/, "", line)
    if (line ~ /^[ \t]*$/) line = ""
    print line
  }'
}

# _wk_terminal_held: this runs under a command log (wk_command_log) still
# holding the call's own stdout on 7, its stderr on 8 and the raw log on 9.
_wk_terminal_held() {
  [ -n "${WK_COMMAND_LOGGED:-}" ] && { true >&7 && true >&8 && true >&9; } 2>/dev/null
}

# _wk_off_log <what> <command...>: the command on the call's own stdout and
# stderr, and in the log one line naming <what> in its place.
_wk_off_log() {
  local what="$1"
  shift
  printf 'workkit: %s ran on the terminal and is not in this log\n' "$what" >&9
  "$@" >&7 2>&8
}

# wk_secret_step <what> <command...>: a step that shows a secret (a token, a
# sign-in code) runs out of the command log wherever one holds the call's own
# streams; with none it just runs.
wk_secret_step() {
  local what="$1"
  shift
  if _wk_terminal_held; then _wk_off_log "$what" "$@"; else "$@"; fi
}

# wk_terminal_step <what> <command...>: a program handed the terminal, which may
# ask there, runs out of the command log only where the call's own stdout or
# stderr is a terminal; anywhere else it is logged whole like any step.
wk_terminal_step() {
  local what="$1"
  shift
  if _wk_terminal_held && { [ -t 7 ] || [ -t 8 ]; }; then _wk_off_log "$what" "$@"; else "$@"; fi
}

# wk_command_log <file> <name> <command...>: run the command, its streams teed
# as they come, then write them plain (wk_command_log_plain) and the line
# `workkit <name>: exit <code>` beside <file>, and move that onto it. Answers
# the command's code; a log that cannot be written is said, never a failure.
wk_command_log() {
  local file="$1" name="$2" raw tmp rc=0 sig=''
  shift 2
  if ! mkdir -p "${file%/*}" 2>/dev/null || ! raw=$(mktemp "${TMPDIR:-/tmp}/workkit-log.XXXXXX" 2>/dev/null); then
    printf 'workkit: could not write %s, so %s runs without its log\n' "$(wk_native_path "$file")" "$name" >&2
    WK_COMMAND_LOGGED=1 "$@" || rc=$?
    return "$rc"
  fi
  tmp="${file%.log}.$$.log"
  # The child's stdout is a pipe: this stands in for the terminal it had
  # (lib/voice.sh), and a no already given stays.
  [ ! -t 1 ] || export WORKKIT_COLOR="${WORKKIT_COLOR:-1}"
  # Ctrl-C ends the command; this shell and the tees stay to write its log. A
  # HUP or TERM, run once the command ends, still writes it and removes the raw
  # copy, then ends with the signal's code.
  trap ':' INT
  trap 'sig=129' HUP
  trap 'sig=143' TERM
  set -o pipefail
  # 7 and 8 keep the call's own stdout and stderr, 9 the raw log, for the
  # secret and terminal steps and the spinner (wk_spin_fd) in the command.
  { { WK_COMMAND_LOGGED=1 "$@" 2>&1 1>&3 3>&- | tee -i -a "$raw" >&2 3>&-; } 3>&1 | tee -i -a "$raw"; } \
    7>&1 8>&2 9>>"$raw" || rc=$?
  trap - INT HUP TERM
  if ! { wk_command_log_plain < "$raw"; printf 'workkit %s: exit %s\n' "$name" "$rc"; } > "$tmp" \
    || ! mv -f "$tmp" "$file" 2>/dev/null; then
    rm -f "$tmp"
    printf 'workkit: could not write %s\n' "$(wk_native_path "$file")" >&2
  fi
  rm -f "$raw"
  [ -z "$sig" ] || exit "$sig"
  return "$rc"
}

# wk_command_log_run <script> <args...>: a call that logs (wk_command_log_name)
# runs again as `<script> <args...>` under wk_command_log, and this exits with
# its code; any other call returns, as does a repo command outside a repo. A
# bad log folder exits 1 on its reader's line.
wk_command_log_run() {
  local script="$1" name file rc=0
  shift
  name=$(wk_command_log_name "$@")
  [ -n "$name" ] || return 0
  file=$(wk_command_log_path "$name") || exit 1
  [ -n "$file" ] || return 0
  wk_command_log "$file" "$name" "$BASH" "$script" "$@" || rc=$?
  exit "$rc"
}
