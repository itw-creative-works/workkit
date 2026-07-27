#!/usr/bin/env bash
# workflow standards — bring a repo to the issue-workflow standard, idempotently.
#
# The heals, all safe to re-run:
#   1. labels    — create every group:value label from labels.json (SSOT) and
#                  correct description/color drift. Unknown labels are left alone.
#   1b. migrate  — move a repo's `.workflow/` to `.workkit/`, the name the state
#                  directory carries now. One-time and idempotent; the only
#                  place in the engine that still knows the old name.
#   2. gitignore — make sure `.workkit/` stays untracked EXCEPT settings.json,
#                  the committed file carrying the repo's answer (enabled true/false).
#   3. forms     — install .github/ISSUE_TEMPLATE/ markdown templates so a
#                  first-day teammate files correctly; each one auto-applies
#                  status:inbox + its type and pre-fills the issue anatomy
#                  (## Description then ## Plan), so every issue conforms from
#                  the moment it is filed.
#   4. checks    — install .github/workflows/checks.yml, the required-checks
#                  CI workflow that runs the test suite on every pull request.
#                  Installed once and never overwritten: after the first heal
#                  the copy is the repo's own to extend.
#   5. protection — best-effort: ask GitHub to require the test check on the
#                  default branch. Quietly skipped wherever the plan or the
#                  token cannot grant it; an existing protection is never
#                  touched.
#
# Usage: bash standards.sh [--state|--announce|--enable|--decline] [repo_dir]
#        (repo_dir defaults to the current directory)
#
#   (no mode)   heal the repo — but only if it is enabled (see participation)
#   --state     print enabled | disabled | declined | undecided | nogit
#   --announce  print the one-line offer shown to an undecided repo
#   --enable    write the committed opt-in (enabled: true), then heal
#   --decline   record "never ask about this repo again" in the USER settings
#
# The label step and the protection ask need jq/gh + auth + a remote. Without
# them each says so quietly and moves on — an offline machine has nothing
# broken, just nothing to sync. The gitignore, session-file, forms, and checks
# heals are pure bash and always run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
LABELS_JSON="$SCRIPT_DIR/labels.json"
TEMPLATES_DIR="$SCRIPT_DIR/templates"
FORMS_DIR="$TEMPLATES_DIR/issue-forms"
CHANGELOG_LINTER="$SCRIPT_DIR/changelog.js"

# The workflow state directory's name, for the ENGINE layer — one string so a
# rename is one edit here. The hooks (hooks/_lib.sh) and the
# test harness (tests/lib/harness.js) hold their own copy for the same reason;
# a test asserts all three still say the same thing.
WORKKIT_DIR=".workkit"
# The name this directory carried before, read by the migration step below and
# nowhere else. Every other path in this script is the current name.
WORKKIT_LEGACY_DIR=".workflow"

# The standard this script brings a repo to. A repo's committed settings.json
# records the version it was last healed to, so "does this repo need attention?"
# is one integer compare instead of a scan. Bump it when a new heal or a new
# drift check lands; a repo already at the current version does exactly what it
# did before.
STANDARD_VERSION=4

# ── Logging (mirrors setup/lib/helpers.sh; standalone so the script travels) ──
_G='\033[0;32m' _Y='\033[0;33m' _C='\033[0;36m' _D='\033[0;90m' _N='\033[0m'
# Diagnostics go to STDERR, always. Stdout is reserved for machine-readable
# answers (--state, --announce): a caller capturing `$(standards.sh --state)` was
# getting any warning printed before the dispatch folded into the state string,
# which then matched no case and silently did nothing (review finding, 2026-07-24).
log_ok()   { printf "  ${_G}✓${_N} %s\n" "$1" >&2; }
log_skip() { printf "  ${_D}· %s${_N}\n" "$1" >&2; }
log_warn() { printf "  ${_Y}⚠ %s${_N}\n" "$1" >&2; }
log_info() { printf "  ${_C}ℹ %s${_N}\n" "$1" >&2; }

mode="heal"
case "${1:-}" in
  --state|--announce|--enable|--decline) mode="${1#--}"; shift ;;
  --*) log_warn "standards: unknown option $1"; exit 1 ;;
esac

repo_dir="${1:-$PWD}"

if ! root="$(git -C "$repo_dir" rev-parse --show-toplevel 2>/dev/null)"; then
  if [[ "$mode" == "state" ]]; then
    printf 'nogit\n'
  else
    log_skip "standards: $repo_dir is not a git repo — nothing to standardize"
  fi
  exit 0
fi

cd "$root"

# ── 0. Participation ──────────────────────────────────────────────────────────
# Four states, two files. The REPO's committed .workkit/settings.json is the
# only place a yes or a deliberate no can live — it is a project fact a teammate
# reads. Never-asked and declined are PERSONAL (Ian 2026-07-24): a teammate
# seeing `enabled: false` would read it as the project declining when it was one
# developer undecided, so those live in the user's own settings file instead.
#
#   enabled   — committed settings.json, `enabled: true` or the key absent
#               (legacy `{ "version": 1 }` opted in by existing at all)
#   disabled  — committed settings.json with `enabled: false`
#   declined  — no committed file; this user recorded a decline for this repo
#   undecided — no committed file, no record: offer once, write nothing
USER_SETTINGS="${WORKFLOW_HOME:-${HOME:-}/$WORKKIT_DIR}/settings.json"
REPO_SETTINGS="$WORKKIT_DIR/settings.json"

# The user's workflow folder exists from the first run, not from the first
# decline. Someone running this system expects to find it (Ian 2026-07-25);
# a folder that appears only after a particular action reads as missing.
# A machine whose dotfiles already track and symlink the folder makes this a
# no-op — it is the path for a machine where nothing has created it yet.
# The seed has ONE writer. `set -C` makes the create O_EXCL, so a --decline
# landing between the test and the write cannot be truncated away. The stderr
# redirect precedes the target: redirections apply left to right, so one written
# last cannot suppress the shell's own message for the redirect before it.
seed_user_settings() {
  local dir="${USER_SETTINGS%/*}"
  [[ -e "$USER_SETTINGS" ]] && return 0
  mkdir -p "$dir" 2>/dev/null || return 0
  ( set -C; printf '{\n  "version": 1,\n  "repos": {}\n}\n' 2>/dev/null >"$USER_SETTINGS" ) || return 0
}
seed_user_settings

offer_line() {
  # %q on the path: a repo directory containing a space would otherwise print a
  # suggested command that breaks when pasted.
  printf 'this repo is not in the issue workflow — say the word to enable it (bash %q/standards.sh --enable %q), or decline and it will not ask again (--decline).' "$SCRIPT_DIR" "$root"
}

# true | false | absent — the repo file's `enabled` key. jq when it is here; a
# grep on our own two-key file when it is not, so a machine without jq still
# honors a deliberate `enabled: false` instead of healing over it.
repo_enabled_flag() {
  if command -v jq >/dev/null 2>&1; then
    # A file jq cannot parse is NOT a legacy opt-in — reporting `absent` here
    # would heal a repo whose answer is unreadable. Say so instead.
    jq -r 'if has("enabled") then (.enabled | tostring) else "absent" end' "$REPO_SETTINGS" 2>/dev/null \
      || printf 'unreadable'
  elif grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$REPO_SETTINGS"; then
    printf 'false'
  elif grep -qE '"enabled"[[:space:]]*:[[:space:]]*true' "$REPO_SETTINGS"; then
    printf 'true'
  else
    printf 'absent'
  fi
}

# The standard version this repo was last healed to. A file predating the field
# reads as 1 — the version every repo healed before the field existed.
repo_version() {
  local v=""
  [[ -f "$REPO_SETTINGS" ]] || { printf '0'; return 0; }
  if command -v jq >/dev/null 2>&1; then
    v="$(jq -r '.version // 1' "$REPO_SETTINGS" 2>/dev/null)" || v=""
  fi
  [[ "$v" =~ ^[0-9]+$ ]] || v=1
  printf '%s' "$v"
}

# Report what this repo still carries from a retired convention. REPORTS ONLY —
# every finding here is either destructive to fix (a retired file holds work
# items nobody migrated) or needs judgment (rewriting CHANGELOG prose), and
# neither belongs to a script that runs unattended at session start.
report_drift() {
  local found=0 f

  for f in PROGRESS.md INBOX.md TODO.md; do
    [[ -f "$root/$f" ]] || continue
    log_warn "standards: $f is retired by spec v3 — its contents are work items; run the workkit:migrate skill to file them as issues, then delete it"
    found=1
  done
  if [[ -d "$root/plans" ]]; then
    log_warn "standards: plans/ is retired by spec v3 — a plan is the '## Plan' section of its issue; run the workkit:migrate skill to move each one, then delete the directory"
    found=1
  fi

  # The CHANGELOG check judges the WHOLE file, unlike the guards, which judge
  # only the lines a change adds. That difference is the point: the guards keep
  # new entries right, and this says whether the history was ever brought over.
  if [[ -f "$root/CHANGELOG.md" ]]; then
    if [[ -f "$CHANGELOG_LINTER" ]] && command -v node >/dev/null 2>&1; then
      # Count ENTRIES, not violations: one entry commonly breaks several rules at
      # once, and "12 entries" is the number a human can act on.
      local bad
      bad="$(node "$CHANGELOG_LINTER" "$root/CHANGELOG.md" 2>&1 | grep -oE '^  line [0-9]+' | sort -u | wc -l | tr -d ' ')"
      if [[ "${bad:-0}" -gt 0 ]]; then
        log_warn "standards: CHANGELOG.md has $bad entries not in the entry format — run the workkit:migrate skill, or 'node ~/.claude/workflow/changelog.js CHANGELOG.md' to see them"
        found=1
      fi
    else
      # No node (or no linter) means this check never ran. The caller must not
      # stamp the version past it — that would end the one-time drift report
      # for a file nobody checked.
      drift_skipped=1
    fi
  fi

  return "$found"
}

resolve_state() {
  if [[ -f "$REPO_SETTINGS" ]]; then
    case "$(repo_enabled_flag)" in
      false)      printf 'disabled' ;;
      unreadable) printf 'unreadable' ;;
      *)          printf 'enabled' ;;
    esac
    return 0
  fi
  # The user file is read-only here and only ever holds decisions, so no jq means
  # no record — an undecided repo simply gets offered again.
  if [[ -f "$USER_SETTINGS" ]] && command -v jq >/dev/null 2>&1 \
    && [[ "$(jq -r --arg r "$root" '.repos[$r] // ""' "$USER_SETTINGS" 2>/dev/null)" == "declined" ]]; then
    printf 'declined'
    return 0
  fi
  printf 'undecided'
}

# Write ONLY the repos key, leaving every other key and the file's own shape
# alone — the same contract the settings clean filter honors.
# Write a jq edit back to a settings file safely: resolve symlinks first (this
# repo's whole model is symlinking config out of ~, so the target is very likely
# a link — writing the temp file over the LINK would replace it with a regular
# file and orphan the real one), refuse to touch a file jq cannot parse, and
# never leave a .tmp behind on any failure path.
edit_settings_json() {
  local file="$1"; shift
  local target tmp rc=0
  target=$(readlink -f "$file" 2>/dev/null || printf '%s' "$file")
  if ! jq empty "$target" 2>/dev/null; then
    log_warn "settings: $target is not valid JSON — fix or remove it, then try again"
    return 1
  fi
  tmp="$target.tmp.$$"
  # shellcheck disable=SC2064  # expand $tmp now: it is what this call must clean up
  trap "rm -f '$tmp'" RETURN
  jq "$@" "$target" >"$tmp" || rc=$?
  if [[ "$rc" -ne 0 ]] || [[ ! -s "$tmp" ]]; then
    log_warn "settings: could not write $target (left unchanged)"
    return 1
  fi
  mv "$tmp" "$target" || { log_warn "settings: could not replace $target"; return 1; }
  return 0
}

record_decline() {
  local lock held=0 waited=0
  if ! command -v jq >/dev/null 2>&1; then
    log_warn "decline: jq is required to edit $USER_SETTINGS"
    exit 1
  fi
  mkdir -p "$(dirname "$USER_SETTINGS")" 2>/dev/null \
    || { log_warn "decline: cannot create $(dirname "$USER_SETTINGS")"; exit 1; }
  # seed_user_settings ran at load, so the file is normally already here; this
  # covers a --decline whose settings file was removed in between.
  seed_user_settings
  [[ -f "$USER_SETTINGS" ]] || { log_warn "decline: cannot write $USER_SETTINGS"; exit 1; }

  # The whole-file read-modify-write races when two sessions decline at once —
  # last writer wins and the other decision is lost. mkdir is the atomic mutex.
  lock="$USER_SETTINGS.lock"
  while [ "$waited" -lt 50 ]; do
    if mkdir "$lock" 2>/dev/null; then held=1; break; fi
    sleep 0.1
    # An assignment, never `(( waited++ ))`: that form yields the value BEFORE
    # the increment, so the first pass evaluates to 0, which is a non-zero exit
    # status. Bash 4.1 and later apply errexit to it and the whole run ends
    # silently mid-wait; bash 3.2 (stock macOS) does not, so the defect only
    # ever surfaced off this machine.
    waited=$(( waited + 1 ))
  done
  if [ "$held" -eq 1 ]; then
    # shellcheck disable=SC2064  # expand $lock now
    trap "rmdir '$lock' 2>/dev/null || true" EXIT
  else
    # No trap here: the mutex belongs to whichever run holds it, and removing
    # it on the way out would let a third decline race the current holder.
    log_warn "decline: proceeding without the lock (held for 5s by another run)"
  fi

  edit_settings_json "$USER_SETTINGS" --arg r "$root" \
    '.repos = ((.repos // {}) + { ($r): "declined" })' || exit 1

  # A committed answer wins at resolve time, so saying "it will not be offered
  # again" would be a lie while that file says yes.
  if [[ -f "$REPO_SETTINGS" ]]; then
    log_ok "decline: recorded $root in $USER_SETTINGS"
    log_warn "decline: $REPO_SETTINGS still carries the repo's committed answer, which wins — this takes effect only if that file goes away"
  else
    log_ok "decline: recorded $root in $USER_SETTINGS — it will not be offered again"
  fi
}

write_repo_optin() {
  if [[ ! -f "$REPO_SETTINGS" ]]; then
    mkdir -p "$WORKKIT_DIR"
    # Version 1, deliberately, even though this file is new: a repo joining
    # TODAY is exactly the one most likely to carry a PROGRESS.md and an old
    # CHANGELOG, and the mechanical heals do not clear either. Recording the
    # current standard here would skip the drift report for the one case it
    # exists to serve. The heal that follows stamps it forward.
    printf '{\n  "version": 1,\n  "enabled": true\n}\n' >"$REPO_SETTINGS"
    log_ok "opt-in: created $REPO_SETTINGS — commit it, it is the repo's yes"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    log_warn "opt-in: $REPO_SETTINGS exists and jq is not installed — set \"enabled\": true by hand"
    exit 1
  fi
  edit_settings_json "$REPO_SETTINGS" '.enabled = true' || exit 1
  log_ok "opt-in: $REPO_SETTINGS is now enabled"
}

# ── 1b. .workflow/ → .workkit/, once ──
# The state directory was called .workflow until this standard renamed it, and
# every other path in this script now says .workkit. A repo healed before the
# rename still has the old directory, so the heal moves it — once, and then
# never again, because the old name is gone.
#
# The trigger is the COMMITTED settings.json in the old directory: that file is
# the repo's answer, so moving it touches only a repo that already said yes. The
# move is a plain `mv`, which carries the gitignored session files along with it;
# git sees the tracked settings.json as a rename, for the human to commit with
# the .gitignore lines rewritten here.
#
# Both directories present means someone made a .workkit/ by hand, or a half-
# finished migration left the two side by side. Merging them needs judgment
# about which inbox is current, so this says so and touches nothing.
migrate_legacy_dir() {
  local ignore=".gitignore" tmp
  [[ -f "$WORKKIT_LEGACY_DIR/settings.json" ]] || return 0

  if [[ -e "$WORKKIT_DIR" ]]; then
    log_warn "migrate: $WORKKIT_LEGACY_DIR/ and $WORKKIT_DIR/ both exist — move what you want to keep into $WORKKIT_DIR/, then remove $WORKKIT_LEGACY_DIR/"
    needs_attention=1
    return 0
  fi
  if ! mv "$WORKKIT_LEGACY_DIR" "$WORKKIT_DIR"; then
    log_warn "migrate: could not move $WORKKIT_LEGACY_DIR/ to $WORKKIT_DIR/ — do it by hand"
    needs_attention=1
    return 0
  fi

  if [[ -f "$ignore" ]] && grep -qF "$WORKKIT_LEGACY_DIR/" "$ignore"; then
    tmp="$ignore.tmp.$$"
    if sed "s|$WORKKIT_LEGACY_DIR/|$WORKKIT_DIR/|g" "$ignore" >"$tmp" && [[ -s "$tmp" ]]; then
      mv "$tmp" "$ignore"
    else
      rm -f "$tmp"
      log_warn "migrate: could not rewrite $ignore — point its $WORKKIT_LEGACY_DIR/ lines at $WORKKIT_DIR/ by hand"
      needs_attention=1
    fi
  fi

  log_ok "migrate: $WORKKIT_LEGACY_DIR/ → $WORKKIT_DIR/ — commit the rename"
}

# ── 1. .workkit/ stays untracked, except the committed settings.json ──
# settings.json is never created by a HEAL — only by --enable. Opting a repo in is
# a deliberate act by a human or an agent asked to do it, never a side effect.
#
# Correctness here is an OUTCOME, not a string in a file: session state must be
# ignored AND settings.json must stay trackable. Grepping for the block misses
# the two ways a repo ends up broken — a .gitignore holding the DIRECTORY form
# `.workkit/` (git never descends into an excluded directory, so no later
# negation can re-include settings.json) and one holding `.workkit/*` with no
# negation line. Both are checked with git check-ignore instead.
ensure_workflow_ignored() {
  local file=".gitignore" lines="" offender

  if git check-ignore -q -- "$WORKKIT_DIR/inbox.md" 2>/dev/null \
    && ! git check-ignore -q -- "$REPO_SETTINGS" 2>/dev/null; then
    log_skip "gitignore: $WORKKIT_DIR/ already ignored"
    return 0
  fi

  # Append only the lines that are missing, so a re-run never duplicates them.
  if ! grep -qxF "$WORKKIT_DIR/*" "$file" 2>/dev/null; then
    lines="${lines}${WORKKIT_DIR}/*"$'\n'
  fi
  if ! grep -qxF "!$REPO_SETTINGS" "$file" 2>/dev/null; then
    lines="${lines}!${REPO_SETTINGS}"$'\n'
  fi

  if [[ -n "$lines" ]]; then
    # A file without a trailing newline would swallow the appended line, and a
    # file with content gets one blank line of separation. A missing or empty
    # .gitignore gets neither — it must not start with a blank line.
    if [[ -s "$file" ]]; then
      if [[ -n "$(tail -c 1 "$file")" ]]; then
        printf '\n' >>"$file"
      fi
      printf '\n' >>"$file"
    fi
    printf '# Workflow state (workflow spec) — only settings.json is committed\n%s' "$lines" >>"$file"
    log_ok "gitignore: added $WORKKIT_DIR/"
  fi

  # Re-verify by outcome. Still ignored means some OTHER pattern wins, and this
  # function cannot repair it — say which line, and do not report success.
  if git check-ignore -q -- "$REPO_SETTINGS" 2>/dev/null; then
    offender="$(git check-ignore -v -- "$REPO_SETTINGS" 2>/dev/null | head -n 1)"
    log_warn "gitignore: $REPO_SETTINGS is STILL ignored by [$offender] — remove or repair that pattern so the opt-in file can be committed"
    needs_attention=1
  fi
}

# ── 1b. The local working files exist, ready for use ──
# Both are gitignored per the pattern above, so creating them is free; having
# them already on disk is what makes jotting a note or tracking the session
# zero-friction. A file with content is NEVER overwritten.
ensure_local_file() {
  local name="$1" label="${1%.md}" file="$WORKKIT_DIR/$1"

  # -s, not -f: the promise is "never overwritten once it has CONTENT", so an
  # empty or truncated file gets its sections back instead of staying blank.
  if [[ -s "$file" ]]; then
    log_skip "$label: $file already exists"
    return 0
  fi

  # A missing template is a broken install, not a reason to abandon the rest of
  # the heal: under `set -e` a bare cp here ended the run before forms and
  # labels, and the hook still reported success (review finding, 2026-07-24).
  if [[ ! -f "$TEMPLATES_DIR/$name" ]]; then
    log_warn "$label: template missing at $TEMPLATES_DIR/$name — reinstall the workflow core"
    needs_attention=1
    return 0
  fi

  mkdir -p "$WORKKIT_DIR"
  cp "$TEMPLATES_DIR/$name" "$file"
  log_ok "$label: created $file"
}

# ── 2. Issue forms ──
ensure_issue_forms() {
  local dest=".github/ISSUE_TEMPLATE" form created=0 existing=0

  mkdir -p "$dest"
  for form in bug enhancement idea dump; do
    if [[ -f "$dest/$form.md" ]]; then
      existing=$((existing + 1))
      continue
    fi
    if [[ ! -f "$FORMS_DIR/$form.md" ]]; then
      log_warn "issue forms: template missing at $FORMS_DIR/$form.md — reinstall the workflow core"
      needs_attention=1
      continue
    fi
    cp "$FORMS_DIR/$form.md" "$dest/$form.md"
    created=$((created + 1))
  done

  if [[ "$created" -gt 0 ]]; then
    log_ok "issue forms: created $created in $dest"
  fi
  if [[ "$existing" -gt 0 ]]; then
    log_skip "issue forms: $existing already present"
  fi
}

# ── 2b. Required-checks CI workflow ──
# One file, installed once. A pull request from an author without the local
# hooks (a cloud agent, a collaborator) still meets the test bar before merge.
# Never overwritten: the installed copy belongs to the repo, which may extend
# it (different runner, extra steps) without the heal fighting the edit.
# PRESENCE is the check, not content — so a repo that wants no Actions run
# keeps the file with the jobs removed (or empty) rather than deleting it;
# a deleted file would be re-installed on the next heal.
ensure_ci_workflow() {
  local dest=".github/workflows/checks.yml" src="$TEMPLATES_DIR/github-workflows/checks.yml"

  if [[ -f "$dest" ]]; then
    log_skip "checks: $dest already present"
    return 0
  fi
  if [[ ! -f "$src" ]]; then
    log_warn "checks: template missing at $src — reinstall the workflow core"
    needs_attention=1
    return 0
  fi
  mkdir -p .github/workflows
  cp "$src" "$dest"
  log_ok "checks: created $dest — commit it so it runs on every pull request"
}

# ── 2c. Branch protection (best effort, never a failure) ──
# Asks GitHub to require the `test` check before merging into the default
# branch. ADVISORY by design: it needs admin on the repo, and GitHub only
# enforces protection on public repos for free accounts — a private repo on a
# free plan accepts the API call or rejects it by plan, and neither outcome is
# this machine's fault. So every miss is a quiet skip, never needs_attention.
# An EXISTING protection is left exactly as found — someone configured it.
ensure_branch_protection() {
  local repo branch
  command -v gh >/dev/null 2>&1 || return 0
  gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  repo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || return 0
  branch="$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null)" || return 0
  [[ -n "$repo" && -n "$branch" ]] || return 0

  # Only an explicit "not protected" answer may lead to a PUT. Any OTHER
  # failure (rate limit, network) is indistinguishable from "protected but
  # unreadable", and writing the minimal payload over an existing
  # configuration would break the promise above — so bail without touching it.
  local probe
  if probe="$(gh api "repos/$repo/branches/$branch/protection" 2>&1)"; then
    log_skip "protection: $branch already protected"
    return 0
  elif [[ "$probe" != *"Branch not protected"* && "$probe" != *"HTTP 404"* ]]; then
    return 0
  fi
  if printf '%s' '{"required_status_checks":{"strict":false,"contexts":["test"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}' \
    | gh api -X PUT "repos/$repo/branches/$branch/protection" --input - >/dev/null 2>&1; then
    log_ok "protection: $branch now requires the test check before merge"
  else
    log_skip "protection: not applied to $branch (needs admin, and GitHub enforces it on private repos only on paid plans)"
  fi
}

# ── 3. Labels ──
# Desired set, one label per line: name<TAB>description<TAB>color.
desired_labels() {
  jq -r '
    .groups | to_entries[] | .key as $group | .value.color as $group_color
    | .value.values | to_entries[]
    | "\($group):\(.key)\t\(.value.description)\t\(.value.color // $group_color)"
  ' "$LABELS_JSON"
}

sync_labels() {
  local existing name description color current cur_desc cur_color
  local created=0 updated=0 unchanged=0

  # The manifest ships next to this script; its absence is a broken install,
  # not an offline machine — flag the run so the heal retries next session.
  # Only THIS step and the issue check read it, so --state, --announce, and
  # --decline never need it (a broken install must still answer them).
  if [[ ! -f "$LABELS_JSON" ]]; then
    log_warn "labels: labels.json missing at $LABELS_JSON — reinstall the workflow core"
    needs_attention=1
    return 0
  fi
  # jq reads the manifest and GitHub's answer — only THIS step needs it, so the
  # local heals above still run on a machine without it.
  if ! command -v jq >/dev/null 2>&1; then
    log_skip "labels: jq not installed — skipped"
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    log_skip "labels: gh not installed — skipped"
    return 0
  fi
  if ! gh auth status >/dev/null 2>&1; then
    log_skip "labels: gh not authenticated — skipped"
    return 0
  fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    log_skip "labels: no origin remote — skipped"
    return 0
  fi
  if ! existing="$(gh label list --json name,description,color --limit 300 2>/dev/null)"; then
    log_skip "labels: could not reach GitHub — skipped"
    return 0
  fi

  while IFS=$'\t' read -r name description color; do
    [[ -n "$name" ]] || continue
    current="$(jq -r --arg n "$name" '.[] | select(.name == $n) | "\(.description)\t\(.color)"' <<<"$existing")"

    if [[ -z "$current" ]]; then
      if gh label create "$name" --description "$description" --color "$color" >/dev/null 2>&1; then
        created=$((created + 1))
      else
        # A label the manifest asks for is still missing — retry next session,
        # the same way a missing template file is treated.
        log_warn "labels: could not create $name"
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
    if gh label edit "$name" --description "$description" --color "$color" >/dev/null 2>&1; then
      updated=$((updated + 1))
    else
      log_warn "labels: could not update $name"
      needs_attention=1
    fi
  done < <(desired_labels)

  [[ "$created" -gt 0 ]] && log_ok "labels: created $created"
  [[ "$updated" -gt 0 ]] && log_ok "labels: corrected $updated"
  [[ "$unchanged" -gt 0 ]] && log_skip "labels: $unchanged already correct"
  return 0
}

# ── 4. Open issues carry conforming labels ──
# REPORTS ONLY, like the drift report: templates can be installed before the
# label sync ever ran, GitHub silently drops nonexistent labels at issue
# creation, and web-filed issues arrive unlabeled — so a captured issue can sit
# outside every queue query. The manifest is the rule: an `exclusive` group
# allows at most one of its labels per issue, and a `required` group (status)
# demands exactly one. Needs gh + auth like the label sync; the sync already
# said why those are missing, so this check skips silently without them.
check_issue_labels() {
  local issues bad
  [[ -f "$LABELS_JSON" ]] || return 0
  command -v jq >/dev/null 2>&1 || return 0
  command -v gh >/dev/null 2>&1 || return 0
  gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  issues="$(gh issue list --json number,labels --limit 100 2>/dev/null)" || return 0
  [[ -n "$issues" ]] || return 0
  bad="$(jq -r --slurpfile manifest "$LABELS_JSON" '
    ($manifest[0].groups | to_entries | map(select(.value.exclusive == true))
      | map({ key, required: (.value.required == true) })) as $rules
    | [ .[] | . as $issue
        | select(any($rules[]; . as $rule
            | ([$issue.labels[].name | select(startswith($rule.key + ":"))] | length) as $n
            | $n > 1 or ($rule.required and $n == 0)))
        | "#\(.number)" ]
    | join(" ")' <<<"$issues" 2>/dev/null || true)"
  if [[ -n "$bad" ]]; then
    log_warn "issues: $bad missing a required status:/type: label or carrying two from one exclusive group — run the workkit:triage skill to route them"
  fi
}

# Set by any heal that could not finish on its own — the run stays exit 0 (a
# session start must never wedge) but says plainly that a human is needed.
needs_attention=0
# Set by report_drift when a check could not run for lack of a tool — the
# version is not stamped past a check that never happened.
drift_skipped=0

# BEFORE the state is resolved, and so before the mode dispatch: a repo whose
# answer still sits in .workflow/settings.json would otherwise read as undecided,
# be offered instead of healed, and never reach the migration at all.
migrate_legacy_dir

state="$(resolve_state)"

case "$mode" in
  state)    printf '%s\n' "$state"; exit 0 ;;
  announce) offer_line; printf '\n'; exit 0 ;;
  decline)  record_decline; exit 0 ;;
  enable)   write_repo_optin; state="enabled" ;;
esac

# Nothing is ever written into a repo that has not said yes — not a stub
# settings.json, not a .gitignore line, not a template. Every state is named:
# only a deliberate no is silent, so a state nobody anticipated speaks up rather
# than skipping a repo forever (review finding, 2026-07-24).
case "$state" in
  enabled)    ;;
  undecided)  log_info "$(offer_line)"; exit 0 ;;
  disabled|declined) exit 0 ;;
  unreadable) log_warn "standards: $REPO_SETTINGS is not valid JSON — fix or remove it; healing nothing until then"; exit 0 ;;
  *)          log_warn "standards: unrecognized participation state '$state' — healing nothing; this is a bug worth reporting"; exit 0 ;;
esac

log_info "standards: $root"
ensure_workflow_ignored
ensure_local_file inbox.md
ensure_local_file session.md
ensure_issue_forms
ensure_ci_workflow
ensure_branch_protection
sync_labels
check_issue_labels

# A repo already at the current standard has nothing to look for — the whole
# point of recording the version. Below it, say what is left over, then stamp
# the version forward ONLY if the mechanical heals all succeeded, so a repo that
# half-healed is asked again next time. A drift REPORT is not a failure: those
# findings need a human, and blocking on them would nag every session forever.
repo_now="$(repo_version)"
if [[ "$repo_now" -lt "$STANDARD_VERSION" ]]; then
  # `|| true` is load-bearing, not decoration: it suspends errexit for the whole
  # call, and report_drift both returns 1 (meaning "found something", not a
  # failure) and runs a node pipeline that would abort the script under
  # `set -o pipefail` on a machine without node.
  report_drift || true
  if [[ "$needs_attention" -eq 0 ]]; then
    if [[ "$drift_skipped" -eq 1 ]]; then
      log_skip "standards: version not stamped — the CHANGELOG drift check needs node, which is not available"
    elif ! command -v jq >/dev/null 2>&1; then
      log_skip "standards: version not stamped — writing it needs jq, so the drift report repeats until it is installed"
    elif edit_settings_json "$REPO_SETTINGS" --argjson v "$STANDARD_VERSION" '.version = $v'; then
      log_ok "standard version $repo_now → $STANDARD_VERSION"
    fi
  fi
fi

if [[ "$needs_attention" -eq 1 ]]; then
  log_warn "standards: $root is not fully standardized — see the warning above"
  # Exit non-zero so a caller can tell a partial heal from a clean one: the hook
  # caches the day only on success, so an unfinished repo retries next session
  # instead of going quiet until tomorrow. A non-zero exit never wedges a
  # session — the hook handles it (review finding, 2026-07-24).
  exit 1
fi
exit 0
