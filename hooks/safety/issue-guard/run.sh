#!/bin/bash
# safety/issue-guard — PreToolUse hook (Bash)
# The mechanical half of the spec's public-repo rule (docs/project-state.md →
# "Issue anatomy"): every repo workkit touches is assumed PUBLIC, so outbound
# issue/PR text carries no secrets. This guard blocks a `gh issue
# create|comment|edit|close|reopen` or `gh pr create|comment|edit|merge|close`
# whose text holds something secret-shaped. The judgment half — private
# business and personal detail, which no pattern can see — stays prose.
#
# Scope: the whole command string (titles and bodies arrive as --title/--body
# arguments, including the `--body "$(cat <<'EOF' … )"` idiom), plus the
# CONTENT of a --body-file path when it exists. Any other command exits fast.
#
# Two secret sources:
#   1. Local .env values — every KEY=value in .env and .env.*, in the session's
#      cwd AND in the repo root above it, whose value is ≥ 8 chars and not
#      obviously non-secret, matched verbatim. The block names the KEY, never
#      the value.
#   2. Token shapes — the common key prefixes, and long high-entropy runs.
#      The block names the KIND, never the match.
# A 40-char lowercase-hex git sha is NOT high entropy by this test (mixed case
# AND a digit are both required): commit shas appear in issue comments
# constantly and must never bounce.
# Fail open on the hook's OWN errors (no jq, no command) — a broken guard must
# never wedge the session.

set -euo pipefail

input=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

cmd=$(jq -r '.tool_input.command // ""' <<<"$input" || true)
[ -n "$cmd" ] || exit 0

# --- Is this an outbound gh issue/PR write? ---
# close and reopen belong here too: their --comment posts free text publicly,
# exactly like a plain comment (verifier finding, 2026-07-28).
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_./-])gh[[:space:]]+(issue[[:space:]]+(create|comment|edit|close|reopen)|pr[[:space:]]+(create|comment|edit|merge|close))([[:space:]]|$)'; then
  exit 0
fi

cwd=$(jq -r '.cwd // ""' <<<"$input" || true)
[ -n "$cwd" ] || cwd="$PWD"

# --- The outbound text: the command, plus any body-file content. ---
# `-F` is gh's shorthand for --body-file on these subcommands, so both
# spellings are extracted; a path that does not resolve is simply skipped.
text="$cmd"
while IFS= read -r bf; do
  [ -n "$bf" ] || continue
  bf="${bf#\"}"; bf="${bf%\"}"
  bf="${bf#\'}"; bf="${bf%\'}"
  case "$bf" in
    /*) file="$bf" ;;
    *)  file="$cwd/$bf" ;;
  esac
  [ -f "$file" ] || continue
  text="$text
$(cat "$file" 2>/dev/null || true)"
done <<EOF
$(printf '%s' "$cmd" | grep -Eo -- '(--body-file|(^|[[:space:]])-F)[=[:space:]]+[^[:space:]]+' | sed -E 's/^[[:space:]]*(--body-file|-F)[=[:space:]]+//' || true)
EOF

block() {
  {
    echo "issue-guard: BLOCKED this gh command — the outbound text carries $1."
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
# No repo — or a toplevel that IS the cwd — leaves the cwd scan as the whole of
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

# Long high-entropy runs. A candidate qualifies only with BOTH cases and a
# digit, which is what keeps a 40-char lowercase-hex sha out.
# The candidate class excludes `/` and `-` on purpose: with them in, an issue
# URL, an absolute path, and a long branch name all read as one 40+ char run —
# and the spec REQUIRES cross-repo links in issue bodies, so that false block
# would have been the guard's end (verifier finding, 2026-07-28).
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
