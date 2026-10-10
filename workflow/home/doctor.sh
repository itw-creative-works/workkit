#!/usr/bin/env bash
# workflow/home/doctor.sh: the doctor lines for the home clone and the cloud
# brief's runner, checked and never written. Sourced by home.sh, functions only.
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

  # Asked first: a checkout older than the clone's stamp writes nothing, so
  # every answer below would be about a clone it cannot write to.
  wk_home_downgrades && return 1

  # `git status -sb` answers ahead, behind and diverged without a network call.
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

# The cloud brief's runner, read only: drift the last morning's reconcile could
# not heal, fixed by `workkit setup`. Returns 1 when the seeded copy is behind,
# 0 otherwise (current, or a skip).
wk_home_runner_doctor() {
  local pair src dest scratch kit behind=0 compared=0 retired=0

  wk_home_ready || {
    wk_skip "runner: no home clone at $WK_HOME_DIR; nothing to compare the cloud brief's runner against"
    return 0
  }
  [[ -n "$WK_KIT_DIR" && -d "$WK_KIT_DIR" ]] || {
    wk_skip "runner: the kit could not be resolved beside this engine; the cloud brief's runner cannot be compared"
    return 0
  }
  scratch="$(mktemp -d)" || {
    wk_skip "runner: could not make a scratch directory; the cloud brief's runner cannot be compared"
    return 0
  }
  # The export's own warning is the seed's voice; here a failure is a skip.
  kit="$(wk_home_source "$scratch" "$WK_KIT_DIR" 2>/dev/null)" || {
    rm -rf "$scratch"
    wk_skip "runner: could not export the committed kit from $WK_KIT_DIR; the cloud brief's runner cannot be compared"
    return 0
  }

  for pair in "${WK_HOME_RUNNER_FILES[@]}"; do
    src="$kit/${pair%%:*}"
    dest="$WK_HOME_DIR/${pair#*:}"
    [[ -f "$src" ]] || continue
    compared=$((compared + 1))
    cmp -s "$src" "$dest" 2>/dev/null || behind=$((behind + 1))
  done
  rm -rf "$scratch"

  if [[ "$compared" -eq 0 ]]; then
    wk_skip "runner: this kit carries none of the cloud brief's runner files; nothing to compare"
    return 0
  fi

  # A retired file awaiting the prune is drift too, counted through the lister
  # the seed removes from.
  retired=$(wk_home_runner_retired | awk 'END { print NR }')

  if [[ "$behind" -gt 0 || "$retired" -gt 0 ]]; then
    local detail="$behind of $compared file(s) differ"
    [[ "$retired" -gt 0 ]] && detail="$detail, $retired retired file(s) await pruning"
    wk_warn "runner: the home repo's brief runner is behind this kit ($detail); run \`workkit setup\`"
    return 1
  fi
  wk_ok "runner: the cloud brief's runner in $WK_HOME_DIR is current with this kit"
  return 0
}
