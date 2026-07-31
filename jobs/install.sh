#!/usr/bin/env bash
# Install this checkout's LaunchAgent — the 9am daily job, which writes the
# summaries and then the brief. Renders jobs/<label>.plist ({{WORKKIT_DIR}} /
# {{HOME}}) into ~/Library/LaunchAgents/ and (re)loads it — only when something
# changed.
# Usage: bash jobs/install.sh [--check]
#
# Copied, never symlinked: launchd expands nothing (the plist needs absolute
# paths baked in) and `launchctl bootstrap` is unreliable with symlinked plists.
# Idempotent — a second run with the same checkout does nothing but confirm the
# agents are loaded.
#
# `--check` is the same render and compare with nothing written and launchd
# never asked: it prints one line per agent that is missing or out of date, and
# nothing at all when the machine matches this checkout. That is what makes
# `workkit update --auto` cheap enough to run at every session start — the drift
# question is answered here, so the CLI carries no second copy of what a current
# install looks like.
#
# launchd is MACHINE-GLOBAL: `launchctl bootstrap gui/$UID <plist>` registers
# whatever plist it is handed, scratch HOME or not, so a rehearsal under a fake
# home would rewire the real 9am job. Every launchctl call is therefore made
# only when $HOME is this account's real home; anywhere else the run renders,
# lints, copies into that fake home and prints what it WOULD have loaded.
# `WORKKIT_LAUNCHD_OK=1` forces the calls anyway — that is the test suite's door,
# and the only one.

set -euo pipefail

MODE="install"
case "${1:-}" in
  --check) MODE="check"; shift ;;
  -h|--help) printf 'usage: install.sh [--check]\n'; exit 0 ;;
  --*) printf 'usage: install.sh [--check]\n' >&2; exit 1 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKKIT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT

# The physical path of a directory — a symlinked HOME must not read as a
# different home than the one the account record names.
physical() { (cd "$1" 2>/dev/null && pwd -P); }

# What the account record says this user's home is. Anything else — dscl absent,
# the record unreadable, the key missing — answers nothing, and an unverified
# home is treated as not this account's.
account_home() {
  dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null \
    | awk '/^NFSHomeDirectory:/ { $1 = ""; sub(/^ /, ""); print; exit }'
}

# May this run talk to launchd?
launchd_allowed() {
  [[ "${WORKKIT_LAUNCHD_OK:-}" == "1" ]] && return 0
  local here there
  here="$(physical "$HOME")" || return 1
  there="$(account_home)"
  [[ -n "$there" ]] || return 1
  there="$(physical "$there")" || return 1
  [[ -n "$here" && "$here" == "$there" ]]
}

# `--check` never asks launchd anything, so it never asks this question either.
LAUNCHD_OK=0
if [[ "$MODE" == "install" ]] && launchd_allowed; then
  LAUNCHD_OK=1
fi

# Usage: skip_launchd <label> <what it would have done>
skip_launchd() {
  printf "%s → would %s (skipped: HOME is not this account's home; set WORKKIT_LAUNCHD_OK=1 to force)\n" "$1" "$2"
}

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

  if [[ "$MODE" == "check" ]]; then
    if [[ ! -f "$TARGET" ]]; then
      printf '%s → not installed\n' "$LABEL"
    elif ! cmp -s "$RENDERED" "$TARGET"; then
      printf '%s → out of date for this checkout\n' "$LABEL"
    fi
    return 0
  fi

  if [[ -f "$TARGET" ]] && cmp -s "$RENDERED" "$TARGET"; then
    if (( ! LAUNCHD_OK )); then
      skip_launchd "$LABEL" 'bootstrap it (plist unchanged)'
      return 0
    fi

    local PRINTED LOADED
    if ! PRINTED="$(launchctl print "gui/$UID/$LABEL" 2>/dev/null)"; then
      launchctl bootstrap "gui/$UID" "$TARGET"
      printf '%s → loaded (plist unchanged)\n' "$LABEL"
      return 0
    fi

    # Loaded is not the same as loaded from THIS plist: a run under a scratch
    # HOME registers the label against a temp path that is then deleted, and the
    # label stays claimed by a file that no longer exists. So the loaded path is
    # compared with the one we install, and anything else — including output
    # that carries no readable path — is re-registered rather than reported
    # current.
    LOADED="$(printf '%s\n' "$PRINTED" | sed -n 's/^[[:space:]]*path = //p' | head -n 1)"
    if [[ "$LOADED" == "$TARGET" ]]; then
      printf '%s → already installed and loaded\n' "$LABEL"
      return 0
    fi

    launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$UID" "$TARGET"
    printf '%s → reloaded (was registered from %s)\n' "$LABEL" "${LOADED:-an unreadable path}"
    return 0
  fi

  mkdir -p "$(dirname "$TARGET")"
  cp "$RENDERED" "$TARGET"

  if (( ! LAUNCHD_OK )); then
    printf '%s → installed, not loaded (%s)\n' "$LABEL" "$WHEN"
    skip_launchd "$LABEL" 'bootout and bootstrap it'
    return 0
  fi

  # An agent already loaded from the previous plist has to go before the new one
  # can take its label. A first install has nothing to remove, so the failure is
  # expected and ignored.
  launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$TARGET"
  printf '%s → installed and loaded (%s)\n' "$LABEL" "$WHEN"
}

install_agent 'com.workkit.claude-daily' '9:00 AM daily'
