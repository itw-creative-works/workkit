#!/bin/bash
# safety/release-taken: PreToolUse hook (Bash)
# A release whose version a provider ALREADY has is found before the release
# commit and the tag exist, not when `npm publish` fails on top of them, by
# which time the fix is a second release rather than a different number.
#
# Two triggers, and nothing else reaches the providers:
#   1. The release commit: a real `git ... commit` (the house finder in
#      hooks/_lib.sh, so a quoted mention and a heredoc body are data) whose
#      command text carries the subject `chore(release): <x.y.z>`, the same
#      subject safety/commit-language is the one hook that accepts a version
#      in. That version is the release's.
#   2. `npm publish`, in any spelling of it (`--access public`, `--workspaces`),
#      found by the same clause walk on the stripped text.
#
# The project is the package.json at the git toplevel for a commit, and the one
# at the cwd for a publish, which is where npm publishes from. A `workspaces`
# declaration (the array, or the object's `packages`) makes every member part of
# it too, expanded for the two shapes that carry meaning: a literal directory
# and a `dir/*`. Any other glob shape is named on stderr and skipped, never
# guessed at.
#
# Who is asked what:
#   commit  -> npm for every package with publish intent, each at ITS OWN
#              package.json version (the ship bumps every file before the
#              release commit), and github-release ONCE for the repo at the
#              subject's version (the ship tags `v<version>`).
#   publish -> npm only, the same package set. The GitHub release legitimately
#              precedes the publish in the ship pipeline.
# Publish intent is the ship skill's Step 5 rule and lives there: `private` is
# not true AND there is a `files` or a `publishConfig`.
#
# Providers are the sibling scripts under providers/, one contract
# (`providers/<name> <package-name> <version>`, exit 1 = taken, exit 0 = free
# or cannot tell), so a third one is a file rather than an edit here. They run
# CONCURRENTLY: a family of ten packages costs one round trip, not ten.
#
# Fail open on this hook's own errors (no jq, unreadable input, a package.json
# jq cannot parse, a provider that exits some other way), and out loud for
# anything that means a check did not happen. A guard that stands aside in
# silence is how a session's checks disappear unnoticed.

set -euo pipefail
set -f  # no glob expansion while handling untrusted command text

input=$(cat) || input=""

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cmd" ] || exit 0

# The cheap literal gate: this hook sits on every Bash command, and one that
# spells neither the release subject nor a publish can never be either trigger.
# A commit carrying a message FILE is the third way in: its subject is
# unreadable from here, and saying so is the point (see the stand-down below).
case "$cmd" in
  *'chore(release)'*|*publish*) ;;
  *commit*)
    case "$cmd" in
      *-F*|*--file*) ;;
      *) exit 0 ;;
    esac
    ;;
  *) exit 0 ;;
esac

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" 2>/dev/null || true)
[ -n "$cwd" ] || cwd="$PWD"

# rt_has_npm_publish <stripped text>: does a clause RUN `npm publish`? The
# clause walk and the prefixes it peels are the finder's in hooks/_lib.sh; only
# the command word and the first non-option argument are this hook's question.
rt_has_npm_publish() {
  local clause sub w dry
  while IFS= read -r clause; do
    # shellcheck disable=SC2086  # word splitting is intentional; quotes are stripped
    set -- $clause
    while [ $# -gt 0 ]; do
      case "$1" in
        \(|\{) shift ;;
        \(*) w="${1#\(}"; shift; set -- "$w" "$@" ;;
        command|env) shift ;;
        [A-Za-z_]*=*) shift ;;
        *) break ;;
      esac
    done
    case "${1:-}" in
      npm|*/npm) shift ;;
      *) continue ;;
    esac
    # The whole clause is walked, not just up to the first word: `--dry-run`
    # (and its explicit `=true`) publishes nothing and is the diagnostic
    # someone reaches for, so it is not a publish. `--dry-run=false` is.
    sub=""
    dry=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --dry-run|--dry-run=true) dry=1; shift ;;
        -*) shift ;;
        *) if [ -z "$sub" ]; then sub="$1"; fi; shift ;;
      esac
    done
    if [ "$sub" = "publish" ] && [ "$dry" -eq 0 ]; then return 0; fi
  done <<EOF
$(printf '%s' "$1" | tr ';|&' '\n')
EOF
  return 1
}

# --- Which trigger, and at what version? ---
trigger=""
version=""
stripped=$(hook_strip_quotes "$(hook_strip_heredocs "$cmd")")
hook_find_git_commit "$cmd"
if [ -n "$HOOK_COMMIT_CLAUSE" ] || [ "$HOOK_WRAPPED_COMMIT" -eq 1 ]; then
  # The subject is read off the ORIGINAL text (the strip that proves this is a
  # commit is also what replaces the message with a placeholder), and only where
  # a SUBJECT can sit: right after a message flag, or opening a line, which is
  # where the `-m "$(cat <<'EOF'` idiom puts it. The release version itself is
  # HOOK_VERSION_RE in hooks/_lib.sh, shared with safety/commit-language, the
  # one hook that lets a subject name a version at all.
  subject_re='chore\(release\): '"$HOOK_VERSION_RE"
  match=$(printf '%s' "$cmd" \
    | grep -Eo "(^|[[:space:]])(-m|--message)[[:space:]=]*[\"']?${subject_re}|^[[:space:]]*[\"']?${subject_re}" \
    | head -n 1 || true)
  version=${match##*: }
  version=${version#v}
  if [ -n "$version" ]; then
    trigger="commit"
  elif printf '%s' "$stripped" | grep -Eq '(^|[[:space:]])(-[A-Za-z]*F|--file)([[:space:]=]|$)'; then
    # The message lives in a file this hook never opens, so there is no subject
    # to read. Silence here would look exactly like a commit that is no release.
    printf 'release-taken: the commit message is in a file, so the release subject could not be read and the check stood down.\n' >&2
    exit 0
  fi
fi
if [ -z "$trigger" ]; then
  if rt_has_npm_publish "$stripped"; then
    trigger="publish"
  fi
fi
[ -n "$trigger" ] || exit 0

# A publish behind a directory change addresses a package this hook cannot
# place: the cwd it was handed is not where npm would run. HOOK_SAW_CD is the
# finder's reading of exactly that (`cd`, `pushd`, `popd`).
if [ "$trigger" = "publish" ] && [ "$HOOK_SAW_CD" -eq 1 ]; then
  printf 'release-taken: the command changes directory, so the package being published could not be placed and the check stood down.\n' >&2
  exit 0
fi

# --- The project ---
if [ "$trigger" = "commit" ]; then
  root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root=""
  [ -n "$root" ] || exit 0
else
  root="$cwd"
fi

# The repo the github-release bounce names, off the origin and no network. The
# rule is the engine's one rule (`wk_repo_slug`, workflow/slug.sh, sourced by
# _lib.sh): every spelling git writes a remote in, and a local path in either
# separator. Left empty rather than guessed at, and the clause rides only when
# it is known.
slug=""
if [ "$trigger" = "commit" ]; then
  slug=$(wk_repo_slug "$root")
fi

# --- The package set: the project's package.json, plus its workspaces ---
pkgs=""
if [ -f "$root/package.json" ]; then
  pkgs="$root/package.json"
  patterns=$(hook_jq -r '
    if (.workspaces | type) == "array" then .workspaces[]
    elif (.workspaces | type) == "object" then (.workspaces.packages // [])[]
    else empty end' "$root/package.json" 2>/dev/null) || patterns=""
  while IFS= read -r pattern; do
    [ -n "$pattern" ] || continue
    case "$pattern" in
      */\*)
        # Every DIRECT subdirectory of the named directory that holds a
        # package.json. `find` rather than a glob, so the walk never depends on
        # the glob setting this hook deliberately turns off.
        members=$(find "$root/${pattern%/*}" -mindepth 2 -maxdepth 2 -name package.json -type f 2>/dev/null || true)
        if [ -n "$members" ]; then
          pkgs="$pkgs
$members"
        else
          printf 'release-taken: the workspace pattern %s matched no package, so nothing under it was checked.\n' "$pattern" >&2
        fi
        ;;
      *[\*\?\[]*)
        printf 'release-taken: the workspace pattern %s was not expanded, so its packages were not checked.\n' "$pattern" >&2
        ;;
      *)
        if [ -f "$root/$pattern/package.json" ]; then
          pkgs="$pkgs
$root/$pattern/package.json"
        else
          printf 'release-taken: the workspace member %s holds no package.json, so it was not checked.\n' "$pattern" >&2
        fi
        ;;
    esac
  done <<EOF
$patterns
EOF
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/release-taken.XXXXXX") || exit 0
trap 'rm -rf "$tmp"' EXIT

# --- The checks: one job file each, so every provider call is one line ---
jobs=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  meta=$(hook_jq -r '
    (.name // ""),
    (.version // ""),
    (if .private == true then "yes" else "no" end),
    (if (.files != null) or (.publishConfig != null) then "yes" else "no" end)' "$file" 2>/dev/null) || meta=""
  if [ -z "$meta" ]; then
    printf 'release-taken: %s could not be read as JSON, so that package was not checked.\n' "$file" >&2
    continue
  fi
  p_name=$(printf '%s\n' "$meta" | sed -n 1p)
  p_version=$(printf '%s\n' "$meta" | sed -n 2p)
  p_private=$(printf '%s\n' "$meta" | sed -n 3p)
  p_signal=$(printf '%s\n' "$meta" | sed -n 4p)
  # Publish intent (skills/ship/SKILL.md, Step 5): a private package, or one
  # that never opted into npm, is never asked about there.
  if [ "$p_private" = "yes" ] || [ "$p_signal" = "no" ]; then continue; fi
  if [ -z "$p_name" ] || [ -z "$p_version" ]; then continue; fi
  jobs=$((jobs + 1))
  printf '%s\n%s\n%s\n' npm "$p_name" "$p_version" > "$tmp/$jobs.job"
done <<EOF
$pkgs
EOF

if [ "$trigger" = "commit" ]; then
  jobs=$((jobs + 1))
  printf '%s\n%s\n%s\n' github-release "${slug:-repo}" "$version" > "$tmp/$jobs.job"
fi

[ "$jobs" -gt 0 ] || exit 0

# --- Ask every provider at once ---
i=0
while [ "$i" -lt "$jobs" ]; do
  i=$((i + 1))
  (
    job="$tmp/$i.job"
    provider=$(sed -n 1p "$job")
    ask_name=$(sed -n 2p "$job")
    ask_version=$(sed -n 3p "$job")
    rc=0
    # The providers run from the project root, which is the repo `gh` reads.
    # A cd that fails exits 9, so it can never be read as the provider's
    # "taken" (exit 1).
    ( cd "$root" >/dev/null 2>&1 || exit 9
      exec "$HERE/providers/$provider" "$ask_name" "$ask_version" >/dev/null ) || rc=$?
    case "$rc" in
      0) ;;
      1) printf '%s\n%s\n%s\n' "$provider" "$ask_name" "$ask_version" > "$tmp/$i.taken" ;;
      *) printf 'release-taken: the %s provider exited %s, so the check stood down for %s.\n' \
           "$provider" "$rc" "$ask_name" >&2 ;;
    esac
    exit 0
  ) &
done
wait || true

# --- The verdict ---
taken=""
i=0
while [ "$i" -lt "$jobs" ]; do
  i=$((i + 1))
  [ -f "$tmp/$i.taken" ] || continue
  provider=$(sed -n 1p "$tmp/$i.taken")
  hit_name=$(sed -n 2p "$tmp/$i.taken")
  hit_version=$(sed -n 3p "$tmp/$i.taken")
  case "$provider" in
    github-release) line="github-release already has v${hit_version}${slug:+ at $slug}" ;;
    *) line="${provider} already has ${hit_name}@${hit_version}" ;;
  esac
  taken="$taken$line
"
done

[ -n "$taken" ] || exit 0

what="this release commit"
if [ "$trigger" = "publish" ]; then what="this npm publish"; fi
{
  printf '%s' "$taken" | while IFS= read -r hit; do
    printf 'release-taken: BLOCKED %s: %s\n' "$what" "$hit"
  done
  printf 'Bump to a version no provider has yet, then release again. The loader kill switch HOOK_DISABLE=1 on this hook is the deliberate override, the owner alone reaches for it.\n'
} >&2
exit 2
