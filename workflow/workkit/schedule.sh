#!/usr/bin/env bash
# workflow/workkit/schedule.sh: the 9am schedule, its drift against the kit's
# job template, the installer run, the update that keeps an installed schedule
# current, and the first install that only `setup` makes. Sourced by
# workkit.sh, functions only; JOBS_INSTALL and DAILY_LABEL are the entry's.

# Whether this system has a scheduler the installer knows: a Mac's launchd, or
# Windows' Task Scheduler under Git Bash.
schedule_here() {
  case "$(uname -s)" in
    Darwin | MINGW* | MSYS* | CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# Whether a drift answer says the job is not installed on this machine.
drift_not_installed() {
  [[ $'\n'"$1"$'\n' == *$' → not installed\n'* ]]
}

# What the installed schedule differs from the kit's template in, one line per
# agent, empty when current. A missing installer or an unfinished check prints
# its reason and returns 1, so neither reads as current.
cron_drift() {
  if [[ ! -f "$JOBS_INSTALL" ]]; then
    printf 'the installer is missing at %s; the kit is incomplete\n' "$(wk_native_path "$JOBS_INSTALL")"
    return 1
  fi
  run_at_floor schedule 1 "$JOBS_INSTALL" --check 2>/dev/null | wk_plain || {
    printf 'the drift check did not finish; run `node %s --check` to see why\n' "$(wk_native_path "$JOBS_INSTALL")"
    return 1
  }
}

# Run the installer and relay only what it did, in its own words. A failure is
# reported and swallowed: under a session-start hook that discards stderr, a
# `set -e` abort would be invisible.
run_installer() {
  local out rc=0
  out="$(run_at_floor schedule 1 "$JOBS_INSTALL" 2>&1)" || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    wk_warn "schedule: the install did not finish (exit $rc); run \`node $(wk_native_path "$JOBS_INSTALL")\` to see why"
    return 0
  fi
  # "already installed" is the installer confirming a no-op; every other line
  # is something it did, and a warning stays a warning.
  printf '%s\n' "$out" | sed $'s/\033\\[[0-9;]*m//g' | grep -v ' → already installed' | grep -v '^[[:space:]]*$' \
    | while IFS= read -r line; do
        case "${line#"${line%%[![:space:]]*}"}" in
          '⚠ '*) wk_warn "schedule: $(printf '%s\n' "$line" | wk_plain)" ;;
          *) wk_ok "schedule: $(printf '%s\n' "$line" | wk_plain)" ;;
        esac
      done || true
}

# Re-render and reload only a schedule the machine already has: installing one
# is a human's decision, made in `setup`.
update_cron() {
  local drift
  if ! schedule_here; then
    wk_skip "schedule: the 9am job runs on macOS and Windows; nothing to keep current here"
    return 0
  fi

  if ! drift="$(cron_drift)"; then
    wk_warn "schedule: $drift"
    return 0
  fi
  if drift_not_installed "$drift"; then
    wk_info "schedule: not installed on this machine; \`workkit setup\` installs the 9am job"
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
  if ! schedule_here; then
    wk_skip "schedule: the 9am job runs on macOS and Windows; it is not available here"
    return 0
  fi

  # A check that cannot answer stops the step rather than installing on a
  # guess. Either way setup carries on: the steps after this one have nothing
  # to do with the scheduler.
  if ! drift="$(cron_drift)"; then
    wk_warn "schedule: $drift"
    return 0
  fi
  if [[ -z "$drift" ]]; then
    wk_skip "schedule: $DAILY_LABEL is installed and current"
    return 0
  fi

  run_installer
}
