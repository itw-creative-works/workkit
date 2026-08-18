#!/bin/bash
# safety/tree-guard — PreToolUse hook (Bash)
# The working tree is SHARED (issue #157): a worker reverting its own edits with
# `git checkout -- <files>` discarded another agent's uncommitted work in the
# same files, and three later runs reached for `git stash` over trees holding a
# whole wave of parked work. Every one of those commands throws away, or parks,
# state the agent running it cannot see — so this guard bounces them and names
# the scoped alternative: reverse-edit your own hunks.
#
# Blocked, wherever they sit in a compound, and through the prefixes the house
# finder in _lib.sh peels (`git -C <path>`, a path spelling, `command`/`env`/an
# UNQUOTED `eval`, `VAR=x`, a `(`/`{` opener) — a quoted eval body, an `sh -c`
# string, a control-flow wrapper and a command substitution are accepted misses,
# the same line that finder draws:
#   git checkout   with a pathspec — `--`, a path-looking or quoted operand,
#                  two operands, `-f`/`--force`, `--pathspec-from-file`
#   git switch     with `--discard-changes` or `-f`/`--force` (it takes no
#                  pathspec, so the plain switch is legal)
#   git restore    unless `--staged` is there WITHOUT `--worktree`
#   git stash      every subcommand, bare included
#   git clean      with a force spelling (`-f`, `-fd`, `--force`)
#   git reset      with `--hard`
# Always on: whether the tree is dirty beyond this agent's own files is not
# knowable from here, so the guard never tries to decide it. The deliberate
# discard escapes by carrying `WORKKIT_ALLOW_DISCARD=1` as an assignment on the
# command, which is the OWNER's to add — the hook then stands aside out loud.
#
# Where the checkout line sits, and why: a lone ref operand is a branch switch
# and stays legal (the ship PR path uses it, and git refuses it over conflicting
# changes anyway), while anything that could name a file is a discard. The
# working tree answers the ambiguous case — `feature/thing` is a branch,
# `src/app.js` is a file that exists — and a QUOTED operand reads as a pathspec,
# since quoting an operand is how a glob is passed and almost never how a branch
# is named. Fully documented in README.md.
#
# Fail open on the guard's own errors (no jq, unreadable payload): a broken
# guard must never wedge a session.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

cmd=$(jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0
cwd=$(jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# Shared text handling (heredoc-body strip, multiline quote strip): hooks/_lib.sh,
# the same preparation the commit hooks do before walking clauses. A heredoc BODY
# is file content, and a quoted span is data — neither is a command.
. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"
src=$(hook_strip_heredocs "$cmd")
stripped=$(hook_strip_quotes "$src")

# Drop from a clause what is not an ARGUMENT: a redirection (with its target,
# whether attached as `>/tmp/out` or sitting in the next token) and everything
# from an unquoted `#` onward. Both used to be walked like operands, so
# `git checkout main > /tmp/out` and `git checkout main # note` read as the
# ref-plus-pathspec form and bounced a legal branch switch — and a `--hard` or a
# `-f` inside a trailing comment answered for the command in front of it.
# Runs for every clause, ahead of the git test, so each subcommand's judgment
# sees the command's real words and nothing else.
tg_strip_noise() {
  local out=() w
  while [ $# -gt 0 ]; do
    w="$1"; shift
    case "$w" in
      \#*) break ;;
      *'>'|*'<') [ $# -ge 1 ] && shift ;;
      *'>'*|*'<'*) ;;
      *) out+=("$w") ;;
    esac
  done
  TG_WORDS=("${out[@]+"${out[@]}"}")
}

# A token that names a PATH rather than a ref.
tg_is_path() {
  case "$1" in
    .|..|./*|../*|/*|\~/*) return 0 ;;
    *'*'*|*'?'*|*'['*) return 0 ;;
    # A quoted operand, per the header: quoting is how a glob is passed.
    _hookq_*) return 0 ;;
  esac
  [ -e "$cwd/$1" ]
}

# The arguments of `git checkout`: does a pathspec sit among them?
tg_checkout_discards() {
  local operands=0 w
  while [ $# -gt 0 ]; do
    w="$1"; shift
    case "$w" in
      --) return 0 ;;
      --force) return 0 ;;
      --pathspec-from-file|--pathspec-from-file=*) return 0 ;;
      --conflict|--start-point) [ $# -ge 1 ] && shift ;;
      --*) ;;
      -[!-]*)
        case "$w" in *f*) return 0 ;; esac
        # -b/-B/--orphan take the new branch's name, which is not an operand.
        case "$w" in *[bB]) [ $# -ge 1 ] && shift ;; esac
        ;;
      -*) ;;
      *)
        operands=$((operands + 1))
        tg_is_path "$w" && return 0
        ;;
    esac
  done
  # `git checkout <ref> <path>` — two operands is the ref+pathspec form.
  [ "$operands" -gt 1 ]
}

# `git switch` is checkout's modern half, and takes no pathspec at all — so the
# plain switch is legal and only the two spellings that overwrite local
# modifications are not.
tg_switch_discards() {
  local w
  for w in "$@"; do
    case "$w" in
      --discard-changes|--force) return 0 ;;
      -[!-]*) case "$w" in *f*) return 0 ;; esac ;;
    esac
  done
  return 1
}

# The arguments of `git restore`: the index-only form is the one that leaves the
# working tree alone.
tg_restore_discards() {
  local staged=0 worktree=0 w
  while [ $# -gt 0 ]; do
    w="$1"; shift
    case "$w" in
      --staged) staged=1 ;;
      --worktree) worktree=1 ;;
      --source=*) ;;
      --source|-s) [ $# -ge 1 ] && shift ;;
      -[!-]*)
        case "$w" in *S*) staged=1 ;; esac
        case "$w" in *W*) worktree=1 ;; esac
        ;;
      *) ;;
    esac
  done
  [ "$staged" -eq 1 ] && [ "$worktree" -eq 0 ] && return 1
  return 0
}

# `git clean` only removes files when it is forced.
tg_clean_discards() {
  local w
  for w in "$@"; do
    case "$w" in
      --force) return 0 ;;
      -[!-]*) case "$w" in *f*) return 0 ;; esac ;;
    esac
  done
  return 1
}

# `git reset` touches the working tree only with --hard.
tg_reset_discards() {
  local w
  for w in "$@"; do
    [ "$w" = "--hard" ] && return 0
  done
  return 1
}

# The discarding shape this command carries, named for the message.
found=""
while IFS= read -r clause; do
  # shellcheck disable=SC2086  # word splitting is intentional; quotes are stripped
  set -- $clause
  tg_strip_noise "$@"
  set -- ${TG_WORDS[@]+"${TG_WORDS[@]}"}
  # Peel the wrapper prefixes, exactly as the commit finder does, so `(git …`,
  # `command git …`, `env git …`, `eval git …` and `VAR=x git …` read as the git
  # clause they run.
  while [ $# -gt 0 ]; do
    case "$1" in
      \(|\{) shift ;;
      \(*) w="${1#\(}"; shift; set -- "$w" "$@" ;;
      command|env|eval) shift ;;
      [A-Za-z_]*=*) shift ;;
      *) break ;;
    esac
  done
  case "${1:-}" in
    git|*/git) ;;
    *) continue ;;
  esac
  shift
  # git's own options before the subcommand; the value-taking ones consume their
  # value, so `git -C <path> stash` is the stash it runs.
  sub=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path) [ $# -ge 2 ] || break; shift 2 ;;
      -*) shift ;;
      *) sub="$1"; shift; break ;;
    esac
  done
  case "$sub" in
    stash) found="git stash"; break ;;
    checkout)
      if tg_checkout_discards "$@"; then found="git checkout with a pathspec"; break; fi ;;
    switch)
      if tg_switch_discards "$@"; then found="git switch --discard-changes/--force"; break; fi ;;
    restore)
      if tg_restore_discards "$@"; then found="git restore over the working tree"; break; fi ;;
    clean)
      if tg_clean_discards "$@"; then found="git clean -f"; break; fi ;;
    reset)
      if tg_reset_discards "$@"; then found="git reset --hard"; break; fi ;;
  esac
done <<EOF
$(printf '%s' "$stripped" | tr ';|&' '\n')
EOF

[ -n "$found" ] || exit 0

# The escape, read off the STRIPPED text so a mention inside quotes is not one.
# Same visible channel commit-gate's stand-down uses: a top-level systemMessage
# for the user plus additionalContext for Claude, and NO permissionDecision, so
# the command's fate is decided exactly as it would be with this hook silent.
if printf '%s' "$stripped" | grep -Eq '(^|[^[:alnum:]_])WORKKIT_ALLOW_DISCARD=1([^[:alnum:]_]|$)'; then
  aside="tree-guard: stood aside for a deliberate discard — WORKKIT_ALLOW_DISCARD=1 is set on this command (${found})."
  jq -n --arg m "$aside" '{
    "systemMessage": $m,
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "additionalContext": $m
    }
  }'
  exit 0
fi

{
  echo "tree-guard: BLOCKED this command — it runs ${found}, which discards or parks working-tree state, and this tree is SHARED: reverting your own edits that way takes whatever else is uncommitted with it (issue #157)."
  echo "Revert your own changes by reverse-editing your own hunks — edit each file back to what it was. If the discard is genuinely intended, the OWNER reruns the command with WORKKIT_ALLOW_DISCARD=1 in front of it."
} >&2
exit 2
