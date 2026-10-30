#!/usr/bin/env bash
# workflow/workkit/identity.sh: the agent's GitHub identity, workkit-agent[bot]: setup's sign-in
# and install steps, and the two doctor lines. Sourced by
# workkit.sh, functions only; every name it reads, and the IDENTITY_* status it sets, are the entry's,
# save the install poll's own IDENTITY_INSTALL_*. `token.js` answers, and this says what it did.

# Whether the client can be asked at all: node, jq, the engine library, and
# token.js beside this engine. Each failure is a named skip: not drift.
identity_precheck() {
  if ! command -v node >/dev/null 2>&1; then
    wk_skip "identity: reading the sign-in needs node"
    return 1
  fi
  if ! command -v jq >/dev/null 2>&1; then
    wk_skip "identity: reading the sign-in needs jq"
    return 1
  fi
  if [[ "$HOME_LIBS" -ne 1 ]]; then
    wk_skip "identity: the engine library is missing beside $SCRIPT_DIR; the kit is incomplete"
    return 1
  fi
  if [[ ! -f "$IDENTITY_CLIENT" ]]; then
    wk_skip "identity: the client is missing beside $SCRIPT_DIR ($IDENTITY_CLIENT); the kit is incomplete"
    return 1
  fi
  return 0
}

# Reads `token.js --status` once per run into the IDENTITY_* status; clearing
# IDENTITY_SIGNED_IN asks again. A client that cannot answer (a settings file
# that does not parse, say) is one warning with its message, and a return of 1.
identity_read_status() {
  local json fields rc=0 sep=$'\x1f'
  [[ -n "$IDENTITY_SIGNED_IN" ]] && return 0

  json="$(node "$IDENTITY_CLIENT" --status 2>&1)" || rc=$?
  if [[ "$rc" -eq 0 ]]; then
    fields="$(printf '%s' "$json" | wk_jq -r '[(.signedIn | tostring), (.login // "")] | join("\u001f")' 2>/dev/null)" || rc=$?
  fi
  if [[ "$rc" -ne 0 || -z "$fields" ]]; then
    wk_warn "identity: the client could not report its state: ${json:-no output}"
    return 1
  fi
  IFS="$sep" read -r IDENTITY_SIGNED_IN IDENTITY_USER <<<"$fields"
  return 0
}

# The client's installation lookup, bounded like the secrets listing, its
# message folded onto stdout so the caller reads one answer: the verdict on the
# first line, the client's message after it. `--probe` asks for the verdict alone.
# Usage: identity_installation <slug> [--probe]
identity_installation() {
  bounded_read node "$IDENTITY_CLIENT" "${2:---installation}" "$1" 2>&1
}

# The installation lookup under the spinner, its answer as identity_installation
# prints it; identity_install_say words it.
identity_install_lookup() {
  wk_spin "asking the token service whether workkit-agent[bot] is installed on $1" identity_installation "$1"
}

# Words one lookup's answer for <slug>: the ok line and 0 when installed, else a
# warning carrying the service's message or the failure, and 1.
# Usage: identity_install_say <slug> <lookup exit code> <lookup answer>
identity_install_say() {
  local slug="$1" rc="$2" answer="$3" verdict message='' said line
  verdict="${answer%%$'\n'*}"
  [[ "$answer" == *$'\n'* ]] && message="${answer#*$'\n'}"
  if [[ "$rc" -eq 0 && "$verdict" == 'installed' ]]; then
    wk_ok "identity: workkit-agent[bot] installed on $slug"
    return 0
  fi
  if [[ "$rc" -eq 0 && "$verdict" == 'not installed' ]]; then
    said="identity: workkit-agent[bot] is not installed on $slug${message:+: $message}"
  elif [[ -z "$answer" ]]; then
    said="identity: the installation check on $slug did not answer within ${SECRETS_TIMEOUT}s"
  else
    said="identity: the installation check on $slug failed: $answer"
  fi
  # Each later line of the client's message (the refusal's `or run:`) is a warning
  # of its own, so it sits under the section's indent rather than at column 0.
  while IFS= read -r line; do
    [[ "$line" == identity:* ]] || line="identity: $line"
    wk_warn "$line"
  done <<<"$said"
  return 1
}

# The cwd's origin when signed in, each caller adding its repo rule: prints
# the slug, or returns 1 having said nothing.
identity_signed_slug() {
  local slug
  identity_precheck >/dev/null || return 1
  identity_read_status 2>/dev/null || return 1
  [[ "$IDENTITY_SIGNED_IN" == 'true' ]] || return 1
  slug="$(wk_repo_slug "$PWD")"
  [[ -n "$slug" ]] || return 1
  printf '%s' "$slug"
}

# The sign-in verdict: the ok line and 0 when signed in, else the warning
# naming the command and 1.
identity_say_status() {
  if [[ "$IDENTITY_SIGNED_IN" == 'true' ]]; then
    wk_ok "identity: signed in as @$IDENTITY_USER"
    return 0
  fi
  wk_warn "identity: not signed in; run \`workkit setup --login\`"
  return 1
}

# The setup step: signed in is said; not signed in asks to sign in at a keyboard
# (Enter is yes, since the agent needs it), and is a warning naming the command
# on a no or anywhere else. `force` (setup --login) asks nothing, signs in with or
# without a terminal, even when signed in, and returns 1 when it cannot finish.
identity_step() {
  local force="${1:-}" fail=0 opener=''
  [[ -z "$force" ]] || fail=1

  identity_precheck && identity_read_status || return "$fail"

  if [[ -n "$force" ]]; then
    wk_info "identity: signing in to GitHub, so the agent's issue bookkeeping posts as workkit-agent[bot]"
  elif [[ "$IDENTITY_SIGNED_IN" == 'true' ]] || ! interactive \
    || ! wk_ask_yes "Sign in to GitHub now, so the agent's issue bookkeeping posts as workkit-agent[bot]?" y; then
    identity_say_status || true
    return 0
  fi

  opener="$(wk_opener)" || opener=''
  # A declined or abandoned sign-in is reported by the status read below,
  # except a forced one, which fails whatever file stands.
  if ! node "$IDENTITY_LOGIN" ${opener:+--open "$opener"} && [[ -n "$force" ]]; then
    wk_warn "identity: the sign-in did not finish; run \`workkit setup --login\` again"
    return 1
  fi
  IDENTITY_SIGNED_IN=''
  identity_read_status || return "$fail"
  identity_say_status || return "$fail"
}

# The doctor lines: `machine` whether this machine is signed in, `repo` whether
# workkit-agent[bot] is installed on the cwd's origin when signed in and enabled on
# the roster (the shim's rule); returns how many need attention, as secrets_report
# does. A cloud session has no bot: `machine` is one cloud_na line, `repo` none.
identity_report() {
  local scope="$1" slug answer rc=0

  if wk_is_cloud; then
    [[ "$scope" == 'repo' ]] || cloud_na signin
    return 0
  fi

  if [[ "$scope" == 'repo' ]]; then
    slug="$(identity_signed_slug)" && wk_roster_path "$slug" >/dev/null || return 0
    answer="$(identity_install_lookup "$slug")" || rc=$?
    identity_install_say "$slug" "$rc" "$answer"
    return
  fi

  identity_precheck || return 0
  identity_read_status || return 1
  identity_say_status
}

# The poll's check: one silent lookup that reads no install page, kept in
# IDENTITY_INSTALL_RC and IDENTITY_INSTALL_ANSWER for the step to word; 0 only when installed.
identity_install_probe() {
  IDENTITY_INSTALL_RC=0
  IDENTITY_INSTALL_ANSWER="$(identity_installation "$1" --probe)" || IDENTITY_INSTALL_RC=$?
  [[ "$IDENTITY_INSTALL_RC" -eq 0 && "${IDENTITY_INSTALL_ANSWER%%$'\n'*}" == 'installed' ]]
}

# setup --bot's repo: the cwd's origin, printed, when signed in; else the warning
# naming what to do first, and 1. The opt-in is not asked: the flag is the ask.
identity_bot_slug() {
  local slug
  identity_precheck >&2 && identity_read_status || return 1
  if [[ "$IDENTITY_SIGNED_IN" != 'true' ]]; then
    wk_warn "identity: not signed in; run \`workkit setup --login\` first"
    return 1
  fi
  slug="$(wk_repo_slug "$PWD")"
  if [[ -z "$slug" ]]; then
    wk_warn "identity: $PWD has no GitHub origin to install workkit-agent[bot] for"
    return 1
  fi
  printf '%s' "$slug"
}

# Setup's This repo step, signed in and opted in: installed is said; not installed
# at a keyboard offers the install page (an owner's click, never automatic) and polls;
# a no, a skip, or no keyboard warns with that page. Returns 0; `force` (setup --bot)
# runs in any repo with a GitHub origin and returns 1 unless the App ends installed.
identity_install_step() {
  local force="${1:-}" fail=0 slug owner page
  if [[ -n "$force" ]]; then
    fail=1
    slug="$(identity_bot_slug)" || return 1
  else
    [[ "$(repo_state)" == 'enabled' ]] && slug="$(identity_signed_slug)" || return 0
  fi
  IDENTITY_INSTALL_RC=0
  IDENTITY_INSTALL_ANSWER="$(identity_install_lookup "$slug")" || IDENTITY_INSTALL_RC=$?
  if [[ "$IDENTITY_INSTALL_RC" -ne 0 || "${IDENTITY_INSTALL_ANSWER%%$'\n'*}" != 'not installed' ]]; then
    identity_install_say "$slug" "$IDENTITY_INSTALL_RC" "$IDENTITY_INSTALL_ANSWER" || return "$fail"
    return 0
  fi
  owner="${slug%%/*}"
  # The refusal's first line ends on the install page the client built, so the
  # lookup's one read of the owner's id serves the offer and the warning alike.
  page="${IDENTITY_INSTALL_ANSWER#*$'\n'}"
  page="${page%%$'\n'*}"
  page="${page##*: }"
  if interactive && wk_ask_yes "Install workkit-agent[bot] on $owner now?" y; then
    wk_info "identity: install workkit-agent[bot] on $owner at $page"
    wk_open_url "$page"
    wk_poll "waiting for workkit-agent[bot] to be installed on $owner" 15 identity_install_probe "$slug" || true
  fi
  if [[ "$IDENTITY_INSTALL_RC" -eq 0 && "${IDENTITY_INSTALL_ANSWER%%$'\n'*}" == 'not installed' ]]; then
    wk_warn "identity: workkit-agent[bot] is not installed on $slug; install it on $owner at $page"
    return "$fail"
  fi
  identity_install_say "$slug" "$IDENTITY_INSTALL_RC" "$IDENTITY_INSTALL_ANSWER" || return "$fail"
}
