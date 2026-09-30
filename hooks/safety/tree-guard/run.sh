#!/bin/bash
# safety/tree-guard: PreToolUse hook (Bash). The working tree is shared, so
# this bounces the git commands that discard or park state the agent cannot
# see: a checkout carrying a pathspec, a forced switch, restore unless
# index-only, stash but `list`/`show`, a forced clean, `reset --hard`. Always
# on; `WORKKIT_ALLOW_DISCARD=1` on the command is the owner's escape, heard out
# loud. Fails open on its own errors. The checkout line and the misses: README.md.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0
cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# Shared text handling (heredoc-body strip, multiline quote strip): hooks/lib/commit.sh,
# the same preparation the commit hooks do before walking clauses. A heredoc BODY
# is file content, and a quoted span is data: neither is a command.
src=$(hook_strip_heredocs "$cmd")
stripped=$(hook_strip_quotes "$src")
stripped=$(hook_fold_redirect_amp "$stripped")

# Drop from a clause what is not an argument: a redirection with its target,
# and everything from an unquoted `#` on, so `git checkout main > /tmp/out` stays
# a branch switch and a `--hard` in a trailing comment answers for nothing.
tg_strip_noise() {
  local out=() w n
  while [ $# -gt 0 ]; do
    w="$1"; shift
    case "$w" in
      \#*) break ;;
      *'>'*|*'<'*)
        n=$(hook_redirect_span "$w")
        if [ "$n" -eq 0 ]; then out+=("$w"); elif [ "$n" -eq 2 ] && [ $# -ge 1 ]; then shift; fi
        ;;
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
    # A quoted operand: quoting is how a glob is passed (README.md).
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
  # `git checkout <ref> <path>`: two operands is the ref+pathspec form.
  [ "$operands" -gt 1 ]
}

# `git switch` is checkout's modern half, and takes no pathspec at all, so the
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
  # The commit finder's own peel (hook_peel_prefixes), so `(git …`, `command git …`,
  # `time git …`, `VAR=x git …` and the rest of its list read as the git clause they run.
  hook_peel_prefixes "$@"
  case "$HOOK_PEEL_WORD" in
    git|*/git) ;;
    *) continue ;;
  esac
  shift "$((HOOK_PEEL_SKIP + 1))"
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
    stash)
      # `list` and `show` only READ stash state; every other subcommand (bare
      # stash included) parks or rewrites tree state.
      case "${1:-}" in
        list|show) ;;
        *) found="git stash"; break ;;
      esac
      ;;
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
if hook_has_escape "$stripped" WORKKIT_ALLOW_DISCARD; then
  aside="tree-guard: stood aside for a deliberate discard: WORKKIT_ALLOW_DISCARD=1 is set on this command (${found})."
  hook_pretool_notice "$aside"
  exit 0
fi

{
  echo "tree-guard: BLOCKED this command: it runs ${found}, which discards or parks working-tree state, and this tree is SHARED: reverting your own edits that way takes whatever else is uncommitted with it (issue #157)."
  echo "Revert your own changes by reverse-editing your own hunks: edit each file back to what it was. If the discard is genuinely intended, the OWNER reruns the command with WORKKIT_ALLOW_DISCARD=1 in front of it."
} >&2
exit 2
