#!/bin/bash
# safety/inbox-guard — PreToolUse hook (Read|Grep|Bash)
# `.workkit/inbox.md` is the owner's scratchpad: its CONTENTS are read during a
# TRIAGE RUN and at no other time. Counting the entries, appending to it, and
# seeing that it is non-empty all stay free — this guard blocks only the reads
# that take the contents in.
#
# The sanctioned path leaves a marker: the workkit:triage skill touches
# ${TMPDIR:-/tmp}/claude-triage-marker/<sha of the anchor> before it reads
# anything, the same recipe the workkit:review skill uses for the commit gate.
# The ANCHOR is the inbox's repo root, or — outside a repo, which is where the
# user-level ~/.workkit/inbox.md lives — the .workkit directory's own parent.
# A marker newer than 30 minutes means a triage run is under way and every read
# is allowed; a missing or older one blocks.
#
# Scope:
#   Read — .tool_input.file_path ending in .workkit/inbox.md
#   Grep — .tool_input.path pointing AT that file or the directory holding it
#          (when the inbox exists there and any glob can name it), or a
#          .tool_input.glob naming the inbox. A broad repo-wide
#          search stays open.
#   Bash — .tool_input.command naming that path AND running a content-reading
#          command (cat, head, tail, less, more, grep, sed, awk, bat). An
#          append (`wk.sh note`, `>>`) or a count (`wc -l`) is not one.
# Fail open on the hook's OWN errors (no jq, no readable marker mtime or clock,
# no anchor to key on at all) — a broken guard must never wedge the session.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

tool=$(jq -r '.tool_name // ""' <<<"$input" || true)
cwd=$(jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# The path the inbox lives at, spelled out: this guard sources _lib.sh only for
# hook_file_mtime, and the directory name's SSOT is WORKKIT_DIR there — change
# both together.
INBOX_SUFFIX=".workkit/inbox.md"
INBOX_DIR="${INBOX_SUFFIX%/*}"
INBOX_FILE="${INBOX_SUFFIX##*/}"
MARKER_MAX_AGE=1800   # 30 minutes

# The inbox this call names, as the hook finds it in the payload.
inbox_path=""

case "$tool" in
  Read)
    file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" || true)
    [ -n "$file_path" ] || exit 0
    case "$file_path" in
      "$INBOX_SUFFIX"|*/"$INBOX_SUFFIX") ;;
      *) exit 0 ;;
    esac
    inbox_path="$file_path"
    ;;
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$input" || true)
    [ -n "$cmd" ] || exit 0
    case "$cmd" in
      *"$INBOX_SUFFIX"*) ;;
      *) exit 0 ;;
    esac
    # A content-reading command, as a WORD — `wc -l`, an `echo … >>`, and the
    # capture CLI all name the path without taking its contents in.
    printf '%s' "$cmd" \
      | grep -Eq '(^|[^[:alnum:]_./-])(cat|head|tail|less|more|grep|sed|awk|bat)([[:space:]]|$)' \
      || exit 0
    # The path as the command spells it, quotes and all stripped by the class.
    inbox_path=$(printf '%s' "$cmd" \
      | grep -Eo "[^[:space:]\"']*${INBOX_SUFFIX//./\\.}" | head -n 1 || true)
    [ -n "$inbox_path" ] || inbox_path="$cwd/$INBOX_SUFFIX"
    ;;
  Grep)
    grep_path=$(jq -r '.tool_input.path // ""' <<<"$input" || true)
    grep_glob=$(jq -r '.tool_input.glob // ""' <<<"$input" || true)
    # Only a search pointed AT the inbox is gated — the path names the file or
    # the directory holding it, or the glob names the inbox. A repo-wide
    # search whose results might happen to include the inbox stays open: this
    # guard never blocks the searching of a whole repo. Every Grep carries a
    # pattern, so unlike `wc -l` no mode of it is a mere count.
    while [ "${grep_path%/}" != "$grep_path" ]; do grep_path="${grep_path%/}"; done
    case "$grep_path" in
      "$INBOX_SUFFIX"|*/"$INBOX_SUFFIX") inbox_path="$grep_path" ;;
      "$INBOX_DIR"|*/"$INBOX_DIR")
        # A glob that cannot name the inbox narrows the search away from it —
        # a .workkit/ Grep for session.md or findings.md is ordinary session
        # work and stays open.
        case "$grep_glob" in
          ''|*inbox*) ;;
          *) exit 0 ;;
        esac
        inbox_path="$grep_path/$INBOX_FILE"
        grep_dir_probe=1
        ;;
      *)
        case "$grep_glob" in
          *inbox*) inbox_path="${grep_path:-$cwd}/$INBOX_SUFFIX" ;;
          *) exit 0 ;;
        esac
        ;;
    esac
    ;;
  *) exit 0 ;;
esac

# Absolute form, so the anchor below can be derived from the path itself. A
# relative path resolves against the session's directory, exactly as the tool
# would resolve it.
case "$inbox_path" in
  '~/'*)     inbox_path="$HOME/${inbox_path#\~/}" ;;
  '$HOME/'*) inbox_path="$HOME/${inbox_path#\$HOME/}" ;;
  /*) ;;
  *) inbox_path="$cwd/$inbox_path" ;;
esac

# A directory-pointed Grep can only reach the inbox if the file is actually
# there — an absent inbox has no contents to protect.
if [ "${grep_dir_probe:-0}" = 1 ] && [ ! -f "$inbox_path" ]; then
  exit 0
fi

# What the marker is keyed to: the inbox's own repo root, or — outside a repo —
# the .workkit directory's own parent, which for ~/.workkit/inbox.md is $HOME.
# The user-level inbox lives there, and $HOME is not a git repo, so without the
# fallback that inbox would be read with no marker check at all. The triage
# skill's recipe falls back the same way, so both sides name the same file.
inbox_parent="$(dirname "$(dirname "$inbox_path")")"
probe="$(dirname "$inbox_path")"
if [ ! -d "$probe" ]; then
  probe="$inbox_parent"
fi
anchor=$(git -C "$probe" rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$anchor" ] || anchor="$inbox_parent"
[ -n "$anchor" ] || exit 0

# The marker recipe, verbatim from the triage skill: the sha of the anchor with
# no trailing newline.
marker="${TMPDIR:-/tmp}/claude-triage-marker/$(printf '%s' "$anchor" | shasum | cut -d' ' -f1)"

if [ -f "$marker" ]; then
  . "$(dirname "${BASH_SOURCE[0]}")/../../_lib.sh"
  marker_ts=$(hook_file_mtime "$marker")
  now=$(date +%s 2>/dev/null || echo 0)
  # An unreadable mtime or clock leaves the age unknowable; the marker exists,
  # so allow — this guard fails open on its own errors.
  if [ "$marker_ts" -eq 0 ] || [ "$now" -eq 0 ]; then
    exit 0
  fi
  if [ "$((now - marker_ts))" -le "$MARKER_MAX_AGE" ]; then
    exit 0
  fi
fi

{
  echo "inbox-guard: BLOCKED reading $INBOX_SUFFIX — it is the owner's scratchpad, and its contents are read only during a triage run."
  echo "Run the workkit:triage skill, which records the marker this guard checks, and read it there. Counting the entries (wc -l) and appending to it stay open."
} >&2
exit 2
