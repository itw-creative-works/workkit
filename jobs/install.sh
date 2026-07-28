#!/usr/bin/env bash
# Install this checkout's LaunchAgent — the 9am daily job, which writes the
# summaries and then the brief. Renders jobs/<label>.plist ({{WORKKIT_DIR}} /
# {{HOME}}) into ~/Library/LaunchAgents/ and (re)loads it — only when something
# changed — and removes the retired 3am agent if this machine still carries it.
# Usage: bash jobs/install.sh
#
# Copied, never symlinked: launchd expands nothing (the plist needs absolute
# paths baked in) and `launchctl bootstrap` is unreliable with symlinked plists.
# Idempotent — a second run with the same checkout does nothing but confirm the
# agents are loaded.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKKIT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT

# Render, compare, and only on change copy and reload.
# Usage: install_agent <label> <schedule description>
install_agent() {
  local LABEL="$1" WHEN="$2"
  local TEMPLATE="$SCRIPT_DIR/$LABEL.plist"
  local TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

  if [[ ! -f "$TEMPLATE" ]]; then
    printf 'template missing: %s\n' "$TEMPLATE" >&2
    exit 1
  fi

  sed -e "s|{{WORKKIT_DIR}}|$WORKKIT_DIR|g" -e "s|{{HOME}}|$HOME|g" "$TEMPLATE" > "$RENDERED"

  if ! plutil -lint "$RENDERED" >/dev/null 2>&1; then
    printf '%s → rendered plist fails plutil -lint\n' "$LABEL" >&2
    exit 1
  fi

  if [[ -f "$TARGET" ]] && cmp -s "$RENDERED" "$TARGET"; then
    if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
      printf '%s → already installed and loaded\n' "$LABEL"
    else
      launchctl bootstrap "gui/$UID" "$TARGET"
      printf '%s → loaded (plist unchanged)\n' "$LABEL"
    fi
    return 0
  fi

  mkdir -p "$(dirname "$TARGET")"
  cp "$RENDERED" "$TARGET"

  # An agent already loaded from the previous plist has to go before the new one
  # can take its label. A first install has nothing to remove, so the failure is
  # expected and ignored.
  launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$TARGET"
  printf '%s → installed and loaded (%s)\n' "$LABEL" "$WHEN"
}

# An agent this checkout no longer ships. The 3am summaries run inside the 9am
# job now, so a machine installed before that has one agent too many: unload it
# and remove its plist. Idempotent and silent when there is nothing to retire.
# Usage: retire_agent <label>
retire_agent() {
  local LABEL="$1"
  local TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
  local RETIRED=0

  if launchctl print "gui/$UID/$LABEL" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
    RETIRED=1
  fi
  if [[ -f "$TARGET" ]]; then
    rm -f "$TARGET"
    RETIRED=1
  fi

  (( RETIRED == 1 )) && printf '%s → retired (unloaded and removed)\n' "$LABEL"
  return 0
}

install_agent 'com.workkit.claude-daily' '9:00 AM daily'
retire_agent 'com.workkit.claude-nightly'
