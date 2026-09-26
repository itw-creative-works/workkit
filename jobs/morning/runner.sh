#!/usr/bin/env bash
# jobs/morning/runner.sh: the morning's second step, the cloud brief's seeded
# runner on the home repo reconciled from this checkout. SOURCED by morning.sh,
# never executed, and it runs nothing at load: it defines functions and sets
# nothing. Every name it reads (CLOUD, ENGINE and the note helpers) is the
# entry's; wk_plain is lib.sh's, which the entry sources.

# ── 2. The runner ─────────────────────────────────────────────────────────────

# The cloud brief runs SEEDED COPIES of these scripts on the home repo, and
# until issue #143 the only thing that ever refreshed them was `workkit setup`.
# A checkout that moved on left the cloud composing last month's brief with
# nothing to say so, which is how briefs went out for days without the stats
# line the tower's history charts read back.
#
# So the morning reconciles it, the way it already reconciles every other seeded
# surface: the tower project by the publish's sync, the home repo's labels and
# forms by its heal, this machine's schedule by `workkit update --auto`. A new
# seeded surface joins them here at birth.
#
# It runs BEFORE the dispatch, because the cloud run the dispatch starts is the
# consumer of what this step just pushed.
#
# THE MACHINE'S ALONE: on a runner `brief/` IS the scripts executing, and there
# is no checkout there to seed them from.
#
# Nothing is ever created, cloned or enabled here: that is setup's and only
# setup's (issue #71). A machine with no home clone hears a named line and the
# morning carries on, which is also what a push that did not land costs: the
# commit stays local and the next run pushes it.
reconcile_runner() {
  if (( CLOUD )); then
    note_skip 'runner: a runner IS the seeded copy of the cloud brief; there is no checkout here to reconcile it from, skipped'
    return 0
  fi
  if [[ ! -f "$ENGINE/lib.sh" || ! -f "$ENGINE/home.sh" ]]; then
    note_warn "runner: the engine libraries are missing at $ENGINE; the cloud brief's runner was not reconciled (a partial checkout)"
    return 0
  fi

  local output status=0
  # A subshell, and the libraries sourced inside it: they are sourced where they
  # are used, like brief-dispatch.sh in morning.sh, and this way their names never
  # outlive the one step that needs them and everything the step says lands in
  # the log block rather than on the scheduler's stdout.
  #
  # Two rules for bash 3.2 (the /bin/bash launchd runs) which re-parses this
  # substitution with a scanner of its own: apostrophes stay PAIRED per line,
  # comments included (an odd one reads as a quote opener and ends the
  # substitution early), and case patterns wear BOTH parens, `(x)` not `x)`
  # (a bare closing paren unbalances the substitution and dies at runtime).
  output="$(
    # Warnings go to stderr, and this capture is the log: fold the two together
    # so a refusal is recorded rather than scattered across the output.
    exec 2>&1
    # shellcheck source=../workflow/lib.sh
    . "$ENGINE/lib.sh"
    # shellcheck source=../workflow/home.sh
    . "$ENGINE/home.sh"
    if ! wk_home_ready; then
      case "$(wk_home_state)" in
        (unset)  wk_skip "runner: no home repo; \`workkit setup\` creates one; nothing to reconcile" ;;
        (absent) wk_skip "runner: nothing is cloned at $WK_HOME_DIR yet; the cloud brief runner was not reconciled; \`workkit setup\` clones it" ;;
        (other)  wk_warn "runner: $WK_HOME_DIR is not the home repo's clone; nothing is reconciled in somebody else's folder" ;;
      esac
      exit 0
    fi
    # The clone is BEHIND until it is pulled, and the seed judges what to write
    # from the working copy: the guard that keeps it off a newer kit reads the
    # stamp lying in this folder, issue #200. A clone that never caught up reads
    # a stamp a week old, seeds over what the remote already carries, and
    # commits something it can never push, wedging every publish after it.
    # --autostash for the reason publish.sh gives: the ordinary local state here
    # is an upstream change somebody took by hand, and a rebase refusing on that
    # dirty tree would read as a divergence.
    #
    # A pull that cannot finish is not always a divergence (offline and an auth
    # refusal land here too) and none of them is a morning to force: the rebase
    # is aborted, the seed is skipped, and the clone is left as it was found.
    if ! wk_spin "catching the clone up with origin" git -C "$WK_HOME_DIR" pull --rebase --autostash --quiet 2>/dev/null; then
      git -C "$WK_HOME_DIR" rebase --abort >/dev/null 2>&1 || true
      wk_warn "runner: the clone could not be brought up to date; the runner was not refreshed"
      exit 0
    fi
    rc=0
    wk_home_seed_runner || rc=$?
    # 0 is a copy that moved, the only answer worth a commit. 2 is a runner
    # already current, which is every ordinary morning; 1 has already warned and
    # left the clone exactly as it was.
    [[ "$rc" -eq 0 ]] || exit 0
    wk_home_commit_push 'chore(home): refresh the cloud brief runner' || true
  )" || status=$?

  # The subshell speaks in the same voice this job does, and note() puts its own
  # glyph on what it is handed: strip the inner one so no line wears two, and
  # let the glyph it ARRIVED with choose the one it is re-said under. A seed
  # that warned and still exited 0 (a push that did not land) would otherwise be
  # relayed as an action taken.
  # (Alternation, not a bracket class: see wk_plain in workflow/lib/voice.sh.)
  local relay='note'
  printf '%s\n' "$output" | grep -qE '^ *(⚠|✖) ' && relay='note_warn'
  output="$(printf '%s\n' "$output" | wk_plain)"
  if (( status != 0 )); then
    note_warn "$(printf 'runner: the reconcile exited %d; the morning continues\n%s' "$status" "$output")"
  elif [[ -n "$output" ]]; then
    "$relay" "$output"
  fi
  return 0
}
