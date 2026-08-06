#!/bin/bash
# safety/capture-guard — PreToolUse hook (Read|Grep|Bash|Edit|Write)
# `.workkit/capture.md` is the owner's capture surface. The agent's ONE sanctioned
# touch is the TRIAGE DRAIN: during a triage run the contents are read and the
# entries that landed somewhere are deleted. Outside that run the file is
# neither read nor rewritten, and ADDING to it is never the agent's at all —
# capture is the owner's (owner ruling, 2026-08-05: clear it on triage, never
# add to it). Seeing that it is non-empty and counting the entries stay free.
#
# The sanctioned path leaves a marker: the workkit:triage skill touches
# ${TMPDIR:-/tmp}/claude-triage-marker/<sha of the anchor> before it reads
# anything, the same recipe the workkit:review skill uses for the commit gate.
# The ANCHOR is the capture file's repo root — every capture file belongs to a
# participating repo, since there is none outside one — or, for a capture file
# in no repo at all, the .workkit directory's own parent.
# A marker newer than 30 minutes means a triage run is under way and every read
# and every rewrite is allowed; a missing or older one blocks.
#
# Scope:
#   Read — .tool_input.file_path ending in .workkit/capture.md
#   Edit/Write — the same path: the drain rewriting the file, marker-gated
#   Grep — .tool_input.path pointing AT that file or the directory holding it
#          (when the capture file exists there and any glob can name it), or a
#          .tool_input.glob naming the capture file. A broad repo-wide
#          search stays open.
#   Bash — .tool_input.command running, against that path, either a
#          content-reading command (cat, head, tail, less, more, grep, sed,
#          awk, bat) or a rewrite (`>`, plain `tee`, `sed -i`, `perl -i`) —
#          both marker-gated — or an APPEND (`>>`, `tee -a`) or the capture CLI
#          in command position (`wk.sh note`, `workkit note`, which name no
#          path at all), which no marker opens. A count (`wc -l`) and a bare
#          mention are neither.
# This is a SUBSTRING TRIPWIRE, not a sandbox: an interpreter-level write
# (`python3 -c "open(...,'a')"`, `dd of=…`) and a case-folded path go through
# untouched, deliberately — the guard exists to stop the honest reach, and
# chasing the dishonest one would cost every legitimate command around it.
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

# The path the capture file lives at, spelled out: this guard sources _lib.sh only for
# hook_file_mtime, and the directory name's SSOT is WORKKIT_DIR there — change
# both together.
CAPTURE_SUFFIX=".workkit/capture.md"
CAPTURE_DIR="${CAPTURE_SUFFIX%/*}"
CAPTURE_FILE="${CAPTURE_SUFFIX##*/}"
MARKER_MAX_AGE=1800   # 30 minutes

# The capture file this call names, as the hook finds it in the payload, and what the
# call would do to it — `read` or `write`, which decides the message.
capture_path=""
mode="read"

block_write() {
  {
    echo "capture-guard: BLOCKED writing $CAPTURE_SUFFIX — it is the owner's capture surface, and the agent never adds to it."
    echo "Its entries are cleared only by the triage drain: run the workkit:triage skill, which records the marker this guard checks. File a finding as a status:inbox issue with gh instead; where GitHub cannot be reached, put it in chat and let the owner decide."
  } >&2
  exit 2
}

# The marker-gated half of the same refusal: this call would REWRITE the file,
# which is the drain's own act and nobody else's — so the message names that,
# not the append rule.
block_rewrite() {
  {
    echo "capture-guard: BLOCKED rewriting $CAPTURE_SUFFIX — its entries are cleared only by the triage drain, and no drain is running."
    echo "Run the workkit:triage skill, which records the marker this guard checks, and clear it there. Adding entries is never the agent's at all: file a finding as a status:inbox issue with gh instead."
  } >&2
  exit 2
}

case "$tool" in
  Read)
    file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" || true)
    [ -n "$file_path" ] || exit 0
    case "$file_path" in
      "$CAPTURE_SUFFIX"|*/"$CAPTURE_SUFFIX") ;;
      *) exit 0 ;;
    esac
    capture_path="$file_path"
    ;;
  Edit|Write)
    file_path=$(jq -r '.tool_input.file_path // ""' <<<"$input" || true)
    [ -n "$file_path" ] || exit 0
    case "$file_path" in
      "$CAPTURE_SUFFIX"|*/"$CAPTURE_SUFFIX") ;;
      *) exit 0 ;;
    esac
    capture_path="$file_path"
    mode="write"
    ;;
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$input" || true)
    [ -n "$cmd" ] || exit 0
    # The capture CLI writes to the nearest capture file without ever naming it, so it
    # is caught ahead of the path filter every other shape passes through — but
    # only where it is RUN: at the start of the command, after a separator, or
    # through a path or interpreter prefix at either. Prose about the CLI in an
    # issue body, and a search for it, write nothing.
    if printf '%s' "$cmd" | grep -Eq \
      '(^|[;&|`]|\$\()[[:space:]]*((bash|sh|zsh)[[:space:]]+)?([^[:space:]]*/)?(wk|workkit)(\.sh)?[[:space:]]+note([[:space:]]|$)'; then
      block_write
    fi
    # A candidate when BOTH halves of the path are in the command, together or
    # apart: `cd .workkit && cat capture.md` is the same file by another
    # spelling. A capture.md with no .workkit anywhere is somebody else's.
    case "$cmd" in *"$CAPTURE_DIR"*) ;; *) exit 0 ;; esac
    case "$cmd" in *"$CAPTURE_FILE"*) ;; *) exit 0 ;; esac
    # The path as a regex, so a TARGET can be told from a mention: a command
    # writing elsewhere while naming the capture file is not a write to it. The
    # directory prefix is optional, since the filter above already demanded the
    # .workkit anchor somewhere in the command.
    redirect_target="[[:space:]]*[\"']?([^[:space:]\"'<>|;&]*/)?${CAPTURE_FILE//./\\.}"
    # The rest of one SIMPLE COMMAND, so a keyword below can be anchored to the
    # capture file as its own argument: `tee -a other.log` in a pipeline that
    # merely names it appends to neither.
    same_cmd="[^|;&]*"
    # An append, which no marker opens, however it is spelled: `>>path`,
    # `>> path`, `>>"path"`, or the `tee -a` that is the same act by hand.
    if printf '%s' "$cmd" | grep -Eq ">>${redirect_target}" \
      || printf '%s' "$cmd" | grep -Eq \
        "(^|[^[:alnum:]_./-])tee[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(--append|-[[:alnum:]]*a)${same_cmd}${redirect_target}"; then
      block_write
    fi
    # A rewrite, marker-gated like a read: a single `>` onto the capture file (the
    # appends are blanked out first, since ERE cannot look behind), plain `tee`
    # writing it, or an in-place editor run over it.
    if printf '%s' "$cmd" | sed 's/>>/@@/g' | grep -Eq ">${redirect_target}" \
      || printf '%s' "$cmd" | grep -Eq \
        "(^|[^[:alnum:]_./-])tee([[:space:]]|\$)${same_cmd}${redirect_target}" \
      || printf '%s' "$cmd" | grep -Eq \
        "(^|[^[:alnum:]_./-])(sed|perl)[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(--in-place|-[[:alnum:]]*i)${same_cmd}${redirect_target}"; then
      mode="write"
    # A content-reading command, as a WORD taking the capture file as its own
    # argument — `wc -l` and a bare mention name the path without taking its
    # contents in, and so does a reader pointed at another file. Checked after
    # the rewrites, so an in-place `sed -i` is judged as the write it is.
    elif ! printf '%s' "$cmd" | grep -Eq \
      "(^|[^[:alnum:]_./-])(cat|head|tail|less|more|grep|sed|awk|bat)([[:space:]]|\$)${same_cmd}${redirect_target}"; then
      exit 0
    fi
    # The path as the command spells it, quotes and all stripped by the class.
    capture_path=$(printf '%s' "$cmd" \
      | grep -Eo "[^[:space:]\"']*${CAPTURE_SUFFIX//./\\.}" | head -n 1 || true)
    [ -n "$capture_path" ] || capture_path="$cwd/$CAPTURE_SUFFIX"
    ;;
  Grep)
    grep_path=$(jq -r '.tool_input.path // ""' <<<"$input" || true)
    grep_glob=$(jq -r '.tool_input.glob // ""' <<<"$input" || true)
    # Only a search pointed AT the capture file is gated — the path names the
    # file or the directory holding it, or the glob names it. A repo-wide
    # search whose results might happen to include it stays open: this
    # guard never blocks the searching of a whole repo. Every Grep carries a
    # pattern, so unlike `wc -l` no mode of it is a mere count.
    while [ "${grep_path%/}" != "$grep_path" ]; do grep_path="${grep_path%/}"; done
    case "$grep_path" in
      "$CAPTURE_SUFFIX"|*/"$CAPTURE_SUFFIX") capture_path="$grep_path" ;;
      "$CAPTURE_DIR"|*/"$CAPTURE_DIR")
        # A glob that cannot name the capture file narrows the search away from
        # it — a .workkit/ Grep for the agents' own state is ordinary session
        # work and stays open.
        case "$grep_glob" in
          ''|*capture*) ;;
          *) exit 0 ;;
        esac
        capture_path="$grep_path/$CAPTURE_FILE"
        grep_dir_probe=1
        ;;
      *)
        case "$grep_glob" in
          *capture*) capture_path="${grep_path:-$cwd}/$CAPTURE_SUFFIX" ;;
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
case "$capture_path" in
  '~/'*)       capture_path="$HOME/${capture_path#\~/}" ;;
  '$HOME/'*)   capture_path="$HOME/${capture_path#\$HOME/}" ;;
  '${HOME}/'*) capture_path="$HOME/${capture_path#\$\{HOME\}/}" ;;
  /*) ;;
  *) capture_path="$cwd/$capture_path" ;;
esac

# A directory-pointed Grep can only reach the capture file if it is actually
# there — an absent capture file has no contents to protect.
if [ "${grep_dir_probe:-0}" = 1 ] && [ ! -f "$capture_path" ]; then
  exit 0
fi

# What the marker is keyed to: the capture file's own repo root — a
# participating repo's, which is the only place one exists — or, for a capture
# file in no repo at all, the .workkit directory's own parent. Without that
# fallback such a file would be read with no marker check at all. The triage
# skill's recipe falls back the same way, so both sides name the same file.
capture_parent="$(dirname "$(dirname "$capture_path")")"
probe="$(dirname "$capture_path")"
if [ ! -d "$probe" ]; then
  probe="$capture_parent"
fi
anchor=$(git -C "$probe" rev-parse --show-toplevel 2>/dev/null || true)
[ -n "$anchor" ] || anchor="$capture_parent"
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

[ "$mode" = "read" ] || block_rewrite

{
  echo "capture-guard: BLOCKED reading $CAPTURE_SUFFIX — it is the owner's capture surface, and its contents are read only during a triage run."
  echo "Run the workkit:triage skill, which records the marker this guard checks, and read it there. Counting the entries (wc -l) stays open."
} >&2
exit 2
