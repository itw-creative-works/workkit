#!/bin/bash
# workflow:snapshot: PostToolUse hook (Bash). The claim of an issue to
# status:building takes the repo snapshot scripts/red-proof.sh runs against, or
# adds its number to the live one (replacing it once stale); a flip that leaves
# no issue in that repo at status:building drops it. The repo is the one the
# flip names, another repo's through the roster. A repo it cannot place or a
# failed copy is a notice; it never blocks and always exits 0.
# Detail: docs/hooks.md § workflow:snapshot.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat) || input=""
command -v jq >/dev/null 2>&1 || exit 0

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cmd" ] || exit 0

# Cheap exits first, on the raw text: a claim spells status:building, and a
# release spells it, a status:qa or status:complete add, or the close.
hook_gh_names "$cmd" 'edit|close' || exit 0
if ! printf '%s' "$cmd" | grep -Eq 'status:(building|qa|complete)' \
  && ! hook_gh_names "$cmd" close; then
  exit 0
fi

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || cwd="$PWD"

# The text handling proof-guard does before its walk: a heredoc body is file
# content, and a redirect's `&` never cuts a clause.
src=$(hook_strip_heredocs "$cmd")
src=$(hook_fold_redirect_amp "$src")
clauses_text=$(hook_gh_clauses "$src")

notes=()
note() { notes+=("$1"); }

# has_label <flag values> <label>: the label is one of the comma-listed values,
# matched whole, so status:building never matches inside another label.
has_label() {
  printf '%s\n' "$1" | tr -d "\"'" | tr ',' '\n' \
    | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | grep -Fxq -- "$2"
}

# place <clause>: sets snap_root (the repo folder) and snap_repo (the slug the
# flip named, empty for none); 1 after a note when the repo cannot be placed.
place() {
  local repo folder
  snap_repo=""
  if ! repo=$(hook_gh_repo "$1"); then
    note "a --repo value could not be read (a variable, a substitution or a quoted span), so no snapshot was taken or dropped for it."
    return 1
  fi
  if [ -z "$repo" ] || hook_gh_repo_is_here "$repo" "$cwd"; then
    if [ -z "$repo" ] && [ "$saw_cd" -eq 1 ]; then
      note "the command changes directory before a flip naming no --repo, so no snapshot was taken or dropped for it."
      return 1
    fi
    snap_root=$(hook_snapshot_root "$cwd") \
      || { note "the session's folder lies in no git repository, so no snapshot was taken or dropped."; return 1; }
  else
    folder=$(wk_roster_path "$repo") \
      || { note "$repo is not opted in on this machine's workkit roster (absent or declined), so no snapshot was taken or dropped for it."; return 1; }
    snap_root=$(hook_snapshot_root "$folder") \
      || { note "$repo's roster folder $folder lies in no git repository, so no snapshot was taken or dropped for it."; return 1; }
  fi
  snap_repo="$repo"
}

# claim <issue>...: take the snapshot when none is live; a live one gets the
# numbers, unless none of its issues is still building, which replaces it. A
# failed read keeps the live one.
claim() {
  local dir stale=0 err
  dir=$(hook_snapshot_dir "$snap_root") || return 0
  if [ -d "$dir/tree" ]; then
    hook_snapshot_stale "$snap_root" "$snap_repo" || stale=$?
    if [ "$stale" -ne 0 ]; then
      hook_snapshot_add "$snap_root" "$@" \
        || note "could not add issue $* to the snapshot of $snap_root."
      return 0
    fi
  fi
  if ! err=$(hook_snapshot_take "$snap_root" "$@" 2>&1); then
    note "the snapshot of $snap_root could not be taken, so red-proof has none for it: ${err:-the copy failed}"
  fi
}

# release: a GitHub read listing no issue of the repo at status:building drops
# the snapshot; a failed read leaves it for the next claim's stale check.
release() {
  local dir building
  dir=$(hook_snapshot_dir "$snap_root") || return 0
  [ -d "$dir" ] || return 0
  building=$(cd "$snap_root" 2>/dev/null && hook_issues_building "$snap_repo") || return 0
  [ -n "$building" ] || hook_snapshot_drop "$snap_root" || true
}

saw_cd=0
while IFS= read -r clause; do
  [ -n "$clause" ] || continue
  detect=$(hook_strip_quotes "$clause")
  # shellcheck disable=SC2086  # the stripped clause's words; globbing is off
  if hook_clause_changes_dir $detect; then saw_cd=1; continue; fi
  sub=$(hook_gh_clause_sub "$detect")
  [ -n "$sub" ] || continue

  kind=release
  if [ "$sub" = edit ]; then
    adds=$(hook_gh_flag_values "$clause" --add-label)
    removes=$(hook_gh_flag_values "$clause" --remove-label)
    if has_label "$adds" status:building; then
      kind=claim
    elif ! has_label "$removes" status:building && ! has_label "$adds" status:qa \
      && ! has_label "$adds" status:complete; then
      continue
    fi
  fi

  place "$clause" || continue
  if [ "$kind" = claim ]; then
    # shellcheck disable=SC2046  # the numbers, space-separated; globbing is off
    claim $(hook_gh_issue_numbers "$detect" edit)
  else
    release
  fi
done <<EOF
$clauses_text
EOF

if [ ${#notes[@]} -gt 0 ]; then
  hook_pretool_notice "workflow:snapshot: ${notes[*]}" PostToolUse
fi
exit 0
