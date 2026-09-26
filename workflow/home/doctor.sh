#!/usr/bin/env bash
# workflow/home/doctor.sh: the doctor lines. The home clone's state and the
# cloud brief's runner, checked and never written. SOURCED by home.sh, never
# executed, and it runs nothing at load: it defines functions and sets nothing.
# WK_HOME_RUNNER_FILES and WK_KIT_DIR are the entry's; WK_HOME_DIR is lib.sh's.

# ── Doctor ────────────────────────────────────────────────────────────────────

# The home clone's state, in the voice of whoever called. Returns the number of
# things needing attention, which is what `workkit doctor` counts.
wk_home_doctor() {
  local slug state track

  slug="$(wk_home_slug)"
  state="$(wk_home_state)"
  case "$state" in
    unset)
      wk_info "home: not set; \`workkit setup\` creates the private home repo and clones it into $WK_HOME_DIR"
      return 0 ;;
    absent)
      wk_warn "home: $slug is configured but nothing is cloned at $WK_HOME_DIR; run \`workkit setup\` to clone and seed it"
      return 1 ;;
    other)
      local sitting
      sitting="$(wk_home_clone_slug)"
      if [[ -n "$sitting" ]]; then
        wk_warn "home: $WK_HOME_DIR is a git repo pointing at $sitting, not $slug; move it aside, then run \`workkit setup\`"
      else
        wk_warn "home: $WK_HOME_DIR exists and is not a clone of $slug; move it aside, then run \`workkit setup\`"
      fi
      return 1 ;;
  esac

  # A checkout OLDER than what the clone carries: the seed and the sync both
  # refuse to write from here (issue #200), so nothing this machine does reaches
  # the home repo until it catches up. Asked FIRST: every answer below it is
  # about a clone this checkout may no longer write to.
  wk_home_downgrades && return 1

  # A clone. The only question left is where it stands against its upstream, and
  # `git status -sb` answers all three without a network call.
  track="$(git -C "$WK_HOME_DIR" status -sb 2>/dev/null | head -1 || true)"
  if [[ "$track" == *'[ahead '*'behind '* ]]; then
    wk_warn "home: $slug has diverged from its upstream; \`git -C $WK_HOME_DIR pull --rebase\` on a clean tree reconciles it; the engine never force-pushes"
    return 1
  fi
  if [[ "$track" == *'[ahead '* ]]; then
    wk_info "home: $slug is a clone with unpushed commits; the daily publish pushes them"
    return 0
  fi
  if [[ "$track" == *'[behind '* ]]; then
    wk_warn "home: $slug is behind its upstream; \`git -C $WK_HOME_DIR pull --rebase\` catches it up"
    return 1
  fi
  wk_ok "home: $slug; $WK_HOME_DIR is its clone"
  return 0
}

# The cloud brief's runner, checked rather than written (issue #91).
#
# Since issue #143 the morning reconciles the copy itself (`jobs/morning/runner.sh`
# calls `wk_home_seed_runner` every day, ahead of the dispatch) so what this
# reports is drift the last morning could not heal: a machine whose job has not
# run yet, or one whose home clone the reconcile named a skip on. It only ever
# READS, and the fix it names is `workkit setup`, the one command that also
# clones and creates.
#
# Returns 1 when the seeded copy is behind, 0 otherwise (current, or a skip).
wk_home_runner_doctor() {
  local pair src dest behind=0 compared=0 retired=0

  wk_home_ready || {
    wk_skip "runner: no home clone at $WK_HOME_DIR; nothing to compare the cloud brief's runner against"
    return 0
  }
  [[ -n "$WK_KIT_DIR" && -d "$WK_KIT_DIR" ]] || {
    wk_skip "runner: the plugin checkout could not be resolved beside this engine; the cloud brief's runner cannot be compared"
    return 0
  }

  for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
    src="$WK_KIT_DIR/${pair%%:*}"
    dest="$WK_HOME_DIR/${pair#*:}"
    [[ -f "$src" ]] || continue
    compared=$((compared + 1))
    cmp -s "$src" "$dest" 2>/dev/null || behind=$((behind + 1))
  done

  if [[ "$compared" -eq 0 ]]; then
    wk_skip "runner: this checkout carries none of the cloud brief's runner files; nothing to compare"
    return 0
  fi

  # Current means what the seed would leave alone, so a retired file awaiting
  # the prune is drift too, counted through the same lister the seed removes
  # from (#117).
  retired=$(wk_home_runner_retired | awk 'END { print NR }')

  if [[ "$behind" -gt 0 || "$retired" -gt 0 ]]; then
    local detail="$behind of $compared file(s) differ"
    [[ "$retired" -gt 0 ]] && detail="$detail, $retired retired file(s) await pruning"
    wk_warn "runner: the home repo's brief runner is behind this checkout ($detail); run \`workkit setup\`"
    return 1
  fi
  wk_ok "runner: the cloud brief's runner in $WK_HOME_DIR is current with this checkout"
  return 0
}
