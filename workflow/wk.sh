#!/usr/bin/env bash
# wk — the capture CLI (issue #13).
#
# One job: get a thought out of a human's head and into the right inbox with no
# session, no agent, and no network. `wk.sh note "the thought"` appends a bullet
# to the inbox of the repo the shell is standing in, and to the TOWER repo's
# inbox when it is standing outside one. Triage drains both into GitHub issues.
#
# Usage: wk.sh note <text...>
#
# Which inbox is decided by a WALK UP from the current directory: the first
# ancestor holding a participating `.workkit/settings.json` wins. That is a
# directory walk rather than `git rev-parse` on purpose — the answer this needs
# is "which participating repo am I in", and a nested checkout or a worktree
# would make git's answer and the settings file's answer differ.
#
# There is no user-level inbox any more (issue #77): captures that belong to no
# project belong to the repo whose issues ARE the cross-project home, which is
# the tower clone at `~/.workkit/tower` — itself a participating repo, so a
# shell standing inside it is answered by the walk above like any other.
#
# Reached at the engine's stable address: ~/.claude/workkit/wk.sh. Putting it on
# the PATH or behind an alias is the user's own shell config — the heal maintains
# the address and nothing beyond it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# The global layer's addresses and the one question about the clone this file
# asks — is the folder at that path the home repo, or somebody else's repo
# sitting there. Sourcing runs nothing.
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=./home.sh
. "$SCRIPT_DIR/home.sh"

# The workflow state directory's name, for the ENGINE layer — the same constant
# standards.sh carries beside this file.
WORKKIT_DIR=".workkit"
INBOX_NAME="inbox.md"

usage() {
  printf 'usage: wk.sh note <text...>\n' >&2
  printf '  appends "- <text>" to this repo'"'"'s %s/%s, or to the tower repo'"'"'s outside one\n' \
    "$WORKKIT_DIR" "$INBOX_NAME" >&2
}

# The participation test the hooks use: the committed settings.json is the
# repo's yes, and a deliberate `"enabled": false` is its no. A file with no
# `enabled` key at all is a legacy opt-in and counts as yes — matching
# hooks/docs/session/run.sh and the engine's resolve_state.
participating() {
  local settings="$1/$WORKKIT_DIR/settings.json"
  [[ -f "$settings" ]] || return 1
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$settings" 2>/dev/null && return 1
  return 0
}

# The first participating repo root at or above the current directory, or
# nothing. `pwd -P` first, so a symlinked path walks the real tree.
find_repo_root() {
  local dir
  dir="$(pwd -P)"
  while [[ -n "$dir" && "$dir" != "/" ]]; do
    if participating "$dir"; then
      printf '%s' "$dir"
      return 0
    fi
    dir="${dir%/*}"
  done
  if participating "/"; then
    printf '/'
  fi
  return 0
}

# Append one bullet, creating the file from the engine's template when it is
# missing so a hand-made inbox reads exactly like a seeded one. Never clobbers:
# a file whose last byte is not a newline gets one before the bullet, so the
# entry cannot land on the end of somebody's unterminated line.
append_note() {
  local file="$1" note="$2" dir="${1%/*}"

  mkdir -p "$dir"
  if [[ ! -e "$file" ]]; then
    if [[ -f "$TEMPLATES_DIR/$INBOX_NAME" ]]; then
      cp "$TEMPLATES_DIR/$INBOX_NAME" "$file"
    else
      printf 'wk: template missing at %s/%s — reinstall the workflow core\n' "$TEMPLATES_DIR" "$INBOX_NAME" >&2
      return 1
    fi
  fi
  if [[ -s "$file" && -n "$(tail -c 1 "$file")" ]]; then
    printf '\n' >>"$file"
  fi
  printf -- '- %s\n' "$note" >>"$file"
}

cmd_note() {
  local note root file
  # Multiple words join with spaces, so `wk.sh note fix the tower poller` works
  # unquoted — the shell already split it and this is the reassembly.
  note="$*"
  # Whitespace-only is an empty note: leading and trailing blanks stripped.
  note="${note#"${note%%[![:space:]]*}"}"
  note="${note%"${note##*[![:space:]]}"}"
  if [[ -z "$note" ]]; then
    usage
    exit 1
  fi

  root="$(find_repo_root)"
  if [[ -n "$root" ]]; then
    file="$root/$WORKKIT_DIR/$INBOX_NAME"
  elif wk_home_ready; then
    # Outside every project: the tower repo's own inbox, which is where the
    # captures that belong to no project are triaged from. `wk_home_ready` and
    # not the presence of a `.git` — a foreign repo sitting at that path is
    # refused here exactly as it is everywhere else in the engine.
    file="$WK_HOME_INBOX"
  elif [[ "$(wk_home_state)" == 'other' ]]; then
    # Something else is at the clone's path. Nothing is written into somebody
    # else's repo, here or anywhere else in the engine.
    printf 'wk: %s is not the home repo'"'"'s clone — move it aside, then `workkit setup`; captures outside a project land in the tower repo'"'"'s inbox\n' "$WK_HOME_DIR" >&2
    exit 1
  else
    # Nothing to append to, and this command creates nothing global: a thought
    # written into a folder no triage run reads is a thought lost quietly.
    printf 'wk: there is no home yet — `workkit setup` creates the tower repo, and captures outside a project land in its inbox\n' >&2
    exit 1
  fi

  append_note "$file" "$note"
  printf 'noted → %s\n' "$file"
}

case "${1:-}" in
  note) shift; cmd_note "$@" ;;
  *)    usage; exit 1 ;;
esac
