#!/usr/bin/env bash
# wk — the capture CLI (issue #13).
#
# One job: get a thought out of a human's head and into the right place with no
# session and no agent. `wk.sh note "the thought"` appends a bullet to the inbox
# of the repo the shell is standing in; standing outside every participating
# repo it files the thought as an issue on the home repo instead. Triage drains
# the inboxes into issues, and those issues are already there.
#
# Usage: wk.sh note <text...>
#
# Which inbox is decided by a WALK UP from the current directory: the first
# ancestor holding a participating `.workkit/settings.json` wins. That is a
# directory walk rather than `git rev-parse` on purpose — the answer this needs
# is "which participating repo am I in", and a nested checkout or a worktree
# would make git's answer and the settings file's answer differ.
#
# There is no inbox file outside a project (issues #77, #79): the tower clone at
# `~/.workkit/tower` is engine territory and carries no `.workkit/` at all, so a
# capture that belongs to no project goes straight to the home repo's issues,
# where triage would have put it anyway. That path needs the network, so it is
# the one case where a note can be REFUSED: offline, the thought is printed back
# rather than buffered into a file no triage run reads.
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
  printf '  appends "- <text>" to this repo'"'"'s %s/%s, or files an issue on the home repo outside one\n' \
    "$WORKKIT_DIR" "$INBOX_NAME" >&2
}

# The participation test the hooks use: the committed settings.json is the
# repo's yes, and a deliberate `"enabled": false` is its no. A file with no
# `enabled` key at all is a legacy opt-in and counts as yes — matching
# hooks/docs/session/run.sh and the engine's resolve_state.
participating() {
  local settings="$1/$WORKKIT_DIR/settings.json"
  [[ -f "$settings" ]] || return 1
  # The machine's own state dir is NOT a repo opt-in. The walk passes through
  # $HOME, where `.workkit/settings.json` is the machine settings file (the site
  # options) — with no `enabled` key it would read as a legacy
  # yes and the note would buffer into a file the spec says must not exist.
  local state_dir user_dir
  state_dir="$(cd "$1/$WORKKIT_DIR" 2>/dev/null && pwd -P)" || state_dir=""
  user_dir="$(cd "$WK_USER_DIR" 2>/dev/null && pwd -P)" || user_dir=""
  if [[ -n "$state_dir" && "$state_dir" == "$user_dir" ]]; then
    return 1
  fi
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

# The note as an issue on the home repo — the whole outside-a-project path.
#
# The anatomy is the spec's, so an issue filed from a shell is indistinguishable
# from one filed by triage: `## Description` carrying the thought, `## Spec`
# carrying the small-item literal, `status:inbox` and `type:idea` for the labels.
#
# A fresh home repo may not carry the label vocabulary yet, so a first attempt
# that fails is retried ONCE without them: an issue with no labels is triageable
# and a thought that never left the shell is not. Both attempts failing prints
# the note back — this command has no file to fall back to by design.
home_issue() {
  local note="$1" slug title body url=''

  if ! command -v gh >/dev/null 2>&1; then
    printf 'wk: gh is not on this machine, so the note could not be filed on the home repo: %s\n' "$note" >&2
    exit 1
  fi

  slug="$(wk_home_slug)"
  # The title is one line at a glance; the body carries the thought in full, so
  # nothing is lost to the truncation.
  title="$note"
  # Under a non-UTF-8 locale bash counts and cuts BYTES, so the 72-char cut can
  # sever a multibyte character and hand gh an invalid title. iconv drops
  # whatever the cut left behind; a machine without it keeps the cut as it is,
  # since a truncated title still beats no note at all.
  if [[ "${#title}" -gt 72 ]]; then title="${title:0:71}…"; fi
  if command -v iconv >/dev/null 2>&1; then
    title="$(printf '%s' "$title" | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null || printf '%s' "$title")"
  fi
  body="## Description

$note

## Spec

None needed — small item."

  url="$(gh issue create --repo "$slug" --title "$title" \
    --label 'status:inbox,type:idea' --body "$body" 2>/dev/null)" || url=''
  if [[ -z "$url" ]]; then
    url="$(gh issue create --repo "$slug" --title "$title" --body "$body" 2>/dev/null)" || url=''
    if [[ -z "$url" ]]; then
      printf 'wk: `gh issue create` on %s did not finish, so the note was not filed: %s\n' "$slug" "$note" >&2
      exit 1
    fi
    printf 'wk: the status:inbox and type:idea labels could not be applied on %s — the issue is filed without them\n' "$slug" >&2
  fi

  printf 'noted → %s\n' "${url##*$'\n'}"
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
    append_note "$file" "$note"
    printf 'noted → %s\n' "$file"
    return 0
  fi

  if wk_home_ready; then
    # Outside every project: an issue on the home repo, which is where the
    # captures that belong to no project are queued. `wk_home_ready` and not the
    # presence of a `.git` — a foreign repo sitting at that path is refused here
    # exactly as it is everywhere else in the engine.
    home_issue "$note"
    return 0
  fi

  if [[ "$(wk_home_state)" == 'other' ]]; then
    # Something else is at the clone's path, so this machine has no home repo to
    # file against — and the engine never adopts what it finds there.
    printf 'wk: %s is not the home repo'"'"'s clone — move it aside, then `workkit setup`; captures outside a project become issues on the home repo\n' "$WK_HOME_DIR" >&2
    exit 1
  fi

  # No home at all, and this command creates nothing global: a thought filed
  # nowhere is a thought lost quietly.
  printf 'wk: there is no home yet — `workkit setup` creates the home repo, and captures outside a project become issues on it\n' >&2
  exit 1
}

case "${1:-}" in
  note) shift; cmd_note "$@" ;;
  *)    usage; exit 1 ;;
esac
