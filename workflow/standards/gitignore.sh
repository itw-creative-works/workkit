#!/usr/bin/env bash
# workflow/standards/gitignore.sh: the heals that touch .gitignore and the
# local working files: `.workkit/` untracked except the committed
# settings.json, the basics every repo needs (the list is the entry's
# GITIGNORE_BASICS), and the session files seeded from their templates.
# SOURCED by standards.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing.

# ── 1. .workkit/ stays untracked, except the committed settings.json ──
# settings.json is never created by a HEAL, only by --enable. Opting a repo in is
# a deliberate act by a human or an agent asked to do it, never a side effect.
#
# Correctness here is an OUTCOME, not a string in a file: session state must be
# ignored AND settings.json must stay trackable. Grepping for the block misses
# the two ways a repo ends up broken: a .gitignore holding the DIRECTORY form
# `.workkit/` (git never descends into an excluded directory, so no later
# negation can re-include settings.json) and one holding `.workkit/*` with no
# negation line. Both are checked with git check-ignore instead.
# Append a commented block to .gitignore, keeping the file's shape. A file
# without a trailing newline would swallow the appended line, and a file with
# content gets one blank line of separation. A missing or empty .gitignore gets
# neither: it must not start with a blank line. Shared by the two heals below.
append_gitignore_block() {
  local file=".gitignore" comment="$1" lines="$2"

  if [[ -s "$file" ]]; then
    if [[ -n "$(tail -c 1 "$file")" ]]; then
      printf '\n' >>"$file"
    fi
    printf '\n' >>"$file"
  fi
  printf '# %s\n%s' "$comment" "$lines" >>"$file"
}

ensure_workflow_ignored() {
  local file=".gitignore" lines="" offender

  if git check-ignore -q -- "$WORKKIT_DIR/capture.md" 2>/dev/null \
    && ! git check-ignore -q -- "$REPO_SETTINGS" 2>/dev/null; then
    wk_skip "gitignore: $WORKKIT_DIR/ already ignored"
    return 0
  fi

  # Append only the lines that are missing, so a re-run never duplicates them.
  if ! grep -qxF "$WORKKIT_DIR/*" "$file" 2>/dev/null; then
    lines="${lines}${WORKKIT_DIR}/*"$'\n'
  fi
  if ! grep -qxF "!$REPO_SETTINGS" "$file" 2>/dev/null; then
    lines="${lines}!${REPO_SETTINGS}"$'\n'
  fi

  if [[ -n "$lines" ]]; then
    append_gitignore_block "Workflow state (workflow spec): only settings.json is committed" "$lines"
    wk_ok "gitignore: added $WORKKIT_DIR/"
  fi

  # Re-verify by outcome. Still ignored means some OTHER pattern wins, and this
  # function cannot repair it: say which line, and do not report success.
  if git check-ignore -q -- "$REPO_SETTINGS" 2>/dev/null; then
    offender="$(git check-ignore -v -- "$REPO_SETTINGS" 2>/dev/null | head -n 1)"
    wk_warn "gitignore: $REPO_SETTINGS is STILL ignored by [$offender]; remove or repair that pattern so the opt-in file can be committed"
    needs_attention=1
  fi
}

# Does .gitignore already cover ENTRY? Exact, or one of the glob spellings that
# plainly contains it. Deliberately not a glob engine: the answer only decides
# whether one more line is appended, so a spelling this misses costs a
# redundant-looking line and never a wrong ignore. A negation (`!`) is not
# coverage, and a comment is not a line.
gitignore_covers() {
  local entry="$1" file=".gitignore" line
  [[ -f "$file" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in
      ''|\#*|!*) continue ;;
      "$entry"|"$entry"/) return 0 ;;                       # .env      .env/
      "$entry"'*'|'/'"$entry"|'/'"$entry"'*') return 0 ;;   # .env*     /.env
      '*'"$entry"|'**/'"$entry"|'**/'"$entry"'*') return 0 ;;  # *.env  **/.env
    esac
  done <"$file"
  return 1
}

ensure_gitignore_basics() {
  local entry lines="" added=""

  for entry in $GITIGNORE_BASICS; do
    gitignore_covers "$entry" && continue
    lines="${lines}${entry}"$'\n'
    added="$added $entry"
  done

  if [[ -z "$lines" ]]; then
    wk_skip "gitignore: $GITIGNORE_BASICS already ignored"
    return 0
  fi

  append_gitignore_block "Editor and environment files, ignored everywhere" "$lines"
  wk_ok "gitignore: added${added}"
}

# ── 1b. The local working files exist, ready for use ──
# Both are gitignored per the pattern above, so creating them is free; having
# them already on disk is what makes jotting a note or tracking the session
# zero-friction. A file with content is NEVER overwritten.
#
# The template's name and the file's place in `.workkit/` are two different
# things: the agents' own state lives under `agents/`, so a second argument
# gives the destination when it is not the template's own name.
ensure_local_file() {
  local name="$1" dest="${2:-$1}" label="${1%.md}"
  local file="$WORKKIT_DIR/$dest"

  # -s, not -f: the promise is "never overwritten once it has CONTENT", so an
  # empty or truncated file gets its sections back instead of staying blank.
  if [[ -s "$file" ]]; then
    wk_skip "$label: $file already exists"
    return 0
  fi

  # A missing template is a broken install, not a reason to abandon the rest of
  # the heal: under `set -e` a bare cp here ended the run before forms and
  # labels, and the hook still reported success (review finding, 2026-07-24).
  if [[ ! -f "$TEMPLATES_DIR/$name" ]]; then
    wk_warn "$label: template missing at $TEMPLATES_DIR/$name; reinstall the workflow core"
    needs_attention=1
    return 0
  fi

  mkdir -p "$(dirname "$file")"
  cp "$TEMPLATES_DIR/$name" "$file"
  wk_ok "$label: created $file"
}
