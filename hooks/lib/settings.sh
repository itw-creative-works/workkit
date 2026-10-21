#!/bin/bash
# hooks/lib/settings.sh: the one-key read of the two workkit settings files,
# the repo's over the machine's (workflow/README.md § The two settings files),
# and the findings.file predicate and route sentence read through it.
# SOURCED by hooks/_lib.sh, never executed: it defines functions and sets
# nothing. It reads WORKKIT_DIR, hook_jq and wk_user_dir from the entry.

# hook_setting_get <jq path> <cwd>: the value in the .workkit/settings.json at
# <cwd>'s git root when the key is there, else the global file's, else nothing;
# a literal false is a value. A <cwd> in no repo leaves the global file alone,
# and an unreadable file adds nothing.
hook_setting_get() {
  local cwd="${2:?hook_setting_get: a cwd is required}" root file value
  command -v jq >/dev/null 2>&1 || return 0
  root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)
  for file in ${root:+"$root/$WORKKIT_DIR/settings.json"} "$(wk_user_dir)/settings.json"; do
    [ -f "$file" ] || continue
    value=$(hook_jq -r "$1 | select(. != null)" "$file" 2>/dev/null || true)
    if [ -n "$value" ]; then
      printf '%s\n' "$value"
      return 0
    fi
  done
}

# hook_findings_on <cwd>: is findings.file on for <cwd>? Off unless a settings
# file says true (docs/project-state.md § How big is one issue).
hook_findings_on() {
  [ "$(hook_setting_get '.findings.file' "$1")" = "true" ]
}

# hook_findings_route <cwd>: the one sentence naming where a finding outside the
# issue in hand goes: a status:inbox issue while findings.file is on, said in
# chat under 🧭 Findings for the owner to answer file or drop while it is off.
hook_findings_route() {
  if hook_findings_on "$1"; then
    echo "File a finding as a status:inbox issue with gh instead; where GitHub cannot be reached, put it in chat and let the owner decide."
  else
    echo "Say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own."
  fi
}
