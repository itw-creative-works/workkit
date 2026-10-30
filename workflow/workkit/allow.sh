#!/usr/bin/env bash
# workflow/workkit/allow.sh: the allow rules the kit keeps in the global Claude
# settings, and the setup and doctor steps that keep them there.
# Sourced by workkit.sh, functions only.

# The commands a ship or review runs that auto mode may block though a skill
# allows them, in Claude Code's allow-rule syntax. One list, kept in the global
# settings, so no repo carries a copy.
ALLOW_RULES=('Bash(workkit ship:*)' 'Bash(workkit review:*)' 'Bash(npm publish:*)')

# The rules the settings file lacks, one per line in the list's order; all of
# them when it is missing. 1 when it is not one JSON object with a list (or
# nothing) at permissions.allow. Needs jq and lib/; allow_readable checks.
allow_missing() {
  local settings="$CLAUDE_HOME/settings.json" want out
  if [[ ! -e "$settings" ]]; then
    printf '%s\n' "${ALLOW_RULES[@]}"
    return 0
  fi
  want="$(printf '%s\n' "${ALLOW_RULES[@]}" | wk_jq -cRn '[inputs]')"
  # Slurped, so an empty file is a refusal rather than a file holding nothing.
  out="$(wk_jq -rs --argjson want "$want" \
    'if length == 1 then ($want - (.[0].permissions.allow // []))[] else error("not one value") end' \
    "$settings" 2>/dev/null)" || return 1
  [[ -z "$out" ]] || printf '%s\n' "$out"
}

# 0 when the rules can be read; 1 after a skip line for a machine without jq;
# 2 after a warning for an incomplete kit without the JSON helpers in lib/.
allow_readable() {
  local settings="$CLAUDE_HOME/settings.json"
  if ! declare -f wk_jq wk_json_edit_or_create >/dev/null 2>&1; then
    wk_warn "allow: the JSON helpers in $SCRIPT_DIR/lib are missing, so the kit's allow rules in $settings cannot be $1; the kit is incomplete"
    return 2
  fi
  if ! command -v jq >/dev/null 2>&1; then
    wk_skip "allow: no jq on this machine, so the kit's allow rules in $settings cannot be $1"
    return 1
  fi
}

# The command that puts the rules back: the cloud's setup is `--cloud`.
allow_fix() {
  if wk_is_cloud; then printf 'workkit setup --cloud'; else printf 'workkit setup'; fi
}

# setup's step, inside machine_links: the missing rules appended to
# permissions.allow, every other key kept in its order, and a file that holds
# them all never written. The automatic path makes no ~/.claude, as the links
# make no ~/.local/bin; a human's run may.
keep_allow_rules() {
  local settings="$CLAUDE_HOME/settings.json" missing add
  if [[ "$QUIET" -eq 1 && ! -d "$CLAUDE_HOME" ]]; then
    return 0
  fi
  allow_readable kept || return 0
  # Quiet under --auto, as script_shell's foreign value is: the daily run
  # would repeat it every morning; a human's run and doctor still say it.
  if ! missing="$(allow_missing)"; then
    [[ "$QUIET" -eq 1 ]] || wk_warn "allow: $settings is not JSON with a list at permissions.allow, so it was left as it is; fix it, then re-run \`$(allow_fix)\`"
    return 0
  fi
  if [[ -z "$missing" ]]; then
    wk_skip "allow: $settings holds the kit's allow rules"
    return 0
  fi

  add="$(printf '%s\n' "$missing" | wk_jq -cRn '[inputs]')"
  mkdir -p "$CLAUDE_HOME" 2>/dev/null || true
  if wk_json_edit_or_create "$settings" --argjson add "$add" \
    '.permissions.allow = ((.permissions.allow // []) + $add)'; then
    wk_ok "allow: added ${missing//$'\n'/, } to $settings"
  fi
}

# doctor's lines: one warning per missing rule, each an item needing attention,
# and nothing when all are there. Returns the count.
report_allow_rules() {
  local settings="$CLAUDE_HOME/settings.json" missing rule count=0 rc=0
  allow_readable read || rc=$?
  [[ "$rc" -eq 2 ]] && return 1
  [[ "$rc" -eq 0 ]] || return 0
  local fix
  fix="$(allow_fix)"
  if ! missing="$(allow_missing)"; then
    wk_warn "allow: $settings is not JSON with a list at permissions.allow, so the kit's allow rules cannot be read; fix it, then run \`$fix\`"
    return 1
  fi
  while IFS= read -r rule; do
    [[ -n "$rule" ]] || continue
    wk_warn "allow: $rule is missing from $settings; run \`$fix\`"
    count=$((count + 1))
  done <<<"$missing"
  return "$count"
}
