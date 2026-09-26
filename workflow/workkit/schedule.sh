#!/usr/bin/env bash
# workflow/workkit/schedule.sh: the 9am schedule, its drift against this
# checkout, the installer run, the update that keeps an installed schedule
# current, and the first install that only `setup` makes. SOURCED by
# workkit.sh, never executed, and it runs nothing at load: it defines functions
# and sets nothing. Every name it reads (JOBS_INSTALL, DAILY_PLIST,
# DAILY_LABEL) is the entry's.

# What the installed schedule differs from this checkout in, one line per agent,
# and nothing at all when it is current. `install.sh --check` renders and
# compares without touching launchd, which is what keeps the daily run down to a
# couple of short shell invocations and no launchd call.
#
# Two failures must never read as "current": an installer this checkout does not
# have, and a check that could not finish. Both print their reason on stdout and
# return 1: the caller is in a command substitution, so the reason travels back
# with the status and is reported there.
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

# Run the installer and relay what it ACTUALLY did: one line per agent, in the
# installer's own words, so a run that changed nothing never claims to have
# reinstalled the 9am job. A failure is reported and swallowed: this
# runs inside a session-start hook that discards stderr, so an unguarded
# `set -e` abort here would be invisible and would retry silently every day.
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

# Re-render and reload the schedule, but ONLY on a machine that already has it:
# installing a cron is a decision, and `setup` is where a human makes it. The
# rest is install.sh's: it renders, compares, and reloads only on a difference.
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

# The FIRST install of the schedule, which only ever happens here, under
# `setup`: a human ran it, or a ship did after a green release (#235). `update`
# from then on keeps it current.
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
