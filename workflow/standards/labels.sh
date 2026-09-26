#!/usr/bin/env bash
# workflow/standards/labels.sh: the heals that talk to GitHub about the repo
# itself: branch protection (best effort) and the label sync from labels.json.
# SOURCED by standards.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. The sync's answer, existing_labels, is
# the entry's, since the claim sweeps read it after.

# ── 2c. Branch protection (best effort, never a failure) ──
# Asks GitHub to require the `test` check before merging into the default
# branch. ADVISORY by design: it needs admin on the repo, and GitHub only
# enforces protection on public repos for free accounts: a private repo on a
# free plan accepts the API call or rejects it by plan, and neither outcome is
# this machine's fault. So every miss is a quiet skip, never needs_attention.
# An EXISTING protection is left exactly as found: someone configured it.
ensure_branch_protection() {
  local repo branch
  command -v gh >/dev/null 2>&1 || return 0
  wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  repo="$(wk_spin 'reading the repo' gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || return 0
  branch="$(wk_spin 'reading the default branch' gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null)" || return 0
  [[ -n "$repo" && -n "$branch" ]] || return 0

  # Only an explicit "not protected" answer may lead to a PUT. Any OTHER
  # failure (rate limit, network) is indistinguishable from "protected but
  # unreadable", and writing the minimal payload over an existing
  # configuration would break the promise above, so bail without touching it.
  local probe
  if probe="$(wk_spin "reading the protection on $branch" gh api "repos/$repo/branches/$branch/protection" 2>&1)"; then
    wk_skip "protection: $branch already protected"
    return 0
  elif [[ "$probe" != *"Branch not protected"* && "$probe" != *"HTTP 404"* ]]; then
    return 0
  fi
  if printf '%s' '{"required_status_checks":{"strict":false,"contexts":["test"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}' \
    | wk_spin "protecting $branch" gh api -X PUT "repos/$repo/branches/$branch/protection" --input - >/dev/null 2>&1; then
    wk_ok "protection: $branch now requires the test check before merge"
  else
    wk_skip "protection: not applied to $branch (needs admin, and GitHub enforces it on private repos only on paid plans)"
  fi
}

# ── 3. Labels ──
# Desired set, one label per line: name<TAB>description<TAB>color.
desired_labels() {
  wk_jq -r '
    .groups | to_entries[] | .key as $group | .value.color as $group_color
    | .value.values | to_entries[]
    | "\($group):\(.key)\t\(.value.description)\t\(.value.color // $group_color)"
  ' "$LABELS_JSON"
}

sync_labels() {
  local existing name description color current cur_desc cur_color
  local created=0 updated=0 unchanged=0

  # The manifest ships next to this script; its absence is a broken install,
  # not an offline machine. Flag the run so the heal retries next session.
  # Only THIS step and the issue check read it, so --state, --announce, and
  # --decline never need it (a broken install must still answer them).
  if [[ ! -f "$LABELS_JSON" ]]; then
    wk_warn "labels: labels.json missing at $LABELS_JSON; reinstall the workflow core"
    needs_attention=1
    return 0
  fi
  # jq reads the manifest and GitHub's answer: only THIS step needs it, so the
  # local heals above still run on a machine without it.
  if ! command -v jq >/dev/null 2>&1; then
    wk_skip "labels: jq not installed; skipped"
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    wk_skip "labels: gh not installed; skipped"
    return 0
  fi
  if ! wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1; then
    wk_skip "labels: gh not authenticated; skipped"
    return 0
  fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    wk_skip "labels: no origin remote; skipped"
    return 0
  fi
  if ! existing="$(wk_spin 'reading the labels' gh label list --json name,description,color --limit 300 2>/dev/null)"; then
    wk_skip "labels: could not reach GitHub; skipped"
    return 0
  fi
  existing_labels="$existing"

  while IFS=$'\t' read -r name description color; do
    [[ -n "$name" ]] || continue
    current="$(wk_jq -r --arg n "$name" '.[] | select(.name == $n) | "\(.description)\t\(.color)"' <<<"$existing")"

    if [[ -z "$current" ]]; then
      if wk_spin "creating the $name label" gh label create "$name" --description "$description" --color "$color" >/dev/null 2>&1; then
        created=$((created + 1))
      else
        # A label the manifest asks for is still missing: retry next session,
        # the same way a missing template file is treated.
        wk_warn "labels: could not create $name"
        needs_attention=1
      fi
      continue
    fi

    IFS=$'\t' read -r cur_desc cur_color <<<"$current"
    # Hex case is not meaningful; bash 3.2 (stock macOS) has no ${x,,}.
    cur_color="$(printf '%s' "$cur_color" | tr '[:upper:]' '[:lower:]')"
    if [[ "$cur_desc" == "$description" ]] && [[ "$cur_color" == "$(printf '%s' "$color" | tr '[:upper:]' '[:lower:]')" ]]; then
      unchanged=$((unchanged + 1))
      continue
    fi
    if wk_spin "correcting the $name label" gh label edit "$name" --description "$description" --color "$color" >/dev/null 2>&1; then
      updated=$((updated + 1))
    else
      wk_warn "labels: could not update $name"
      needs_attention=1
    fi
  done < <(desired_labels)

  [[ "$created" -gt 0 ]] && wk_ok "labels: created $created"
  [[ "$updated" -gt 0 ]] && wk_ok "labels: corrected $updated"
  [[ "$unchanged" -gt 0 ]] && wk_skip "labels: $unchanged already correct"
  return 0
}
