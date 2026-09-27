#!/usr/bin/env bash
# workflow/standards/state.sh: participation and the machine's own files: the
# tower clone check, the user-level seeds, the offer line, the repo's committed
# answer and version, the drift report, the state resolution, a recorded
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

# The user's folder exists from the first run. `set -C` makes the create
# O_EXCL, so a racing --decline is never truncated, and the stderr redirect
# comes first so it silences the target's own message. `publish` seeds null,
# the unanswered state (`workflow/README.md` § The two settings files).
seed_user_settings() {
  local dir="${USER_SETTINGS%/*}"
  [[ -e "$USER_SETTINGS" ]] && return 0
  mkdir -p "$dir" 2>/dev/null || return 0
  ( set -C; printf '{\n  "version": 1,\n  "site": {\n    "repo": null,\n    "publish": null,\n    "url": null\n  }\n}\n' 2>/dev/null >"$USER_SETTINGS" ) || return 0
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

# true | false | absent | unreadable: the `enabled` key of a settings file,
# this repo's by default. jq when present, the no-jq readers otherwise, so a
# machine without jq still honors a deliberate `enabled: false`.
repo_enabled_flag() {
  local settings="${1:-$REPO_SETTINGS}"
  if command -v jq >/dev/null 2>&1; then
    # `has`, not `//`, since `//` treats `false` as absent. An unparseable file
    # reads `unreadable`, never the legacy opt-in, unless jq already read a no.
    wk_jq_default 'unreadable' \
      -r 'if has("enabled") then (.enabled | tostring) else "absent" end' "$settings"
  elif wk_settings_declined "$settings"; then
    printf 'false'
  elif wk_settings_enabled "$settings"; then
    printf 'true'
  else
    printf 'absent'
  fi
}

# The standard version this repo was last healed to. A file predating the field
# reads as 1: the version every repo healed before the field existed.
repo_version() {
  local v=""
  [[ -f "$REPO_SETTINGS" ]] || { printf '0'; return 0; }
  if command -v jq >/dev/null 2>&1; then
    v="$(wk_jq_default '' -r '.version // 1' "$REPO_SETTINGS")"
  fi
  [[ "$v" =~ ^[0-9]+$ ]] || v=1
  printf '%s' "$v"
}

# Report what this repo still carries from a retired convention, and fix
# nothing: each finding is destructive to fix or needs judgment.
report_drift() {
  local found=0 f

  for f in PROGRESS.md INBOX.md TODO.md; do
    [[ -f "$root/$f" ]] || continue
    wk_warn "standards: $f is retired by spec v4; its contents are work items; run the workkit:migrate skill to file them as issues, then delete it"
    found=1
  done
  if [[ -d "$root/plans" ]]; then
    wk_warn "standards: plans/ is retired by spec v4; a plan is the '## Spec' section of its issue; run the workkit:migrate skill to move each one, then delete the directory"
    found=1
  fi

  # This judges the whole CHANGELOG, unlike the guards, which judge only added
  # lines: it says whether the history was ever brought over.
  if [[ -f "$root/CHANGELOG.md" ]]; then
    if [[ -f "$CHANGELOG_LINTER" ]] && command -v node >/dev/null 2>&1; then
      # Count entries, not violations: one entry often breaks several rules.
      local bad
      bad="$(node "$CHANGELOG_LINTER" "$root/CHANGELOG.md" 2>&1 | grep -oE '^  line [0-9]+' | sort -u | wc -l | tr -d ' ')"
      if [[ "${bad:-0}" -gt 0 ]]; then
        wk_warn "standards: CHANGELOG.md has $bad entries not in the entry format; run the workkit:migrate skill, or 'node ~/.claude/workkit/changelog/changelog.js CHANGELOG.md' to see them"
        found=1
      fi
    else
      # No node (or no linter) means this check never ran. The caller must not
      # stamp the version past it: that would end the one-time drift report
      # for a file nobody checked.
      drift_skipped=1
    fi
  fi

  return "$found"
}

resolve_state() {
  # The clone answers before anything else: a stray .workkit/settings.json that
  # landed in it must not read as a yes.
  if is_home_clone; then
    printf 'home'
    return 0
  fi
  if [[ -f "$REPO_SETTINGS" ]]; then
    case "$(repo_enabled_flag)" in
      false)      printf 'disabled' ;;
      unreadable) printf 'unreadable' ;;
      *)          printf 'enabled' ;;
    esac
    return 0
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
  # again" would be a lie while that file says yes.
  if [[ -f "$REPO_SETTINGS" ]]; then
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

  # An unparseable file is reported, or the roster would go stale unseen.
  if ! keys="$(wk_jq -r '(.repos // {}) | to_entries[] | select(.value != "declined") | .key' "$USER_REPOS" 2>/dev/null)"; then
    wk_warn "roster: $USER_REPOS is not valid JSON; fix or remove it; until then this machine's roster is not maintained"
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
    # registered one: `false` is the deliberate no, and every other answer
    # (including a file jq cannot read) leaves the entry alone.
    flag="$(repo_enabled_flag "$key/$REPO_SETTINGS")"
    if [[ "$flag" == "false" ]]; then
      stale="$stale$key"$'\n'
    fi
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
    # Version 1 on purpose: a repo joining now is the likeliest to carry retired
    # files, and the drift report runs only below the current standard. The
    # heal that follows stamps it forward.
    printf '{\n  "version": 1,\n  "enabled": true\n}\n' >"$REPO_SETTINGS"
    wk_ok "opt-in: created $REPO_SETTINGS; commit it, it is the repo's yes"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    wk_warn "opt-in: $REPO_SETTINGS exists and jq is not installed; set \"enabled\": true by hand"
    exit 1
  fi
  wk_json_edit "$REPO_SETTINGS" '.enabled = true' || exit 1
  wk_ok "opt-in: $REPO_SETTINGS is now enabled"
}
