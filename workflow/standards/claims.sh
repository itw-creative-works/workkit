#!/usr/bin/env bash
# workflow/standards/claims.sh: the heals that read the open issues: stale
# agent claims released, claimed specs flipped to building, and the check that
# every open issue carries conforming labels. Sourced by standards.sh,
# functions only. The claim labels and the staleness window are the entry's.

# ── 3b. Agent claims that went quiet are released ──
# Only an answer from GitHub licenses a write, and a human claim (no
# CLAIM_LABEL) never answers the query. Why the release demotes building and
# why jq judges staleness: `workflow/README.md`, the `standards/` row.
sweep_stale_claims() {
  local issues stale n assignees args login building body can_flip="" moved=0 failed=0
  command -v jq >/dev/null 2>&1 || return 0
  command -v gh >/dev/null 2>&1 || return 0
  wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  # The label step creates CLAIM_LABEL from the manifest; without a manifest
  # (or a sync that never reached GitHub) the label may not exist here yet, and
  # a query for a label a repo does not have is not a failure worth reporting.
  [[ -n "$existing_labels" ]] || return 0
  wk_jq -e --arg n "$CLAIM_LABEL" 'any(.[]; .name == $n)' <<<"$existing_labels" >/dev/null 2>&1 || return 0
  # The flip is a bonus, the release is the job: `gh issue edit` fails whole on
  # a label the repo lacks, so a missing SPECCED_LABEL releases without the flip.
  if wk_jq -e --arg n "$SPECCED_LABEL" 'any(.[]; .name == $n)' <<<"$existing_labels" >/dev/null 2>&1; then
    can_flip=1
  fi

  if ! issues="$(wk_spin 'reading the claimed issues' gh issue list --state open --label "$CLAIM_LABEL" --json number,updatedAt,assignees,labels --limit 1000 2>/dev/null)"; then
    wk_warn "claims: could not list the issues carrying $CLAIM_LABEL; every claim is left in place"
    needs_attention=1
    return 0
  fi

  stale="$(wk_jq -r --argjson max "$CLAIM_STALE_SECONDS" '
    .[] | select((.updatedAt | fromdateiso8601) < (now - $max)) | .number' <<<"$issues" 2>/dev/null || true)"

  while read -r n; do
    [[ -n "$n" ]] || continue
    # Every assignee comes off with the label: an assignee left behind still
    # reads as a claim to everyone querying the queue.
    assignees="$(wk_jq -r --argjson n "$n" '.[] | select(.number == $n) | .assignees[].login' <<<"$issues" 2>/dev/null || true)"
    args=(--remove-label "$CLAIM_LABEL")
    while read -r login; do
      [[ -n "$login" ]] || continue
      args+=(--remove-assignee "$login")
    done <<<"$assignees"
    # The status flip rides along in the same edit: two edits would leave a
    # window where the issue is unclaimed but still reads as in flight.
    building=""
    if [[ -n "$can_flip" ]] && wk_jq -e --argjson n "$n" --arg b "$BUILDING_LABEL" \
        '.[] | select(.number == $n) | any(.labels[]; .name == $b)' <<<"$issues" >/dev/null 2>&1; then
      building=1
      args+=(--remove-label "$BUILDING_LABEL" --add-label "$SPECCED_LABEL")
    fi

    if ! wk_spin "releasing the claim on #$n" gh issue edit "$n" "${args[@]}" >/dev/null 2>&1; then
      wk_warn "claims: could not release the stale claim on #$n; left as it was"
      failed=1
      continue
    fi
    # The comment follows the release, never precedes it: a comment about a
    # release that then failed would be the issue's record of something that
    # did not happen.
    body="Released by the standards stale-claim sweep: this issue carried $CLAIM_LABEL with no activity for 24 hours, so the label and any assignee were cleared. It is free to claim again."
    if [[ -n "$building" ]]; then
      body="$body It also went back from $BUILDING_LABEL to $SPECCED_LABEL: the spec is still accepted, the work is simply unclaimed; whatever partial progress exists is in this issue's own trail."
    fi
    wk_spin "commenting on #$n" gh issue comment "$n" --body "$body" >/dev/null 2>&1 \
      || wk_warn "claims: released #$n but could not comment on it"
    moved=$((moved + 1))
  done <<<"$stale"

  [[ "$failed" -eq 1 ]] && needs_attention=1
  [[ "$moved" -gt 0 ]] && wk_ok "claims: released $moved stale $CLAIM_LABEL claim(s); idle for over 24 hours"
  return 0
}

# ── 3c. A claimed spec is work in flight ──
# Specced plus an assignee has started, so it flips to building. The release
# sweep runs first and removes the assignee as it demotes, so the two never
# fight. A repo missing BUILDING_LABEL is left alone.
flip_claimed_specced() {
  local issues claimed n moved=0 failed=0
  command -v jq >/dev/null 2>&1 || return 0
  command -v gh >/dev/null 2>&1 || return 0
  wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  [[ -n "$existing_labels" ]] || return 0
  wk_jq -e --arg n "$BUILDING_LABEL" 'any(.[]; .name == $n)' <<<"$existing_labels" >/dev/null 2>&1 || return 0

  if ! issues="$(wk_spin 'reading the specced issues' gh issue list --state open --label "$SPECCED_LABEL" --json number,assignees --limit 1000 2>/dev/null)"; then
    wk_warn "claims: could not list the issues carrying $SPECCED_LABEL; nothing was flipped"
    needs_attention=1
    return 0
  fi

  claimed="$(wk_jq -r '.[] | select((.assignees | length) > 0) | .number' <<<"$issues" 2>/dev/null || true)"

  while read -r n; do
    [[ -n "$n" ]] || continue
    if ! wk_spin "flipping #$n to $BUILDING_LABEL" gh issue edit "$n" --remove-label "$SPECCED_LABEL" --add-label "$BUILDING_LABEL" >/dev/null 2>&1; then
      wk_warn "claims: could not flip #$n to $BUILDING_LABEL; left as it was"
      failed=1
      continue
    fi
    # The comment follows the edit, never precedes it: the issue's trail records
    # what happened, not what was about to be tried.
    wk_spin "commenting on #$n" gh issue comment "$n" --body "Flipped to $BUILDING_LABEL by the standards sweep: this issue was $SPECCED_LABEL with an assignee, which is a claim on an authorized spec, work in flight. If nobody is working on it, remove the assignee and put $SPECCED_LABEL back." >/dev/null 2>&1 \
      || wk_warn "claims: flipped #$n but could not comment on it"
    moved=$((moved + 1))
  done <<<"$claimed"

  [[ "$failed" -eq 1 ]] && needs_attention=1
  [[ "$moved" -gt 0 ]] && wk_ok "claims: flipped $moved claimed $SPECCED_LABEL issue(s) to $BUILDING_LABEL"
  return 0
}

# ── 4. Open issues carry conforming labels ──
# A violation flags the run every session until it is routed, since a captured
# issue can arrive unlabeled and sit outside every queue. The manifest's
# `exclusive` and `required` groups are the rule; no gh or auth skips silently.
check_issue_labels() {
  local issues bad
  [[ -f "$LABELS_JSON" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  command -v gh >/dev/null 2>&1 || return 0
  wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  issues="$(wk_spin 'reading the board' gh issue list --json number,labels --limit 1000 2>/dev/null)" || return 0
  [[ -n "$issues" ]] || return 0
  bad="$(wk_jq -r --slurpfile manifest "$LABELS_JSON" '
    ($manifest[0].groups | to_entries | map(select(.value.exclusive == true))
      | map({ key, required: (.value.required == true) })) as $rules
    | [ .[] | . as $issue
        | select(any($rules[]; . as $rule
            | ([$issue.labels[].name | select(startswith($rule.key + ":"))] | length) as $n
            | $n > 1 or ($rule.required and $n == 0)))
        | "#\(.number)" ]
    | join(" ")' <<<"$issues" 2>/dev/null || true)"
  if [[ -n "$bad" ]]; then
    wk_warn "issues: $bad missing a required status:/type: label or carrying two from one exclusive group; run the workkit:triage skill to route them"
    needs_attention=1
  fi
}
