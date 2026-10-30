#!/usr/bin/env bash
# workflow/standards/labels.sh: the heals that talk to GitHub about the repo
# itself: branch protection (best effort), the label sync from labels.json, and
# the public pairing: its key, the status labels on the public repo, the mirror
# sweep. Sourced by standards.sh, functions only. The sync's answer,
# existing_labels, is the entry's, since the claim sweeps read it after.

# ── 2c. Branch protection (best effort, never a failure) ──
# Advisory: it needs admin, and free plans protect only public repos, so every
# miss is a quiet skip. An existing protection is left exactly as found.
ensure_branch_protection() {
  local repo branch
  command -v gh >/dev/null 2>&1 || return 0
  wk_spin 'checking the gh login' gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  repo="$(wk_spin 'reading the repo' gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || return 0
  branch="$(wk_spin 'reading the default branch' gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null)" || return 0
  [[ -n "$repo" && -n "$branch" ]] || return 0

  # Only an explicit "not protected" answer may lead to a PUT. Any other
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
# Desired set, one label per line: name<TAB>description<TAB>color; a group
# name narrows it to that group.
desired_labels() {
  wk_jq -r --arg only "${1:-}" '
    .groups | to_entries[] | select($only == "" or .key == $only)
    | .key as $group | .value.color as $group_color
    | .value.values | to_entries[]
    | "\($group):\(.key)\t\(.value.description)\t\(.value.color // $group_color)"
  ' "$LABELS_JSON"
}

sync_labels() {
  local existing

  # A missing manifest is a broken install, so the run is flagged for a retry.
  # Only this step and the issue check read it, so --state, --announce and
  # --decline still answer on a broken install.
  if [[ ! -f "$LABELS_JSON" ]]; then
    wk_warn "labels: labels.json missing at $LABELS_JSON; reinstall the workflow core"
    needs_attention=1
    return 0
  fi
  # Only this step needs jq, so the local heals above run without it.
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
  sync_label_set labels "$existing" ''
}

# sync_label_set <task> <existing> <group> [gh repo args...]: the labels.json
# labels (one group's, or every one for '') made and corrected against
# <existing>, gh's label list, each gh call given the trailing arguments.
sync_label_set() {
  local task="$1" existing="$2" group="$3" name description color current cur_desc cur_color
  local created=0 updated=0 unchanged=0
  shift 3

  while IFS=$'\t' read -r name description color; do
    [[ -n "$name" ]] || continue
    current="$(wk_jq -r --arg n "$name" '.[] | select(.name == $n) | "\(.description)\t\(.color)"' <<<"$existing")"

    if [[ -z "$current" ]]; then
      if wk_spin "creating the $name label" gh label create "$name" --description "$description" --color "$color" "$@" >/dev/null 2>&1; then
        created=$((created + 1))
      else
        # A label the manifest asks for is still missing: retry next session,
        # the same way a missing template file is treated.
        wk_warn "$task: could not create $name"
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
    if wk_spin "correcting the $name label" gh label edit "$name" --description "$description" --color "$color" "$@" >/dev/null 2>&1; then
      updated=$((updated + 1))
    else
      wk_warn "$task: could not update $name"
      needs_attention=1
    fi
  done < <(desired_labels "$group")

  [[ "$created" -gt 0 ]] && wk_ok "$task: created $created"
  [[ "$updated" -gt 0 ]] && wk_ok "$task: corrected $updated"
  [[ "$unchanged" -gt 0 ]] && wk_skip "$task: $unchanged already correct"
  return 0
}

# ── 3b. The public pairing ──
# An owner/name slug. The twin of SLUG_RE in ../public/lib.js, pinned by
# test/hooks/twins.test.js: change one and change the other.
PUBLIC_SLUG_RE='^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$'

# The committed `public` key into PUBLIC_REPO, empty when there is none; a value
# that is no slug is a warning naming the key, and the pairing stays off.
read_public_repo() {
  local value
  PUBLIC_REPO=''
  value="$(wk_json_get "$REPO_SETTINGS" '.public')"
  [[ -n "$value" ]] || return 0
  if [[ "$value" =~ $PUBLIC_SLUG_RE ]]; then
    PUBLIC_REPO="$value"
    return 0
  fi
  wk_warn "public: the public key in $REPO_SETTINGS is '$value', not an owner/name slug; the public pairing is off until it is one"
  needs_attention=1
}

# The status group of labels.json on the public repo, never the other groups.
# Runs only after the repo's own sync reached GitHub.
sync_public_labels() {
  local existing
  [[ -n "$PUBLIC_REPO" && -n "$existing_labels" ]] || return 0
  if ! existing="$(wk_spin "reading the labels of $PUBLIC_REPO" gh label list --repo "$PUBLIC_REPO" --json name,description,color --limit 300 2>/dev/null)"; then
    wk_warn "public labels: could not read the labels of $PUBLIC_REPO; skipped"
    return 0
  fi
  sync_label_set "public labels" "$existing" status --repo "$PUBLIC_REPO"
}

# The session-start sweep: every open linked issue's status mirrored onto its
# public issue (public/mirror.js --all). A failed mirror is a warning, never a
# failed heal.
sweep_public_mirror() {
  local out err line
  [[ -n "$PUBLIC_REPO" && -n "$existing_labels" ]] || return 0
  command -v node >/dev/null 2>&1 || { wk_skip "public: node not installed; the mirror sweep skipped"; return 0; }
  err="$(mktemp)"
  out="$(node "$SCRIPT_DIR/public/mirror.js" --all 2>"$err")" || true
  while IFS= read -r line; do [[ -n "$line" ]] && wk_ok "$line"; done <<<"$out"
  wk_warn_lines public "$(<"$err")"
  rm -f "$err"
  return 0
}
