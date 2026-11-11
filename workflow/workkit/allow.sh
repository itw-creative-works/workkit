#!/usr/bin/env bash
# workflow/workkit/allow.sh: the allow rules the kit keeps in the global Claude
# settings, and the setup and doctor steps that keep them there.
# Sourced by workkit.sh, functions only.

# The commands a ship or review runs that auto mode may block though a skill allows them,
# kept in the global settings: every ship verb (ship.sh's SHIP_VERBS, sourced first) but
# deploy, which prompts outside a ship. The ship rules twin ALLOWED_SHIP_VERBS in
# hooks/mods/bare-call.js, pinned by test/hooks/twins.test.js: change one and change the other.
ALLOW_RULES=()
for _wk_verb in "${SHIP_VERBS[@]}"; do
  [[ "$_wk_verb" == deploy ]] || ALLOW_RULES+=("Bash(workkit ship $_wk_verb:*)")
done
unset _wk_verb
ALLOW_RULES+=('Bash(workkit review:*)' 'Bash(npm publish:*)')

# Rules the kit once kept and every run takes out: the whole ship verb's rule
# let `workkit ship deploy` through with no prompt.
RETIRED_ALLOW_RULES=('Bash(workkit ship:*)')

# _allow_query <filter> <rules...>: <filter> over the settings file with the
# rules as $want, one result per line. 1 when it is not one JSON object with a
# list (or nothing) at permissions.allow. Needs jq and lib/; allow_readable checks.
_allow_query() {
  local settings="$CLAUDE_HOME/settings.json" filter="$1" want out
  shift
  want="$(printf '%s\n' "$@" | wk_jq -cRn '[inputs]')"
  # Slurped, so an empty file is a refusal rather than a file holding nothing.
  out="$(wk_jq -rs --argjson want "$want" \
    "if length == 1 then (.[0].permissions.allow // []) as \$have | $filter else error(\"not one value\") end" \
    "$settings" 2>/dev/null)" || return 1
  [[ -z "$out" ]] || printf '%s\n' "$out"
}

# The rules the settings file lacks, one per line in the list's order; all of
# them when it is missing.
allow_missing() {
  if [[ ! -e "$CLAUDE_HOME/settings.json" ]]; then
    printf '%s\n' "${ALLOW_RULES[@]}"
    return 0
  fi
  _allow_query '($want - $have)[]' "${ALLOW_RULES[@]}"
}

# The retired rules the settings file still holds; none when it is missing.
allow_retired() {
  [[ -e "$CLAUDE_HOME/settings.json" ]] || return 0
  _allow_query '($want - ($want - $have))[]' "${RETIRED_ALLOW_RULES[@]}"
}

# 0 when the rules can be read; 1 after a skip line for a machine without jq;
# 2 after a warning for an incomplete kit without the JSON helpers in lib/.
allow_readable() {
  local settings="$CLAUDE_HOME/settings.json"
  if ! declare -f wk_jq wk_json_edit_or_create >/dev/null 2>&1; then
    wk_warn "allow: the JSON helpers in $(wk_native_path "$SCRIPT_DIR/lib") are missing, so the kit's allow rules in $(wk_native_path "$settings") cannot be $1; the kit is incomplete"
    return 2
  fi
  if ! command -v jq >/dev/null 2>&1; then
    wk_skip "allow: no jq on this machine, so the kit's allow rules in $(wk_native_path "$settings") cannot be $1"
    return 1
  fi
}

# The command that puts the rules back: the cloud's setup is `--cloud`.
allow_fix() {
  if wk_is_cloud; then printf 'workkit setup --cloud'; else printf 'workkit setup'; fi
}

# setup's step, inside machine_links: the missing rules appended to
# permissions.allow and the retired ones taken out, every other key kept in its
# order, and a file already right never written. The automatic path makes no
# ~/.claude, as the links make no ~/.local/bin; a human's run may.
keep_allow_rules() {
  local settings="$CLAUDE_HOME/settings.json" missing retired add drop
  if [[ "$QUIET" -eq 1 && ! -d "$CLAUDE_HOME" ]]; then
    return 0
  fi
  allow_readable kept || return 0
  # Quiet under --auto, as script_shell's foreign value is: the daily run
  # would repeat it every morning; a human's run and doctor still say it.
  if ! missing="$(allow_missing)" || ! retired="$(allow_retired)"; then
    [[ "$QUIET" -eq 1 ]] || wk_warn "allow: $(wk_native_path "$settings") is not JSON with a list at permissions.allow, so it was left as it is; fix it, then re-run \`$(allow_fix)\`"
    return 0
  fi
  if [[ -z "$missing" && -z "$retired" ]]; then
    wk_skip "allow: $(wk_native_path "$settings") holds the kit's allow rules"
    return 0
  fi

  add="$(printf '%s' "$missing" | wk_jq -cRn '[inputs]')"
  drop="$(printf '%s' "$retired" | wk_jq -cRn '[inputs]')"
  mkdir -p "$CLAUDE_HOME" 2>/dev/null || true
  if wk_json_edit_or_create "$settings" --argjson add "$add" --argjson drop "$drop" \
    '.permissions.allow = ((.permissions.allow // []) - $drop + $add)'; then
    [[ -z "$missing" ]] || wk_ok "allow: added ${missing//$'\n'/, } to $(wk_native_path "$settings")"
    [[ -z "$retired" ]] || wk_ok "allow: took the retired ${retired//$'\n'/, } out of $(wk_native_path "$settings")"
  fi
}

# doctor's lines: one warning per missing rule and per retired rule still held,
# each an item needing attention, and nothing when the list is right. Returns the count.
report_allow_rules() {
  local settings="$CLAUDE_HOME/settings.json" missing retired rule count=0 rc=0
  allow_readable read || rc=$?
  [[ "$rc" -eq 2 ]] && return 1
  [[ "$rc" -eq 0 ]] || return 0
  local fix
  fix="$(allow_fix)"
  if ! missing="$(allow_missing)" || ! retired="$(allow_retired)"; then
    wk_warn "allow: $(wk_native_path "$settings") is not JSON with a list at permissions.allow, so the kit's allow rules cannot be read; fix it, then run \`$fix\`"
    return 1
  fi
  while IFS= read -r rule; do
    [[ -n "$rule" ]] || continue
    wk_warn "allow: $rule is missing from $(wk_native_path "$settings"); run \`$fix\`"
    count=$((count + 1))
  done <<<"$missing"
  while IFS= read -r rule; do
    [[ -n "$rule" ]] || continue
    wk_warn "allow: $rule is a retired kit rule in $(wk_native_path "$settings"); run \`$fix\` to take it out"
    count=$((count + 1))
  done <<<"$retired"
  return "$count"
}
