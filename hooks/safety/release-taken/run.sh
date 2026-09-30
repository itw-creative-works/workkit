#!/bin/bash
# safety/release-taken: PreToolUse hook (Bash). Bounces the release commit
# (`chore(release): <x.y.z>`) and `npm publish` whose version a provider already
# has, while the number is still free to change. Providers under providers/
# share one contract and run concurrently. Fails open on its own errors and out
# loud for a check that did not happen. Triggers, package set: README.md.

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

# rt_has_npm_publish <stripped text>: does a clause RUN `npm publish`? Every
# clause is walked: the named workspaces land in RT_WORKSPACES, one a line, and a
# publishing clause naming none empties it. RT_WS_UNREADABLE says why a named
# value cannot be matched: `empty` or `quoted`.
RT_WORKSPACES=""
RT_WS_UNREADABLE=""
rt_has_npm_publish() {
  local clause sub n dry ws flagged value found=1 all=0
  while IFS= read -r clause; do
    # shellcheck disable=SC2086  # word splitting is intentional; quotes are stripped
    set -- $clause
    # The shared peel skips the prefixes and redirects ahead of the command word.
    hook_peel_prefixes "$@"
    case "$HOOK_PEEL_WORD" in
      npm|*/npm) shift "$((HOOK_PEEL_SKIP + 1))" ;;
      *) continue ;;
    esac
    # The whole clause is walked: `--dry-run` (or `=true`) publishes nothing, and
    # `--dry-run=false` does. A workspace flag's value goes with it, so
    # `npm -w x publish` still finds `publish` as the subcommand.
    sub=""
    dry=0
    ws=""
    flagged=0
    while [ $# -gt 0 ]; do
      case "$1" in
        --dry-run|--dry-run=true) dry=1; shift ;;
        --workspace=*|-w=*) flagged=1; ws="$ws${1#*=}
"; shift ;;
        --workspace|-w)
          flagged=1
          shift
          # A redirect between the flag and its value is syntax, never the name.
          while [ $# -gt 0 ]; do
            n=$(hook_redirect_span "$1")
            [ "$n" -gt 0 ] || break
            [ "$n" -le $# ] || n=$#
            shift "$n"
          done
          if [ $# -ge 1 ]; then ws="$ws$1
"; shift; else ws="$ws
"; fi ;;
        -*) shift ;;
        # A redirect is shell syntax, never the subcommand: a bare operator
        # hands its target to the next word, an attached one carries it.
        *'>'*|*'<'*)
          n=$(hook_redirect_span "$1")
          [ "$n" -gt 0 ] || { [ -n "$sub" ] || sub="$1"; n=1; }
          [ "$n" -le $# ] || n=$#
          shift "$n" ;;
        *) if [ -z "$sub" ]; then sub="$1"; fi; shift ;;
      esac
    done
    [ "$sub" = "publish" ] && [ "$dry" -eq 0 ] || continue
    found=0
    if [ "$flagged" -eq 0 ]; then all=1; continue; fi
    RT_WORKSPACES="$RT_WORKSPACES$ws"
    # Every value ends in its own newline; the here-string adds the last one.
    while IFS= read -r value; do
      case "$value" in
        '') RT_WS_UNREADABLE="empty" ;;
        *_hookq_*) RT_WS_UNREADABLE="quoted" ;;
      esac
    done <<<"${ws%?}"
  done <<EOF
$(hook_fold_redirect_amp "$1" | tr ';|&' '\n')
EOF
  if [ "$all" -eq 1 ]; then
    RT_WORKSPACES=""
    RT_WS_UNREADABLE=""
  fi
  return "$found"
}

# --- Which trigger, and at what version? ---
trigger=""
version=""
stripped=$(hook_strip_quotes "$(hook_strip_heredocs "$cmd")")
hook_find_git_commit "$cmd"
if [ -n "$HOOK_COMMIT_CLAUSE" ] || [ "$HOOK_WRAPPED_COMMIT" -eq 1 ]; then
  # The subject is read off the original text, only where a subject can sit:
  # right after a message flag, or opening a line (the `-m "$(cat <<'EOF'`
  # idiom). The version is HOOK_VERSION_RE, shared with safety/commit-language.
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

# The repo the github-release bounce names, off the origin through
# wk_repo_slug, no network. Left empty rather than guessed at.
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

# --- A publish naming its workspaces: those members alone ---
# rt_norm <path>: a member path in one spelling, without a leading `./` or a
# trailing `/`, so `./packages/b/` and `packages/b` are one member.
rt_norm() {
  local p="$1"
  while [ "${p#./}" != "$p" ]; do p="${p#./}"; done
  while [ "${p%/}" != "$p" ]; do p="${p%/}"; done
  printf '%s' "$p"
}
if [ "$trigger" = "publish" ] && [ -n "$RT_WORKSPACES" ]; then
  case "$RT_WS_UNREADABLE" in
    quoted)
      printf 'release-taken: a quoted workspace name could not be read, so the publish could not be placed and the check stood down.\n' >&2
      exit 0 ;;
    empty)
      printf 'release-taken: a workspace flag names no workspace, so the publish could not be placed and the check stood down.\n' >&2
      exit 0 ;;
  esac
  narrowed=""
  found=""
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    # The root is never a workspace, whatever its name.
    [ "$file" = "$root/package.json" ] && continue
    rel=${file#"$root"/}
    rel=$(rt_norm "${rel%package.json}")
    m_name=$(hook_jq -r '.name // ""' "$file" 2>/dev/null) || m_name=""
    hit=0
    while IFS= read -r want; do
      [ -n "$want" ] || continue
      if { [ -n "$m_name" ] && [ "$want" = "$m_name" ]; } || [ "$(rt_norm "$want")" = "$rel" ]; then
        hit=1
        found="$found$want
"
      fi
    done <<EOF
$RT_WORKSPACES
EOF
    if [ "$hit" -eq 1 ]; then
      narrowed="$narrowed$file
"
    fi
  done <<EOF
$pkgs
EOF
  while IFS= read -r want; do
    [ -n "$want" ] || continue
    if ! printf '%s' "$found" | grep -Fxq -- "$want"; then
      printf 'release-taken: the workspace %s is not a member of this project, so the publish could not be placed and the check stood down.\n' "$want" >&2
      exit 0
    fi
  done <<EOF
$RT_WORKSPACES
EOF
  pkgs="$narrowed"
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
    (if .private == false then "yes" else "no" end),
    (if (.files != null) or (.publishConfig != null) then "yes" else "no" end)' "$file" 2>/dev/null) || meta=""
  if [ -z "$meta" ]; then
    printf 'release-taken: %s could not be read as JSON, so that package was not checked.\n' "$file" >&2
    continue
  fi
  p_name=$(printf '%s\n' "$meta" | sed -n 1p)
  p_version=$(printf '%s\n' "$meta" | sed -n 2p)
  p_public=$(printf '%s\n' "$meta" | sed -n 3p)
  p_signal=$(printf '%s\n' "$meta" | sed -n 4p)
  # Publish intent (workflow/ship/publish-plan.js): a package the plan would skip,
  # private or never opted into npm, is never asked about there.
  if [ "$p_public" = "no" ] || [ "$p_signal" = "no" ]; then continue; fi
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
