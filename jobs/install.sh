#!/usr/bin/env bash
# Install the 9am daily-brief LaunchAgent for THIS checkout.
# Renders jobs/com.workkit.claude-daily.plist ({{WORKKIT_DIR}} / {{HOME}}) into
# ~/Library/LaunchAgents/ and (re)loads it — only when something changed.
# Usage: bash jobs/install.sh
#
# Copied, never symlinked: launchd expands nothing (the plist needs absolute
# paths baked in) and `launchctl bootstrap` is unreliable with symlinked plists.
# Idempotent — a second run with the same checkout does nothing but confirm the
# agent is loaded.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKKIT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LABEL='com.workkit.claude-daily'
TEMPLATE="$SCRIPT_DIR/$LABEL.plist"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ ! -f "$TEMPLATE" ]]; then
  printf 'template missing: %s\n' "$TEMPLATE" >&2
  exit 1
fi

RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT
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
  exit 0
fi

mkdir -p "$(dirname "$TARGET")"
cp "$RENDERED" "$TARGET"

# An agent already loaded from the previous plist has to go before the new one
# can take its label. A first install has nothing to remove, so the failure is
# expected and ignored.
launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$TARGET"
printf '%s → installed and loaded (9:00 AM daily)\n' "$LABEL"
