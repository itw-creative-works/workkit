#!/usr/bin/env bash
# safety:test-reminder: PostToolUse hook (Edit|Write). Asks once per file per
# session whether a written code file that no test names needs a test; the
# answer is the agent's, and a "no" goes in the Proof: line. Always exits 0.
# What names a file, and the marker: docs/hooks.md § safety:test-reminder.

set -euo pipefail

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

input="$(cat)" || input=""
command -v jq >/dev/null 2>&1 || exit 0

file_path=$(hook_jq -r '.tool_input.file_path // ""' <<<"$input" 2>/dev/null || true)
session_id=$(hook_jq -r '.session_id // ""' <<<"$input" 2>/dev/null || true)
cwd=$(hook_jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || cwd="$PWD"

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
# The file's own repo, read by git from its folder, so a symlinked or
# differently spelled path still compares in git's one spelling.
file_dir="${file_path%/*}"
file_root=$(git -C "$file_dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ "$file_root" = "$root" ] || exit 0
prefix=$(git -C "$file_dir" rev-parse --show-prefix 2>/dev/null) || exit 0
base="${file_path##*/}"
rel="$prefix$base"

hook_is_code_path "$rel" || exit 0

candidates=()
same_base=0
while IFS= read -r path; do
  [ -n "$path" ] || continue
  case "$path" in "$base"|*/"$base") same_base=$((same_base + 1)) ;; esac
  if hook_is_test_path "$path"; then candidates+=("$path"); fi
done < <(git -C "$root" -c core.quotePath=false ls-files --cached --others --exclude-standard 2>/dev/null || true)

# The key is the basename when one repo file carries it, else <parent>/<base>,
# so a test naming a/run.sh never answers for b/run.sh; a root file keeps it.
key="$base"
if [ "$same_base" -ne 1 ] && [ "$rel" != "$base" ]; then
  key="${prefix%/}"; key="${key##*/}/$base"
fi

if [ "${#candidates[@]}" -gt 0 ]; then
  stem_re=$(printf '%s' "${base%.*}" | sed 's/[][\.*^$+?(){}|]/\\&/g')
  hit=$(cd "$root" && printf '%s\0' "${candidates[@]}" | xargs -0 grep -lswF -e "$key" -- 2>/dev/null | head -n 1) || true
  if [ -z "$hit" ]; then
    hit=$(cd "$root" && printf '%s\0' "${candidates[@]}" | xargs -0 grep -lsE -e "/${stem_re}[\"']" -- 2>/dev/null | head -n 1) || true
  fi
  [ -z "$hit" ] || exit 0
fi

if [ -n "$session_id" ]; then
  marker=$(hook_session_marker workkit-test-reminder "$session_id")
  marker_dir="${marker%/*}"
  if [ -f "$marker" ] && grep -qxF -- "$root/$rel" "$marker" 2>/dev/null; then
    exit 0
  fi
  mkdir -p "$marker_dir" 2>/dev/null || true
  printf '%s\n' "$root/$rel" >>"$marker" 2>/dev/null || true
fi

hook_jq -n --arg ctx "$rel has no test naming it. Does this change need one? If not, say why in the Proof: line." '{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": $ctx
  }
}' || true
exit 0
