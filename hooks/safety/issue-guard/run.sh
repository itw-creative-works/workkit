#!/bin/bash
# safety/issue-guard: PreToolUse hook (Bash), the mechanical half of the spec's
# public-repo rule (docs/project-state.md § Issue anatomy): a gh issue/PR write,
# a GraphQL discussion or issue mutation, or a REST write to an issue or pull
# endpoint bounces when its text or body file carries a local .env value (named
# by KEY) or a token shape (named by kind). A lowercase-hex git sha is never high
# entropy. Fails open on its own errors. Detail: docs/hooks.md § safety:issue-guard.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

. "${BASH_SOURCE[0]%/*}/../../_lib.sh"

cmd=$(hook_jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# --- Is this an outbound gh issue/PR write? ---
# close and reopen belong here too: their --comment posts free text publicly.
outbound=no
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+(issue[[:space:]]+(create|comment|edit|close|reopen)|pr[[:space:]]+(create|comment|edit|merge|close))([[:space:]]|$)'; then
  outbound=yes
fi

# The GraphQL door. A mutation is the write: `mutation` is the keyword every
# one of them carries (an anonymous `{…}` operation is a query), and the
# operation name says whether the payload is public text. Both are matched
# case-insensitively; a query passes untouched.
if [ "$outbound" = no ] \
  && printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+api[[:space:]]+graphql([[:space:]]|$)' \
  && printf '%s' "$cmd" | grep -Eqi 'mutation' \
  && printf '%s' "$cmd" | grep -Eqi '(create|update|add|delete)(Discussion|DiscussionComment|Issue|IssueComment|Comment)'; then
  outbound=yes
fi

# The REST door: the whole `repos/<o>/<n>/(issues|pulls)` tree by prefix. gh's
# method is implicit (GET, POST once a field or input is given), so a write is
# an explicit POST|PATCH|PUT or a field-carrying call; the read exemption reads
# the method only before the first field, and only for a single `gh api` call.
if [ "$outbound" = no ] \
  && printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+api([[:space:]]|$)' \
  && printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_.-])(https://api\.github\.com/)?/?repos/[^/[:space:]]+/[^/[:space:]]+/(issues|pulls)([^[:alnum:]_-]|$)'; then
  lead=$(printf '%s' "$cmd" | sed -E 's/[[:space:]](-[fF]|--field|--raw-field|--input)[=[:space:]].*$//')
  apis=$(printf '%s' "$cmd" | grep -Eo '(^|[^[:alnum:]_./-])gh[[:space:]]+api([[:space:]]|$)' | wc -l | tr -d ' ')
  if printf '%s' "$lead" | grep -Eqi '(^|[[:space:]])(-X|--method)[=[:space:]]+["'"'"']?(POST|PATCH|PUT)'; then
    outbound=yes
  elif [ "$apis" = 1 ] && printf '%s' "$lead" | grep -Eq '(^|[[:space:]])(-X|--method)[=[:space:]]'; then
    outbound=no
  elif printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(-[fF]|--field|--raw-field|--input)[=[:space:]]'; then
    outbound=yes
  fi
fi

[ "$outbound" = yes ] || exit 0

cwd=$(hook_jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# --- The outbound text: the command, plus any body-file content. ---
# `-F` is --body-file on these subcommands and `--input <path>` the REST body;
# a path that resolves to no file, `-` included, is skipped.
text="$cmd"
add_file() {
  local bf="$1" file
  [ -n "$bf" ] || return 0
  bf="${bf#\"}"; bf="${bf%\"}"
  bf="${bf#\'}"; bf="${bf%\'}"
  case "$bf" in
    /*) file="$bf" ;;
    *)  file="$cwd/$bf" ;;
  esac
  [ -f "$file" ] || return 0
  text="$text
$(cat "$file" 2>/dev/null || true)"
}

while IFS= read -r bf; do
  add_file "$bf"
done <<EOF
$(printf '%s' "$cmd" | grep -Eo -- '(--body-file|--raw-field|--field|--input|(^|[[:space:]])-F)[=[:space:]]+[^[:space:]]+' | sed -E 's/^[[:space:]]*(--body-file|--raw-field|--field|--input|-F)[=[:space:]]+//' || true)
EOF

# The GraphQL variable form `-F body=@<path>` sends the file verbatim, and the
# long synonyms (`--field`, `--raw-field`) are the same door.
at_pattern="(^|[[:space:]])(-[fF]|--field|--raw-field)[=[:space:]]+[A-Za-z_][A-Za-z0-9_]*=[\"']?@[^[:space:]\"']+"
while IFS= read -r bf; do
  add_file "$bf"
done <<EOF
$(printf '%s' "$cmd" | grep -Eo -- "$at_pattern" | sed -E 's/^.*@//' || true)
EOF

block() {
  {
    echo "issue-guard: BLOCKED this gh command: the outbound text carries $1."
    echo "Every repo workkit touches is assumed public, issues and PRs and comments included: no secrets, credentials, tokens, or private business or personal details. Keep that context in chat or in local files and reference it indirectly."
  } >&2
  exit 2
}

# --- 1. Local .env values, matched verbatim. ---
# The committed example/template variants are skipped: their values are public
# placeholders by design, so scanning them only produces false blocks.
scan_env_dir() {
  local dir="$1" envfile line key val
  for envfile in "$dir"/.env "$dir"/.env.*; do
    [ -f "$envfile" ] || continue
    case "$(basename "$envfile")" in
      .env.example|.env.sample|.env.template|.env.defaults) continue ;;
    esac
    while IFS= read -r line || [ -n "$line" ]; do
      case "$line" in
        ''|\#*) continue ;;
        *=*) ;;
        *) continue ;;
      esac
      key="${line%%=*}"
      val="${line#*=}"
      key="${key#export }"
      key="$(printf '%s' "$key" | tr -d '[:space:]')"
      [ -n "$key" ] || continue
      val="${val#"${val%%[![:space:]]*}"}"
      val="${val%"${val##*[![:space:]]}"}"
      case "$val" in
        \"*\") val="${val#\"}"; val="${val%\"}" ;;
        \'*\') val="${val#\'}"; val="${val%\'}" ;;
      esac
      # Obviously non-secret values: too short to be a key, a boolean, a bare
      # number or version, or a local URL carrying no credentials.
      [ ${#val} -ge 8 ] || continue
      case "$val" in
        [Tt]rue|[Ff]alse|TRUE|FALSE) continue ;;
        http://localhost*|https://localhost*|http://127.0.0.1*|https://127.0.0.1*)
          case "$val" in *@*) ;; *) continue ;; esac ;;
      esac
      case "$val" in *[!0-9.]*) ;; *) continue ;; esac
      case "$text" in
        *"$val"*) block "the value of $key from a local .env file" ;;
      esac
    done < "$envfile"
  done
}

scan_env_dir "$cwd"

# The repo root's .env too: a session standing in a subdirectory loads none of
# the root's values from the cwd alone, and value matching goes blind there.
# No repo (or a toplevel that IS the cwd) leaves the cwd scan as the whole of
# it, never an error.
toplevel=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$toplevel" ] && [ "$toplevel" != "$cwd" ]; then
  scan_env_dir "$toplevel"
fi

# --- 2. Token shapes. The KIND is named; the match is never echoed. ---
match() { printf '%s' "$text" | grep -Eq -e "$1"; }

if match '(^|[^A-Za-z0-9_])(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}'; then
  block "a GitHub token-shaped string"
fi
if match '(^|[^A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}'; then
  block "a GitHub token-shaped string"
fi
if match '(^|[^A-Za-z0-9_])sk-[A-Za-z0-9_-]{16,}'; then
  block "an API key-shaped string (sk- prefix)"
fi
if match '(^|[^A-Za-z0-9_])AIza[A-Za-z0-9_-]{20,}'; then
  block "a Google API key-shaped string"
fi
if match '(^|[^A-Za-z0-9_])xox[bapos]-[A-Za-z0-9-]{10,}'; then
  block "a Slack token-shaped string"
fi
if match '(^|[^A-Za-z0-9_])AKIA[A-Z0-9]{12,}'; then
  block "an AWS access key-shaped string"
fi
if match '[-]{5}BEGIN'; then
  block "a private key block"
fi

# Long high-entropy runs need both cases and a digit, which keeps a hex sha out.
# The class excludes `/` and `-`: with them an issue URL, a path or a branch name
# reads as one long run, and the spec requires cross-repo links in issue bodies.
while IFS= read -r run; do
  [ -n "$run" ] || continue
  printf '%s' "$run" | grep -q '[A-Z]' || continue
  printf '%s' "$run" | grep -q '[a-z]' || continue
  printf '%s' "$run" | grep -q '[0-9]' || continue
  block "a long high-entropy run"
done <<EOF
$(printf '%s' "$text" | grep -Eo '[A-Za-z0-9_+=]{40,}' || true)
EOF

exit 0
