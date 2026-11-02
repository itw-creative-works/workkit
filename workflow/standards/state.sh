#!/usr/bin/env bash
# workflow/standards/state.sh: participation and the machine's own files: the
# tower clone check, the user-level seeds, the offer line, the repo's committed
# answer, the retired version key's removal, the state resolution, a recorded
# decline, the roster and the committed opt-in. Sourced by standards.sh,
# functions only; the states, their files and the clone's address are the
# entry's (§ 0. Participation).

# Is the repo being healed the tower clone? The clone's address and why the
# two sides are compared by physical path sit beside HOME_CLONE_DIR in
# standards.sh.
is_home_clone() {
  local here there
  here="$(cd "$root" 2>/dev/null && pwd -P)" || return 1
  there="$(cd "$HOME_CLONE_DIR" 2>/dev/null && pwd -P)" || return 1
  [[ -n "$here" && "$here" == "$there" ]]
}

# The user's folder exists from the first run, its settings file holding no
# setting: every default is the kit's (defaults/settings.json), never copied in.
# `set -C` makes the create O_EXCL, so a racing --decline is never truncated, and
# the stderr redirect comes first so it silences the target's own message.
seed_user_settings() {
  local dir="${USER_SETTINGS%/*}"
  [[ -e "$USER_SETTINGS" ]] && return 0
  mkdir -p "$dir" 2>/dev/null || return 0
  ( set -C; printf '{\n  "version": 1\n}\n' 2>/dev/null >"$USER_SETTINGS" ) || return 0
}

# Every reader skips a machine file that is no JSON object, so the heal is where
# that gets said. Empty text is no layer at all, not a broken one.
report_user_settings() {
  command -v jq >/dev/null 2>&1 || return 0
  [[ -f "$USER_SETTINGS" ]] || return 0
  wk_jq -e -s 'length == 0 or (length == 1 and (.[0] | type) == "object")' "$USER_SETTINGS" >/dev/null 2>&1 && return 0
  wk_warn "settings: $USER_SETTINGS is not a JSON object (unreadable or not valid JSON); fix or remove it; until then every settings reader skips it"
}

# The machine's own file, seeded the same way and for the opposite reason: it is
# written by the engine and by nobody else, so it appears when the engine first
# has something to record rather than sitting there inviting an edit.
seed_user_repos() {
  local dir="${USER_REPOS%/*}"
  [[ -e "$USER_REPOS" ]] && return 0
  mkdir -p "$dir" 2>/dev/null || return 0
  ( set -C; printf '{\n  "version": 1,\n  "repos": {}\n}\n' 2>/dev/null >"$USER_REPOS" ) || return 0
}

offer_line() {
  # %q on the path: a repo directory containing a space would otherwise print a
  # suggested command that breaks when pasted.
  printf 'this repo is not in the issue workflow; say the word to enable it (bash %q/standards.sh --enable %q), or decline and it will not ask again (--decline).' "$SCRIPT_DIR" "$root"
}

# true | false | absent | unreadable: a settings file's `enabled` (this repo's by
# default); only a boolean answers, so empty text, no key or another value is
# `absent`. jq, else the no-jq readers, so a deliberate `enabled: false` holds
# anywhere; an unreadable file is `unreadable` both ways, which the prune keeps.
repo_enabled_flag() {
  local settings="${1:-$REPO_SETTINGS}" out rc
  if command -v jq >/dev/null 2>&1; then
    # The type, not `//`, since `//` treats `false` as absent. Text holding no JSON
    # value at all (empty) prints nothing and exits 0; text that does not parse
    # reads `unreadable` unless jq already read a value before the break.
    out="$(wk_jq -r 'if (.enabled | type) == "boolean" then (.enabled | tostring) else "absent" end' "$settings" 2>/dev/null)"
    rc=$?
    if [[ -n "$out" ]]; then printf '%s' "$out"
    elif [[ "$rc" -eq 0 ]]; then printf 'absent'
    else printf 'unreadable'
    fi
  elif [[ -e "$settings" && ! -r "$settings" ]]; then
    printf 'unreadable'
  elif wk_settings_declined "$settings"; then
    printf 'false'
  elif wk_settings_enabled "$settings"; then
    printf 'true'
  else
    printf 'absent'
  fi
}

# Nothing in a repo records which heals it has had: a `version` key an older
# kit left in its settings file is removed, and a file without one is never written.
remove_version_stamp() {
  [[ -f "$REPO_SETTINGS" ]] || return 0
  if ! command -v jq >/dev/null 2>&1; then
    if grep -q '"version"[[:space:]]*:' "$REPO_SETTINGS" 2>/dev/null; then
      wk_warn "settings: $REPO_SETTINGS still carries the retired \"version\" key and removing it needs jq; install jq, or delete the key by hand"
    fi
    return 0
  fi
  wk_jq -e 'type == "object" and has("version")' "$REPO_SETTINGS" >/dev/null 2>&1 || return 0
  if wk_json_edit "$REPO_SETTINGS" 'del(.version)'; then
    wk_ok "settings: removed the retired \"version\" key from $REPO_SETTINGS; commit it"
  else
    needs_attention=1
  fi
}

resolve_state() {
  # The clone answers before anything else: a stray .workkit/settings.json that
  # landed in it must not read as a yes.
  if is_home_clone; then
    printf 'home'
    return 0
  fi
  # Only the file's own `"enabled": true` is a yes; a file with no answer either
  # way falls through to the machine's decline record and the offer.
  if [[ -f "$REPO_SETTINGS" ]]; then
    case "$(repo_enabled_flag)" in
      true)       printf 'enabled'; return 0 ;;
      false)      printf 'disabled'; return 0 ;;
      unreadable) printf 'unreadable'; return 0 ;;
    esac
  fi
  # The machine file is read-only here and the decline is the one decision in it,
  # so no jq means no record: an undecided repo simply gets offered again.
  if [[ -f "$USER_REPOS" ]] && command -v jq >/dev/null 2>&1 \
    && [[ "$(wk_jq -r --arg r "$roster_key" '.repos[$r] // ""' "$USER_REPOS" 2>/dev/null)" == "declined" ]]; then
    printf 'declined'
    return 0
  fi
  printf 'undecided'
}

# The state mutex is lib/state.sh's, shared with the home repo's writers.
record_decline() {
  if ! command -v jq >/dev/null 2>&1; then
    wk_warn "decline: jq is required to edit $USER_REPOS"
    exit 1
  fi
  mkdir -p "$(dirname "$USER_REPOS")" 2>/dev/null \
    || { wk_warn "decline: cannot create $(dirname "$USER_REPOS")"; exit 1; }
  seed_user_repos
  [[ -f "$USER_REPOS" ]] || { wk_warn "decline: cannot write $USER_REPOS"; exit 1; }

  # The decline is written under the shared mutex; the trap releases it however
  # this run ends, since a decline is the last thing it does.
  if wk_take_state_lock; then
    trap 'wk_drop_state_lock' EXIT
  else
    wk_warn "decline: proceeding without the lock (held for 5s by another run)"
  fi

  wk_json_edit "$USER_REPOS" --arg r "$roster_key" \
    '.repos = ((.repos // {}) + { ($r): "declined" })' || exit 1

  # A committed answer wins at resolve time, so saying "it will not be offered
  # again" would be a lie while that file gives one; a file with none does not.
  if [[ -f "$REPO_SETTINGS" ]] && [[ "$(repo_enabled_flag)" =~ ^(true|false|unreadable)$ ]]; then
    wk_ok "decline: recorded $roster_key in $USER_REPOS"
    wk_warn "decline: $REPO_SETTINGS still carries the repo's committed answer, which wins; this takes effect only if that file goes away"
  else
    wk_ok "decline: recorded $roster_key in $USER_REPOS; it will not be offered again"
  fi
}

# The machine roster in `.repos.json`, maintained on contact and silently
# (`workflow/README.md` § The two settings files). A decline is never pruned,
# and the heal never fails over its index.
register_in_roster() {
  local keys key stale='' stale_json flag locked=0

  command -v jq >/dev/null 2>&1 || return 0
  seed_user_repos
  [[ -f "$USER_REPOS" ]] || return 0

  # A file jq cannot read is reported, or the roster would go stale unseen.
  if ! keys="$(wk_jq -r '(.repos // {}) | to_entries[] | select(.value != "declined") | .key' "$USER_REPOS" 2>/dev/null)"; then
    wk_warn "roster: $USER_REPOS cannot be read as JSON (unreadable or not valid JSON); fix or remove it; until then this machine's roster is not maintained"
    return 0
  fi

  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    [[ "$key" == "$roster_key" ]] && continue
    if [[ ! -d "$key" ]]; then
      stale="$stale$key"$'\n'
      continue
    fi
    # No committed file is the tri-state's way back to undecided, so the entry
    # leaves the roster like a path that is gone.
    if [[ ! -f "$key/$REPO_SETTINGS" ]]; then
      stale="$stale$key"$'\n'
      continue
    fi
    # The same reading the heal makes of this repo's own file, asked of a
    # registered one: only `true` is on, so every other answer leaves the
    # roster, but a file jq cannot read, which leaves the entry alone.
    flag="$(repo_enabled_flag "$key/$REPO_SETTINGS")"
    case "$flag" in
      true|unreadable) ;;
      *) stale="$stale$key"$'\n' ;;
    esac
  done <<<"$keys"

  # Nothing to add and nothing to remove: leave the file untouched, so a session
  # start on an up-to-date machine writes nothing at all.
  if [[ -z "$stale" ]] \
    && wk_jq -e --arg r "$roster_key" '(.repos // {})[$r] == "enabled"' "$USER_REPOS" >/dev/null 2>&1; then
    return 0
  fi

  stale_json="$(printf '%s' "$stale" | wk_jq -Rs 'split("\n") | map(select(length > 0))' 2>/dev/null)" || return 0

  # The shared mutex, since sessions opening together would otherwise keep
  # only the last registration. Released here rather than by a trap, so
  # concurrent runs never wait out the rest of the heal.
  if wk_take_state_lock; then locked=1; fi

  wk_json_edit "$USER_REPOS" --arg r "$roster_key" --argjson stale "$stale_json" \
    '.repos = ((.repos // {}) | with_entries(select(.key as $k | ($stale | index($k)) | not)) + { ($r): "enabled" })' \
    || true

  if [ "$locked" -eq 1 ]; then wk_drop_state_lock; fi
  return 0
}

write_repo_optin() {
  if [[ ! -f "$REPO_SETTINGS" ]]; then
    mkdir -p "$WORKKIT_DIR"
    printf '{\n  "enabled": true\n}\n' >"$REPO_SETTINGS"
    wk_ok "opt-in: created $REPO_SETTINGS; commit it, it is the repo's yes"
    return 0
  fi
  # A file holding no JSON value gives jq nothing to edit, so it is written whole.
  if [[ -z "$(tr -d '[:space:]' <"$REPO_SETTINGS" 2>/dev/null)" ]]; then
    printf '{\n  "enabled": true\n}\n' >"$REPO_SETTINGS"
    wk_ok "opt-in: wrote the yes into the empty $REPO_SETTINGS; commit it"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    wk_warn "opt-in: $REPO_SETTINGS exists and jq is not installed; set \"enabled\": true by hand"
    exit 1
  fi
  wk_json_edit "$REPO_SETTINGS" '.enabled = true' || exit 1
  wk_ok "opt-in: $REPO_SETTINGS is now enabled"
}
