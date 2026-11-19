#!/usr/bin/env bash
# workflow/workkit/allow.sh: the allow and ask rules the kit keeps in the global
# Claude settings, and the setup and doctor steps that keep them there.
# Sourced by workkit.sh, functions only.

# _allow_fill <allow|ask>: the rule of each WORKKIT_COMMANDS entry with that
# permission (command-list.sh, sourced first), appended to ALLOW_RULES or ASK_RULES.
_allow_fill() {
  local command rule
  while IFS= read -r command; do
    rule="Bash(workkit $command:*)"
    if [[ "$1" == allow ]]; then ALLOW_RULES+=("$rule"); else ASK_RULES+=("$rule"); fi
  done < <(wk_commands_with "$1")
}

# Kept at permissions.allow: one rule per `allow` entry, then npm's publish the ship runs.
ALLOW_RULES=()
_allow_fill allow
ALLOW_RULES+=('Bash(npm publish:*)')

# Kept at permissions.ask, one rule per `ask` entry, maybe none: an ask rule beats
# an allow rule, in auto mode too, so Claude Code asks at every such call, inside a ship as well.
ASK_RULES=()
_allow_fill ask

# Rules the kit once kept and every run takes out: the whole ship verb's rule
# let `workkit ship deploy` through with no prompt.
RETIRED_ALLOW_RULES=('Bash(workkit ship:*)')

# _allow_query <key> <filter> <rules...>: <filter> over the settings file with
# the rules as $want, one result per line. 1 when it is not one JSON object with
# a list (or nothing) at permissions.<key>. Needs jq and lib/; allow_readable checks.
_allow_query() {
  local settings="$CLAUDE_HOME/settings.json" key="$1" filter="$2" want out
  shift 2
  want="$(printf '%s\n' "$@" | wk_jq -cRn '[inputs]')"
  # Slurped, so an empty file is a refusal rather than a file holding nothing.
  out="$(wk_jq -rs --arg key "$key" --argjson want "$want" \
    "if length == 1 then (.[0].permissions[\$key] // []) as \$have | $filter else error(\"not one value\") end" \
    "$settings" 2>/dev/null)" || return 1
  [[ -z "$out" ]] || printf '%s\n' "$out"
}

# allow_missing <key> <rules...>: the rules permissions.<key> lacks, one per
# line in the list's order; all of them when the settings file is missing.
allow_missing() {
  local key="$1"
  shift
  [[ "$#" -gt 0 ]] || return 0
  if [[ ! -e "$CLAUDE_HOME/settings.json" ]]; then
    printf '%s\n' "$@"
    return 0
  fi
  _allow_query "$key" '($want - $have)[]' "$@"
}

# The retired rules the settings file still holds; none when it is missing.
allow_retired() {
  [[ -e "$CLAUDE_HOME/settings.json" ]] || return 0
  _allow_query allow '($want - ($want - $have))[]' "${RETIRED_ALLOW_RULES[@]}"
}

# The caller's missing, asks and retired, set to the allow rules missing, the
# ask rules missing and the retired rules held; call it directly, never inside
# `$(...)`. 1 after setting the caller's bad to the key holding no list.
allow_lists() {
  bad=allow
  missing="$(allow_missing allow "${ALLOW_RULES[@]}")" || return 1
  retired="$(allow_retired)" || return 1
  bad=ask
  # The `+` form: bash 3.2 under set -u calls an empty list's "${ASK_RULES[@]}" unbound.
  asks="$(allow_missing ask ${ASK_RULES[@]+"${ASK_RULES[@]}"})" || return 1
  bad=''
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
# permissions.allow and permissions.ask in one write and the retired ones taken
# out, every other key kept in its order, and a file already right never written.
# The automatic path makes no ~/.claude, as the links make no ~/.local/bin; a human's run may.
keep_allow_rules() {
  local settings="$CLAUDE_HOME/settings.json" missing asks retired bad add ask drop
  if [[ "$QUIET" -eq 1 && ! -d "$CLAUDE_HOME" ]]; then
    return 0
  fi
  allow_readable kept || return 0
  # Quiet under --auto, as script_shell's foreign value is: the daily run
  # would repeat it every morning; a human's run and doctor still say it.
  if ! allow_lists; then
    [[ "$QUIET" -eq 1 ]] || wk_warn "allow: $(wk_native_path "$settings") is not JSON with a list at permissions.$bad, so it was left as it is; fix it, then re-run \`$(allow_fix)\`"
    return 0
  fi
  if [[ -z "$missing" && -z "$asks" && -z "$retired" ]]; then
    wk_skip "allow: $(wk_native_path "$settings") holds the kit's allow rules"
    return 0
  fi

  add="$(printf '%s' "$missing" | wk_jq -cRn '[inputs]')"
  ask="$(printf '%s' "$asks" | wk_jq -cRn '[inputs]')"
  drop="$(printf '%s' "$retired" | wk_jq -cRn '[inputs]')"
  mkdir -p "$CLAUDE_HOME" 2>/dev/null || true
  # An allow list with nothing to add is assigned to itself, so its key stays in
  # place; an ask list is assigned only when it gains a rule, so none is made empty.
  if wk_json_edit_or_create "$settings" --argjson add "$add" --argjson ask "$ask" --argjson drop "$drop" \
    '.permissions.allow = ((.permissions.allow // []) - $drop + $add) | if $ask == [] then . else .permissions.ask = ((.permissions.ask // []) + $ask) end'; then
    [[ -z "$missing" ]] || wk_ok "allow: added ${missing//$'\n'/, } to $(wk_native_path "$settings")"
    [[ -z "$asks" ]] || wk_ok "allow: added ${asks//$'\n'/, } to permissions.ask in $(wk_native_path "$settings")"
    [[ -z "$retired" ]] || wk_ok "allow: took the retired ${retired//$'\n'/, } out of $(wk_native_path "$settings")"
  fi
}

# doctor's lines: one warning per missing allow or ask rule and per retired rule
# still held, each an item needing attention, and nothing when the lists are right.
# Returns the count.
report_allow_rules() {
  local settings="$CLAUDE_HOME/settings.json" missing asks retired bad rule count=0 rc=0
  allow_readable read || rc=$?
  [[ "$rc" -eq 2 ]] && return 1
  [[ "$rc" -eq 0 ]] || return 0
  local fix
  fix="$(allow_fix)"
  if ! allow_lists; then
    wk_warn "allow: $(wk_native_path "$settings") is not JSON with a list at permissions.$bad, so the kit's allow rules cannot be read; fix it, then run \`$fix\`"
    return 1
  fi
  while IFS= read -r rule; do
    [[ -n "$rule" ]] || continue
    wk_warn "allow: $rule is missing from $(wk_native_path "$settings"); run \`$fix\`"
    count=$((count + 1))
  done <<<"$missing"
  while IFS= read -r rule; do
    [[ -n "$rule" ]] || continue
    wk_warn "allow: $rule is missing from permissions.ask in $(wk_native_path "$settings"); run \`$fix\`"
    count=$((count + 1))
  done <<<"$asks"
  while IFS= read -r rule; do
    [[ -n "$rule" ]] || continue
    wk_warn "allow: $rule is a retired kit rule in $(wk_native_path "$settings"); run \`$fix\` to take it out"
    count=$((count + 1))
  done <<<"$retired"
  return "$count"
}
