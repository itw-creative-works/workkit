#!/usr/bin/env bash
# wk: the capture CLI. Appends a bullet to the capture file of the participating
# repo the shell stands in, or files an issue on the home repo outside one
# (workflow/README.md § The capture CLI).
# Usage: wk.sh note <text...>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# For the global layer's addresses and whether the clone's path holds the home
# repo.
# shellcheck source=./lib.sh
. "$SCRIPT_DIR/lib.sh"
# shellcheck source=./home.sh
. "$SCRIPT_DIR/home.sh"

# The same constant standards.sh carries.
WORKKIT_DIR=".workkit"
CAPTURE_NAME="capture.md"

usage() {
  printf 'usage: wk.sh note <text...>\n' >&2
  printf '  appends "- <text>" to this repo'"'"'s %s/%s, or files an issue on the home repo outside one\n' \
    "$WORKKIT_DIR" "$CAPTURE_NAME" >&2
}

# The hooks' participation test, counted only at a repo root: otherwise every
# `.workkit/` on the way up reads as an opt-in, the machine's own state
# directory among them (every Windows temp directory sits under a profile).
participating() {
  local settings="$1/$WORKKIT_DIR/settings.json"
  wk_is_repo_root "$1" || return 1
  [[ -f "$settings" ]] || return 1
  # The configured state dir is refused even at a repo root (a home directory
  # tracked in git): it is the machine's file wherever it is found.
  local state_dir user_dir
  state_dir="$(cd "$1/$WORKKIT_DIR" 2>/dev/null && pwd -P)" || state_dir=""
  user_dir="$(cd "$WK_USER_DIR" 2>/dev/null && pwd -P)" || user_dir=""
  if [[ -n "$state_dir" && "$state_dir" == "$user_dir" ]]; then
    return 1
  fi
  wk_settings_declined "$settings" && return 1
  return 0
}

# A directory walk rather than `git rev-parse`: a nested checkout or a worktree
# would make git's answer and the settings file's differ. `pwd -P` first, so a
# symlinked path walks the real tree.
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

# Never clobbers: a missing file starts from the template, and an unterminated
# last line gets its newline before the bullet.
append_note() {
  local file="$1" note="$2" dir="${1%/*}"

  mkdir -p "$dir"
  if [[ ! -e "$file" ]]; then
    if [[ -f "$TEMPLATES_DIR/$CAPTURE_NAME" ]]; then
      cp "$TEMPLATES_DIR/$CAPTURE_NAME" "$file"
    else
      wk_error "template missing at $TEMPLATES_DIR/$CAPTURE_NAME; reinstall the workflow core"
      return 1
    fi
  fi
  if [[ -s "$file" && -n "$(tail -c 1 "$file")" ]]; then
    printf '\n' >>"$file"
  fi
  printf -- '- %s\n' "$note" >>"$file"
}

# The spec's issue anatomy, so a shell-filed note reads like a triaged one. A
# fresh home repo may lack the labels, so a failed attempt is retried once
# without them; both failing prints the note back.
home_issue() {
  local note="$1" slug title body clean url=''

  if ! command -v gh >/dev/null 2>&1; then
    wk_error "gh is not on this machine, so the note could not be filed on the home repo: $note"
    exit 1
  fi

  slug="$(wk_home_slug)"
  # The body carries the thought in full, so the title may be cut.
  title="$note"
  # Under a non-UTF-8 locale the cut can sever a multibyte character; iconv
  # drops the remnant. `-c` still exits non-zero on what it dropped, so the
  # status is ignored and the repair taken only when iconv answered something.
  if [[ "${#title}" -gt 72 ]]; then title="${title:0:71}…"; fi
  if command -v iconv >/dev/null 2>&1; then
    clean="$(printf '%s' "$title" | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null || true)"
    if [[ -n "$clean" ]]; then title="$clean"; fi
  fi
  body="## Description

$note

## Spec

None needed: small item."

  url="$(wk_spin "filing the note on $slug" gh issue create --repo "$slug" --title "$title" \
    --label 'status:inbox,type:idea' --body "$body" 2>/dev/null)" || url=''
  if [[ -z "$url" ]]; then
    url="$(wk_spin "filing the note without labels" gh issue create --repo "$slug" --title "$title" --body "$body" 2>/dev/null)" || url=''
    if [[ -z "$url" ]]; then
      wk_error "\`gh issue create\` on $slug did not finish, so the note was not filed: $note"
      exit 1
    fi
    wk_warn "the status:inbox and type:idea labels could not be applied on $slug; the issue is filed without them"
  fi

  wk_ok "noted → ${url##*$'\n'}"
}

cmd_note() {
  local note root file
  # Multiple words join with spaces, so the note works unquoted.
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
    file="$root/$WORKKIT_DIR/$CAPTURE_NAME"
    append_note "$file" "$note"
    wk_ok "noted → $file"
    return 0
  fi

  if wk_home_ready; then
    # `wk_home_ready`, not a `.git`, so a foreign repo at that path is refused.
    home_issue "$note"
    return 0
  fi

  if [[ "$(wk_home_state)" == 'other' ]]; then
    # The engine never adopts what it finds at the clone's path.
    wk_error "$WK_HOME_DIR is not the home repo's clone; move it aside, then \`workkit setup\`; captures outside a project become issues on the home repo"
    exit 1
  fi

  # No home, and this command creates nothing global: refuse loudly.
  wk_error "there is no home yet; \`workkit setup\` creates the home repo, and captures outside a project become issues on it"
  exit 1
}

case "${1:-}" in
  note) shift; cmd_note "$@" ;;
  *)    usage; exit 1 ;;
esac
