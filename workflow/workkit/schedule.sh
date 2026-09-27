#!/usr/bin/env bash
# workflow/workkit/schedule.sh: the 9am schedule, its drift against this
# checkout, the installer run, the update that keeps an installed schedule
# current, and the first install that only `setup` makes. Sourced by
# workkit.sh, functions only; JOBS_INSTALL, DAILY_PLIST and DAILY_LABEL are the
# entry's.

# What the installed schedule differs from this checkout in, one line per
# agent, empty when current. A missing installer or an unfinished check prints
# its reason and returns 1, so neither reads as current.
cron_drift() {
  if [[ ! -f "$JOBS_INSTALL" ]]; then
    printf 'the installer is missing at %s; this checkout is incomplete\n' "$JOBS_INSTALL"
    return 1
  fi
  bash "$JOBS_INSTALL" --check 2>/dev/null | wk_plain || {
    printf 'the drift check did not finish; run `bash %s --check` to see why\n' "$JOBS_INSTALL"
    return 1
  }
}

# Run the installer and relay only what it did, in its own words. A failure is
# reported and swallowed: under a session-start hook that discards stderr, a
# `set -e` abort would be invisible.
run_installer() {
  local out rc=0
  out="$(bash "$JOBS_INSTALL" 2>&1)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    wk_warn "schedule: the install did not finish (exit $rc); run \`bash $JOBS_INSTALL\` to see why"
    return 0
  fi
  # "already installed and loaded" is the installer confirming a no-op; every
  # other line is something it did.
  printf '%s\n' "$out" | wk_plain | grep -v 'already installed and loaded' | grep -v '^[[:space:]]*$' \
    | while IFS= read -r line; do wk_ok "schedule: $line"; done || true
}

# Re-render and reload only a schedule the machine already has: installing one
# is a human's decision, made in `setup`.
update_cron() {
  local drift
  if [[ "$(uname -s)" != "Darwin" ]]; then
    wk_skip "schedule: launchd is macOS; nothing to keep current here"
    return 0
  fi
  if [[ ! -f "$DAILY_PLIST" ]]; then
    wk_info "schedule: not installed on this machine; \`workkit setup\` installs the 9am job"
    return 0
  fi

  if ! drift="$(cron_drift)"; then
    wk_warn "schedule: $drift"
    return 0
  fi
  if [[ -z "$drift" ]]; then
    wk_skip "schedule: $DAILY_LABEL is current"
    return 0
  fi

  run_installer
}

# The first install of the schedule happens only here, under `setup`, run by a
# human or by a ship; `update` keeps it current after.
install_cron() {
  local drift
  if [[ "$(uname -s)" != "Darwin" ]]; then
    wk_skip "schedule: launchd is macOS; the 9am job is not available here"
    return 0
  fi

  if [[ -f "$DAILY_PLIST" ]]; then
    # Already installed: the only question left is whether it still matches this
    # checkout, and a check that cannot answer stops the step rather than
    # reinstalling on a guess. Either way setup carries on: the steps after
    # this one have nothing to do with launchd.
    if ! drift="$(cron_drift)"; then
      wk_warn "schedule: $drift"
      return 0
    fi
    if [[ -z "$drift" ]]; then
      wk_skip "schedule: $DAILY_LABEL is installed and current"
      return 0
    fi
  elif [[ ! -f "$JOBS_INSTALL" ]]; then
    wk_warn "schedule: the installer is missing at $JOBS_INSTALL; this checkout is incomplete"
    return 0
  fi

  run_installer
}
