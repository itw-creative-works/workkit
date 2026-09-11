#!/usr/bin/env bash
# Install this checkout's LaunchAgent: the 9am daily job, which writes the
# summaries and then the brief. Renders jobs/<label>.plist ({{WORKKIT_DIR}} /
# {{HOME}}) into ~/Library/LaunchAgents/ and (re)loads it, only when something
# changed.
# Usage: bash jobs/install.sh [--check]
#
# Copied, never symlinked: launchd expands nothing (the plist needs absolute
# paths baked in) and `launchctl bootstrap` is unreliable with symlinked plists.
# Idempotent: a second run with the same checkout does nothing but confirm the
# agents are loaded.
#
# `--check` is the same render and compare with nothing written and launchd
# never asked: it prints one line per agent that is missing or out of date, and
# nothing at all when the machine matches this checkout. That is what makes
# `workkit update --auto` cheap enough to run at every session start: the drift
# question is answered here, so the CLI carries no second copy of what a current
# install looks like.
#
# launchd is MACHINE-GLOBAL: `launchctl bootstrap gui/$UID <plist>` registers
# whatever plist it is handed, scratch HOME or not, so a rehearsal under a fake
# home would rewire the real 9am job. Every launchctl call is therefore made
# only when $HOME is this account's real home; anywhere else the run renders,
# lints, copies into that fake home and prints what it WOULD have loaded.
# `WORKKIT_LAUNCHD_OK=1` forces the calls anyway: that is the test suite's door,
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

# The engine's voice (issue #237). Every line below opens with a glyph;
# `workkit update` relays them under its own, stripping this one, so a line
# never wears two.
# shellcheck source=../workflow/lib.sh
. "$WORKKIT_DIR/workflow/lib.sh"

RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT

# The physical path of a directory: a symlinked HOME must not read as a
# different home than the one the account record names.
physical() { (cd "$1" 2>/dev/null && pwd -P); }

# What the account record says this user's home is. Anything else (dscl absent,
# the record unreadable, the key missing) answers nothing, and an unverified
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
  wk_ok "$1 → would $2 (skipped: HOME is not this account's home; set WORKKIT_LAUNCHD_OK=1 to force)"
}

# Render, compare, and only on change copy and reload.
# Usage: install_agent <label> <schedule description>
install_agent() {
  local LABEL="$1" WHEN="$2"
  local TEMPLATE="$SCRIPT_DIR/$LABEL.plist"
  local TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"

  if [[ ! -f "$TEMPLATE" ]]; then
    wk_error "template missing: $TEMPLATE"
    exit 1
  fi

  sed -e "s|{{WORKKIT_DIR}}|$WORKKIT_DIR|g" -e "s|{{HOME}}|$HOME|g" "$TEMPLATE" > "$RENDERED"

  if ! plutil -lint "$RENDERED" >/dev/null 2>&1; then
    wk_error "$LABEL → rendered plist fails plutil -lint"
    exit 1
  fi

  if [[ "$MODE" == "check" ]]; then
    if [[ ! -f "$TARGET" ]]; then
      wk_ok "$LABEL → not installed"
    elif ! cmp -s "$RENDERED" "$TARGET"; then
      wk_ok "$LABEL → out of date for this checkout"
    fi
    return 0
  fi

  if [[ -f "$TARGET" ]] && cmp -s "$RENDERED" "$TARGET"; then
    if (( ! LAUNCHD_OK )); then
      skip_launchd "$LABEL" 'bootstrap it (plist unchanged)'
      return 0
    fi

    local PRINTED LOADED
    if ! PRINTED="$(wk_spin "reading the loaded agent" launchctl print "gui/$UID/$LABEL" 2>/dev/null)"; then
      wk_spin "loading $LABEL" launchctl bootstrap "gui/$UID" "$TARGET" >/dev/null 2>&1
      wk_ok "$LABEL → loaded (plist unchanged)"
      return 0
    fi

    # Loaded is not the same as loaded from THIS plist: a run under a scratch
    # HOME registers the label against a temp path that is then deleted, and the
    # label stays claimed by a file that no longer exists. So the loaded path is
    # compared with the one we install, and anything else (including output
    # that carries no readable path) is re-registered rather than reported
    # current.
    LOADED="$(printf '%s\n' "$PRINTED" | sed -n 's/^[[:space:]]*path = //p' | head -n 1)"
    if [[ "$LOADED" == "$TARGET" ]]; then
      wk_ok "$LABEL → already installed and loaded"
      return 0
    fi

    wk_spin "unloading $LABEL" launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
    wk_spin "loading $LABEL" launchctl bootstrap "gui/$UID" "$TARGET" >/dev/null 2>&1
    wk_ok "$LABEL → reloaded (was registered from ${LOADED:-an unreadable path})"
    return 0
  fi

  mkdir -p "$(dirname "$TARGET")"
  cp "$RENDERED" "$TARGET"

  if (( ! LAUNCHD_OK )); then
    wk_ok "$LABEL → installed, not loaded ($WHEN)"
    skip_launchd "$LABEL" 'bootout and bootstrap it'
    return 0
  fi

  # An agent already loaded from the previous plist has to go before the new one
  # can take its label. A first install has nothing to remove, so the failure is
  # expected and ignored. Both calls are silenced, the wait line included: what
  # this step SAYS is the one `wk_ok` under it, and `workkit update` relays
  # every line this script prints (issue #237).
  wk_spin "unloading $LABEL" launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
  wk_spin "loading $LABEL" launchctl bootstrap "gui/$UID" "$TARGET" >/dev/null 2>&1
  wk_ok "$LABEL → installed and loaded ($WHEN)"
}

install_agent 'com.workkit.claude-daily' '9:00 AM daily'
