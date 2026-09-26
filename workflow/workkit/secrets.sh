#!/usr/bin/env bash
# workflow/workkit/secrets.sh: the cloud brief's two secrets on the home repo:
# the bounded reads, the listing and its ages, the Claude token's mint under a
# PTY, the gh login's push, and the three callers (setup's step, `setup
# --token`, and the report `doctor` and `update` print). SOURCED by workkit.sh,
# never executed, and it runs nothing at load: it defines functions and sets
# nothing. Every name it reads (SCRIPT_DIR, HOME_LIBS, SECRET_CLAUDE,
# SECRET_HOME, SECRET_MAX_AGE_DAYS, SECRETS_TIMEOUT, the `interactive` check)
# and the two it sets at run time (SECRETS_SLUG, SECRETS_JSON) are the entry's.

# ── The cloud secrets (issues #88, #91) ───────────────────────────────────────
# The cloud brief runs on two repo secrets, and they live on the HOME repo:
# `<login>/workkit`, the repo setup made for this machine and seeded the
# workflow into. Not on this checkout's own repo: the plugin is distributed to
# everyone who installs the kit, and a consumer cannot set secrets on a repo
# they do not own (issue #91). The home slug is also what the daily job's
# dispatch gates on, so the two agree by construction.
#
# The one rule the whole block is built around: a token value goes from the
# command that produced it to `gh secret set` through a pipe, held in a single
# local on the way. It is never passed as an argument, echoed, or logged, and
# the ONE file it may transit is the mint's own capture (issue #174): 600 before
# a byte lands in it, and gone the moment it has been read.

# The listing below is the only network the daily path makes (the standards
# hook calls `update --auto` at session start) so it gets an upper
# bound: a captive portal answers the TCP handshake and never the request, and
# an unbounded `gh` there would hold a session open for as long as it liked.
# macOS ships no coreutils `timeout`, so one is used when the machine has it and
# a bash watchdog stands in when it does not. A bound that fires looks exactly
# like a listing that could not be read, which every caller already treats as a
# named skip. Only the READS are bounded: a write cut in half is worse than a
# write that waits, and every write is on a path a human is sitting in front of.
bounded_read() {
  local watchdog pid rc=0
  if command -v timeout >/dev/null 2>&1; then timeout "$SECRETS_TIMEOUT" "$@"; return $?; fi
  if command -v gtimeout >/dev/null 2>&1; then gtimeout "$SECRETS_TIMEOUT" "$@"; return $?; fi
  "$@" &
  pid=$!
  # The subshell's own stdout goes to /dev/null on purpose: inside a command
  # substitution a background `sleep` holding the capture pipe open would
  # outlive the very call this is here to bound.
  ( sleep "$SECRETS_TIMEOUT"; kill -TERM "$pid" ) >/dev/null 2>&1 &
  watchdog=$!
  wait "$pid" || rc=$?
  kill -TERM "$watchdog" >/dev/null 2>&1 || true
  wait "$watchdog" 2>/dev/null || true
  return "$rc"
}

# A command run under a PTY, with everything it draws teed to both this terminal
# and `capture`. The mint needs it (issue #174) and nothing else does.
#
# When the run sits at a real terminal and `expect` exists, expect drives the
# PTY (`mint-pty.exp`, beside workkit.sh), for one reason (issue #187): Ctrl-C. The CLI holds its PTY in raw mode
# and DISCARDS the ^C byte, and under raw passthrough no layer turns the key
# into a signal, so the byte is caught one layer out, at this terminal, before
# it is forwarded. The binding ends the child and answers 130, the way an
# interrupt ends any other command; every other keystroke passes through, which
# is what keeps the paste-the-code prompt answerable.
#
# Without expect, or without a terminal (the tests drive this with a file on
# stdin), the two `script` utilities take the command in different places, so
# the machine is asked which one it speaks: only GNU/util-linux answers
# `--version` at all, and only its `-e` returns the child's own exit status:
# without it a mint that never ran would look like one that succeeded. macOS
# returns that status on its own, but `-e` is asked for on the BSD side too: a
# no-op there, and the flag that keeps a FreeBSD `script` from reading every
# mint as a success. GNU takes the command as ONE string, so the words are
# joined for it: the mint is `claude setup-token` and nothing here carries a
# space. Under bare `script` the ^C byte still reaches a child that ignores it.
run_under_pty() {
  local capture="$1"; shift
  if command -v expect >/dev/null 2>&1 && [[ -t 0 ]] && [[ -f "$SCRIPT_DIR/mint-pty.exp" ]]; then
    WK_PTY_CAPTURE="$capture" WK_PTY_CMD="$*" expect "$SCRIPT_DIR/mint-pty.exp"
  elif script --version >/dev/null 2>&1; then
    script -q -e -c "$*" "$capture"
  else
    script -q -e "$capture" "$@"
  fi
}

# `gh secret list --json name,updatedAt` for the repo, or nothing at all: an
# unauthenticated gh, a repo without Actions, no network. The caller tells the
# two apart by asking jq whether what came back is an array.
secrets_json() {
  wk_spin "reading the secrets on $1" bounded_read gh secret list --repo "$1" --json name,updatedAt 2>/dev/null || true
}

# Whether a listing came back at all.
is_listing() {
  printf '%s' "$1" | wk_jq -e 'type == "array"' >/dev/null 2>&1
}

# How many whole days ago a secret was last set: a number, `unknown` for a
# timestamp jq could not read, and NOTHING when the repo has no such secret:
# absent is the state every caller acts on first.
secret_age_days() {
  printf '%s' "$1" | wk_jq -r --arg n "$2" '
    map(select(.name == $n)) | .[0] // empty
    | (try (.updatedAt | sub("\\.[0-9]+"; "") | fromdateiso8601) catch null) as $t
    | if $t == null then "unknown" else (((now - $t) / 86400) | floor | tostring) end
  ' 2>/dev/null || true
}

# The token out of `claude setup-token`'s output. The mint prints its progress
# around the value, so the shape is what identifies it: an `sk-ant-` token if
# there is one, otherwise the last line that is nothing but a long opaque
# string. Colors are stripped first: a terminal mint arrives wrapped in them.
extract_token() {
  local text token
  text="$(printf '%s' "$1" | tr -d '\r' | sed $'s/\033\\[[0-9;]*m//g')"
  token="$(printf '%s\n' "$text" | grep -oE 'sk-ant-[A-Za-z0-9_-]+' | tail -1 || true)"
  if [[ -z "$token" ]]; then
    token="$(printf '%s\n' "$text" | grep -oE '^[[:space:]]*[A-Za-z0-9_-]{24,}[[:space:]]*$' | tail -1 || true)"
  fi
  printf '%s' "${token//[[:space:]]/}"
}

# Mint and push in one move, with the mint under a PTY. The CLI draws its ENTIRE
# screen on stdout (the browser-open message AND the paste-the-authorization-code
# prompt that follows the approval) so a captured stdout leaves the human staring
# at a blank line with nothing to answer and, in the CLI's raw keyboard mode,
# no Ctrl-C either (issue #174). Under the PTY runner that whole screen reaches
# the terminal, a copy of it lands in the capture file, and Ctrl-C ends the run
# where the runner can catch it (run_under_pty, issue #187). The capture is the
# one file a token value may
# transit: `mktemp` in TMPDIR, 600 before the mint writes a byte, read once and
# removed, by a trap as well, so an interrupted mint leaves nothing behind.
# From the extraction on the value is a local on its way to `gh secret set`'s
# stdin, and every path out of here that did not push prints the two commands
# that do the same thing by hand.
mint_claude_token() {
  local slug="$1" capture raw token rc=0

  capture="$(mktemp "${TMPDIR:-/tmp}/workkit-mint.XXXXXX")"
  chmod 600 "$capture"
  trap "rm -f '$capture'" INT TERM EXIT

  wk_info "secrets: running \`claude setup-token\`; approve it in the browser, and the token goes straight to $slug, where the cloud brief runs"
  run_under_pty "$capture" claude setup-token || rc=$?
  raw="$(cat "$capture" 2>/dev/null || true)"
  rm -f "$capture"
  trap - INT TERM EXIT

  if [[ "$rc" -ne 0 ]]; then
    wk_warn "secrets: \`claude setup-token\` did not finish (exit $rc); run it by hand, then \`gh secret set $SECRET_CLAUDE --repo $slug\`"
    return 0
  fi

  token="$(extract_token "$raw")"
  if [[ -z "$token" ]]; then
    wk_warn "secrets: \`claude setup-token\` printed no token this run; run it by hand, then \`gh secret set $SECRET_CLAUDE --repo $slug\`"
    return 0
  fi

  if ! printf '%s' "$token" | wk_spin "setting $SECRET_CLAUDE on $slug" gh secret set "$SECRET_CLAUDE" --repo "$slug" >/dev/null 2>&1; then
    wk_warn "secrets: $SECRET_CLAUDE could not be written to $slug; run \`gh secret set $SECRET_CLAUDE --repo $slug\` by hand"
    return 0
  fi
  wk_ok "secrets: $SECRET_CLAUDE is set on $slug; the value went from the mint into the secret, and the file it passed through is gone"
}

# The three things a mint needs and no run can supply for itself: the CLI that
# performs it, a PTY tool (`expect`, or `script` without the Ctrl-C escape) that
# gives that CLI a terminal to draw its
# screen on, and a terminal to approve it in: the mint is a browser approval,
# so a piped or backgrounded run gets the two commands instead. Every answer is
# the same whether the mint was offered or asked for outright, which is why they
# live here rather than in either caller.
can_mint_claude_token() {
  local slug="$1" reason="$2"

  if ! command -v claude >/dev/null 2>&1; then
    wk_skip "secrets: $SECRET_CLAUDE $reason on $slug; minting it needs the claude CLI"
    return 1
  fi
  if ! command -v expect >/dev/null 2>&1 && ! command -v script >/dev/null 2>&1; then
    wk_skip "secrets: $SECRET_CLAUDE $reason on $slug; minting it needs \`expect\` or \`script\`, which give \`claude setup-token\` the terminal it draws on: run \`claude setup-token\` by hand, then \`gh secret set $SECRET_CLAUDE --repo $slug\`"
    return 1
  fi
  if ! interactive; then
    wk_info "secrets: $SECRET_CLAUDE $reason on $slug; run these two at a terminal:
    claude setup-token
    gh secret set $SECRET_CLAUDE --repo $slug"
    return 1
  fi
  return 0
}

# The offer. Default no, like every other question this command asks.
offer_claude_token() {
  local slug="$1" reason="$2" answer=''

  can_mint_claude_token "$slug" "$reason" || return 0

  printf '%s %s on %s. Mint one now with `claude setup-token`? [y/N] ' "$SECRET_CLAUDE" "$reason" "$slug"
  read -r answer || true
  case "$answer" in
    y|Y|yes|YES) mint_claude_token "$slug" ;;
    *) wk_skip "secrets: $SECRET_CLAUDE left as it is; \`workkit setup\` offers again" ;;
  esac
}

# The cross-repo token, zero-click: the CLI's own
# login already reaches every swept board, and there is no API that mints a
# narrower one. It is the only credential that leaves the home repo: the
# Discussion is posted with the workflow's built-in GITHUB_TOKEN. The tradeoff
# (that login's full reach) and the least-privilege alternative are in
# jobs/README.md.
push_home_token() {
  local slug="$1" token='' rc=0

  token="$(wk_spin 'reading the gh login token' gh auth token 2>/dev/null)" || rc=$?
  if [[ "$rc" -ne 0 || -z "$token" ]]; then
    wk_warn "secrets: $SECRET_HOME is not set on $slug and \`gh auth token\` returned nothing; run \`gh auth login\`, then re-run \`workkit setup\`"
    return 0
  fi
  if ! printf '%s' "$token" | wk_spin "setting $SECRET_HOME on $slug" gh secret set "$SECRET_HOME" --repo "$slug" >/dev/null 2>&1; then
    wk_warn "secrets: $SECRET_HOME could not be written to $slug; run \`gh auth token | gh secret set $SECRET_HOME --repo $slug\` by hand"
    return 0
  fi
  wk_ok "secrets: $SECRET_HOME is set on $slug from this machine's gh login; the run on $slug reads every board with it, so it carries that login's reach (jobs/README.md names the narrower alternative)"
}

# Everything the block needs before it can say anything true: gh, jq, a home
# repo, and a listing that came back. Each failure is a named skip: none of them
# is drift, and a run that cannot read the repo must never report a missing secret.
# Sets SECRETS_SLUG and SECRETS_JSON for the caller.
secrets_precheck() {
  SECRETS_SLUG=''
  SECRETS_JSON=''

  if ! command -v gh >/dev/null 2>&1; then
    wk_skip "secrets: the cloud brief's secrets need gh"
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    wk_skip "secrets: reading the cloud brief's secrets needs jq"
    return 1
  fi
  # Two different missing things, told apart: a checkout without the home-repo
  # library cannot resolve a slug at all, which is not the same as a machine
  # that asked and has no home repo yet.
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_skip "secrets: the home-repo library is missing beside $SCRIPT_DIR; this checkout cannot name the home repo the cloud brief's secrets live on"
    return 1
  fi
  SECRETS_SLUG="$(wk_home_slug 2>/dev/null || true)"
  if [[ -z "$SECRETS_SLUG" ]]; then
    wk_skip "secrets: this machine names no home repo; the cloud brief runs there and posts the morning brief there, so its secrets live there too; setup's home step makes one"
    return 1
  fi

  SECRETS_JSON="$(secrets_json "$SECRETS_SLUG")"
  if ! is_listing "$SECRETS_JSON"; then
    wk_skip "secrets: $SECRETS_SLUG's secrets could not be read; \`gh secret list --repo $SECRETS_SLUG\` says why"
    return 1
  fi
  return 0
}

# The setup step: act on what is missing or stale, and stay silent about what is
# set and fresh. Running it twice equals running it once.
secrets_step() {
  local age

  secrets_precheck || return 0

  age="$(secret_age_days "$SECRETS_JSON" "$SECRET_CLAUDE")"
  if [[ -z "$age" ]]; then
    offer_claude_token "$SECRETS_SLUG" "is not set"
  elif [[ "$age" != 'unknown' ]] && (( age > SECRET_MAX_AGE_DAYS )); then
    offer_claude_token "$SECRETS_SLUG" "was set $age days ago and the token lives about a year"
  else
    wk_skip "secrets: $SECRET_CLAUDE is set on $SECRETS_SLUG"
  fi

  age="$(secret_age_days "$SECRETS_JSON" "$SECRET_HOME")"
  if [[ -z "$age" ]]; then
    push_home_token "$SECRETS_SLUG"
  else
    wk_skip "secrets: $SECRET_HOME is set on $SECRETS_SLUG"
  fi
}

# `setup --token`: the mint on demand (issue #174). The step above acts on
# ABSENT or old, which is everything the listing can see, and a token can go
# bad while it is young, a subscription that lapsed under it being the case that
# named this. So the flag IS the yes: no age to check, no question to put, and
# nothing else of setup runs. The guards stay, because a mint still needs the
# CLI and a terminal whatever asked for it.
token_step() {
  secrets_precheck || return 0
  can_mint_claude_token "$SECRETS_SLUG" "is being re-minted" || return 0
  mint_claude_token "$SECRETS_SLUG"
}

# The report, in two voices. `doctor` says one line per value and returns how
# many need attention; `update` (including the daily --auto run, which never
# prompts and never mints) says nothing but the warnings.
secrets_report() {
  local mode="$1" age attention=0 name

  secrets_precheck || return 0

  for name in "$SECRET_CLAUDE" "$SECRET_HOME"; do
    age="$(secret_age_days "$SECRETS_JSON" "$name")"
    if [[ -z "$age" ]]; then
      wk_warn "secrets: $name is not set on $SECRETS_SLUG; run \`workkit setup\`"
      attention=$((attention + 1))
    elif [[ "$age" != 'unknown' ]] && (( age > SECRET_MAX_AGE_DAYS )); then
      wk_warn "secrets: $name on $SECRETS_SLUG was set $age days ago; run \`workkit setup\` to refresh it"
      attention=$((attention + 1))
    elif [[ "$mode" == 'doctor' ]]; then
      if [[ "$age" == 'unknown' ]]; then
        wk_ok "secrets: $name is set on $SECRETS_SLUG"
      else
        wk_ok "secrets: $name is set on $SECRETS_SLUG ($age days ago)"
      fi
    fi
  done

  return "$attention"
}
