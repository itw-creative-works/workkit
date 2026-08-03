#!/usr/bin/env bash
# workflow standards — bring a repo to the issue-workflow standard, idempotently.
#
# The heals, all safe to re-run:
#   1. labels    — create every group:value label from labels.json (SSOT) and
#                  correct description/color drift. Unknown labels are left alone.
#   2. gitignore — make sure `.workkit/` stays untracked EXCEPT settings.json,
#                  the committed file carrying the repo's answer (enabled true/false).
#   2a. gitignore basics — make sure `.DS_Store` and `.env` are ignored, the
#                  two entries every repo needs and the ones a repo is most
#                  often missing. Only the missing ones are appended.
#   3. forms     — install .github/ISSUE_TEMPLATE/ markdown templates so a
#                  first-day teammate files correctly; each one auto-applies
#                  status:inbox + its type and pre-fills the issue anatomy
#                  (## Description then ## Spec), so every issue conforms from
#                  the moment it is filed.
#   4. checks    — install .github/workflows/checks.yml, the required-checks
#                  CI workflow that runs the test suite on every pull request.
#                  Installed once and never overwritten: after the first heal
#                  the copy is the repo's own to extend.
#   4a. changelog lint — vendor changelog.js to .github/changelog-lint.js,
#                  byte-synced on every run so the kit stays the SSOT, and add
#                  the `changelog` job to the repo's checks.yml once. The
#                  format gate then holds for a maintainer with no plugin
#                  installed, which is the only enforcement point CI has.
#   5. protection — best-effort: ask GitHub to require the test check on the
#                  default branch. Quietly skipped wherever the plan or the
#                  token cannot grant it; an existing protection is never
#                  touched.
#   6. claims    — release agent claims that went quiet: an open issue carrying
#                  agent:working with no activity for 24 hours loses the label
#                  and its assignee, goes back from status:building to
#                  status:specced, and gets a comment saying the sweep did it.
#                  The other direction follows it: an open status:specced issue
#                  with an assignee is a claim on an authorized spec — work in
#                  flight — so it moves to status:building with its own comment.
#   6a. roster   — record this repo's path under `repos` in the user settings,
#                  the machine-local index the tower reads instead of walking a
#                  filesystem root, and drop any listed path that is gone or has
#                  since said `enabled: false`. Silent; `workkit doctor` counts it.
#   7. hooks     — assert the hook layer beside this engine is alive: every hook
#                  wired in hooks.json resolves to a script that exists, is
#                  executable, and parses, and the tools they call are present.
#
# One user-level seed runs before any of that, on every invocation: the user's
# own settings file. The engine's public address (~/.claude/workkit → this
# folder) is written by a real heal, or by --engine-link on its own.
#
# Usage: bash standards.sh [--state|--announce|--enable|--decline|--engine-link|--home] [repo_dir]
#        (repo_dir defaults to the current directory)
#
#   (no mode)     heal the repo — but only if it is enabled (see participation)
#   --state       print enabled | disabled | declined | undecided | home | nogit
#                 (home is the tower clone: engine territory, never healed)
#   --announce    print the one-line offer shown to an undecided repo
#   --enable      write the committed opt-in (enabled: true), then heal
#   --decline     record "never ask about this repo again" in the USER settings
#   --engine-link maintain the engine's address and nothing else (no repo needed)
#   --home        heal the TOWER CLONE, and only it: the two heals a repo the
#                 board files into needs (issue forms + labels) and none of the
#                 session-state scaffolding. Refuses any other directory. The
#                 engine calls it — no session ever opens in the clone
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

# The engine's shared helpers, for two things the heal borrows: the settings
# mutex every writer of the user file takes, and the tower clone's address
# (WK_HOME_DIR), which the participation step compares against so the clone is
# never offered, healed or registered. The heal owes the global layer nothing
# else — the roster is machine-local, and the heal writes nothing into the clone
# at all: it carries no opt-in and is engine territory. Sourced when it is there
# and skipped when it is not, so a checkout without it still heals every repo it
# can. Sourcing runs nothing.
if [[ -f "$SCRIPT_DIR/lib.sh" ]]; then
  # shellcheck source=./lib.sh
  . "$SCRIPT_DIR/lib.sh"
fi

# The hook layer that ships beside this engine. The engine runs fine without it
# (it is installed alone wherever someone scripts the standard directly), so the
# self-check below skips silently when there is no hooks.json here.
# WORKFLOW_HOOKS_DIR overrides the location (the tests point at a fixture).
HOOKS_DIR="${WORKFLOW_HOOKS_DIR:-$SCRIPT_DIR/../hooks}"
# The tools the hooks call for their core work. Each hook fails OPEN without
# them by design, so a missing one disables a safety layer in silence — this
# list is what makes that visible once a day.
HOOK_TOOLS="jq git node shasum perl"

# The label an agent applies when it claims an issue, and how long a claim may
# sit without activity before the heal releases it (owner ruling, 2026-07-26:
# assignee accounts cannot tell an agent from a human, because agents run gh as
# the owner, so the claim needs a marker of its own).
CLAIM_LABEL="agent:working"
CLAIM_STALE_SECONDS=86400
# The two pipeline states a release moves between: an unclaimed issue whose spec
# is still accepted is specced, not building.
BUILDING_LABEL="status:building"
SPECCED_LABEL="status:specced"

# The workflow state directory's name, for the ENGINE layer — one string so a
# rename is one edit here. The hooks (hooks/_lib.sh) and the
# test harness (tests/lib/harness.js) hold their own copy for the same reason;
# a test asserts all three still say the same thing.
WORKKIT_DIR=".workkit"

# The standard this script brings a repo to. A repo's committed settings.json
# records the version it was last healed to, so "does this repo need attention?"
# is one integer compare instead of a scan. Bump it when a new heal or a new
# drift check lands; a repo already at the current version does exactly what it
# did before.
STANDARD_VERSION=8

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
  --state|--announce|--enable|--decline|--engine-link|--home) mode="${1#--}"; shift ;;
  --*) log_warn "standards: unknown option $1"; exit 1 ;;
esac

# The engine's public address, for anything that scripts the standard directly:
# ~/.claude/workkit points at this folder. The heal owns it, so a plugin update
# or a fresh machine gets the address from the first session that runs — no
# install step, no module in someone's dotfiles. Two things may write it: a real
# heal, and `--engine-link`, the address step on its own (what `workkit
# setup|update` asks for, so the machine-side install owns no second copy of it).
# A probe answers a question and writes nothing.
#
# The engine stays agent-agnostic: it CREATES nothing under ~/.claude and skips
# quietly on a machine that has no such directory. The address is a convenience
# for the machines that do.
# WORKFLOW_CLAUDE_HOME overrides the parent (the tests point it at a temp dir —
# this step must never touch a real ~/.claude).
CLAUDE_HOME="${WORKFLOW_CLAUDE_HOME:-${HOME:-}/.claude}"
ENGINE_LINK="$CLAUDE_HOME/workkit"

# Only the machine's REAL engine may take the address. A fixture copy, an
# archive, or a partial checkout running this script is not the engine every
# other session resolves — one of them repointing the link stole it from the
# whole machine (verify finding, 2026-07-29). Canonical means: the script sits
# in a git checkout whose origin names the workkit repo. Anything else is a
# quiet skip, not a fault.
is_canonical_checkout() {
  local top url
  command -v git >/dev/null 2>&1 || return 1
  top="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null)" || return 1
  [[ -n "$top" ]] || return 1
  url="$(git -C "$top" remote get-url origin 2>/dev/null)" || return 1
  # The slug is what identifies it — https, ssh, and a trailing .git all read
  # the same, and the owner's letter case is not the engine's business.
  printf '%s' "$url" | grep -Eiq '[/:]workkit(\.git)?/?$'
}

ensure_engine_link() {
  [[ -d "$CLAUDE_HOME" ]] || return 0
  is_canonical_checkout || return 0

  local current
  if [[ -L "$ENGINE_LINK" ]]; then
    current="$(cd "$ENGINE_LINK" 2>/dev/null && pwd -P || true)"
    [[ "$current" == "$SCRIPT_DIR" ]] && return 0
    ln -sfn "$SCRIPT_DIR" "$ENGINE_LINK" \
      && log_ok "engine: repointed $ENGINE_LINK at $SCRIPT_DIR"
  elif [[ -e "$ENGINE_LINK" ]]; then
    log_warn "engine: $ENGINE_LINK is a real file or directory — move it aside so the engine's address can be linked"
  else
    ln -s "$SCRIPT_DIR" "$ENGINE_LINK" \
      && log_ok "engine: linked $ENGINE_LINK → $SCRIPT_DIR"
  fi
}

# The address step alone — it is the ENGINE's address, so it needs no repo and
# answers before the repo is even resolved.
if [[ "$mode" == "engine-link" ]]; then
  ensure_engine_link
  exit 0
fi

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
# reads. Never-asked and declined are PERSONAL (owner ruling, 2026-07-24): a
# teammate seeing `enabled: false` would read it as the project declining when
# it was one developer undecided, so those live in the user's own settings file
# instead.
#
#   enabled   — committed settings.json, `enabled: true` or the key absent
#               (legacy `{ "version": 1 }` opted in by existing at all)
#   disabled  — committed settings.json with `enabled: false`
#   declined  — no committed file; this user recorded a decline for this repo
#   undecided — no committed file, no record: offer once, write nothing
#   home      — this IS the tower clone (below): engine territory, never
#               offered, never healed, never registered
#
# The user's own answers are split by who writes them (issue #80): the roster
# and the declines are the MACHINE's and live in `.repos.json`, while
# `settings.json` beside it is hand-edited and holds only the site options. The
# heal reads and writes the first and never touches the second.
USER_SETTINGS="${WORKFLOW_HOME:-${HOME:-}/$WORKKIT_DIR}/settings.json"
USER_REPOS="${WORKFLOW_HOME:-${HOME:-}/$WORKKIT_DIR}/.repos.json"
REPO_SETTINGS="$WORKKIT_DIR/settings.json"

# The fifth state, and the one no repo can write: `home`, the tower clone. It is
# a git repo like any other to look at, but it is ENGINE TERRITORY — it carries
# no committed opt-in, the engine knows it BY PATH, and the heal writes nothing
# into it, offers it nothing, and never puts it on the roster.
# Compared by PHYSICAL path on both sides (cd + pwd -P, never realpath, which is
# not on every machine): a symlinked home directory would otherwise make the
# same folder look like two. lib.sh owns the address; the fallback keeps this
# working in a checkout without it, where sourcing was skipped above.
HOME_CLONE_DIR="${WK_HOME_DIR:-${WORKFLOW_HOME:-${HOME:-}/$WORKKIT_DIR}/tower}"
is_home_clone() {
  local here there
  here="$(cd "$root" 2>/dev/null && pwd -P)" || return 1
  there="$(cd "$HOME_CLONE_DIR" 2>/dev/null && pwd -P)" || return 1
  [[ -n "$here" && "$here" == "$there" ]]
}

# The user's workflow folder exists from the first run, not from the first
# decline. Someone running this system expects to find it (owner ruling,
# 2026-07-25); a folder that appears only after a particular action reads as
# missing.
# A machine whose dotfiles already track and symlink the folder makes this a
# no-op — it is the path for a machine where nothing has created it yet.
# The seed has ONE writer. `set -C` makes the create O_EXCL, so a --decline
# landing between the test and the write cannot be truncated away. The stderr
# redirect precedes the target: redirections apply left to right, so one written
# last cannot suppress the shell's own message for the redirect before it.
#
# The hand-edited file is seeded with the site options SPELLED OUT rather than
# empty: someone opening it has to be able to see what there is to set, and a
# `{ "version": 1 }` teaches nothing.
#
# `publish` seeds as NULL, never false (issue #84): the switch has three states,
# and a seeded false is an answer nobody gave. `true`/`false` mean someone was
# asked; null (like an absent key) means `workkit setup` still has a question to
# put. Every reader treats anything but `true` as off, so the site stays unpublished either way.
seed_user_settings() {
  local dir="${USER_SETTINGS%/*}"
  [[ -e "$USER_SETTINGS" ]] && return 0
  mkdir -p "$dir" 2>/dev/null || return 0
  ( set -C; printf '{\n  "version": 1,\n  "site": {\n    "repo": null,\n    "publish": null,\n    "url": null\n  }\n}\n' 2>/dev/null >"$USER_SETTINGS" ) || return 0
}
seed_user_settings

# The machine's own file, seeded the same way and for the opposite reason: it is
# written by the engine and by nobody else, so it appears when the engine first
# has something to record rather than sitting there inviting an edit.
seed_user_repos() {
  local dir="${USER_REPOS%/*}"
  [[ -e "$USER_REPOS" ]] && return 0
  mkdir -p "$dir" 2>/dev/null || return 0
  ( set -C; printf '{\n  "version": 1,\n  "repos": {}\n}\n' 2>/dev/null >"$USER_REPOS" ) || return 0
}

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
    log_warn "standards: $f is retired by spec v4 — its contents are work items; run the workkit:migrate skill to file them as issues, then delete it"
    found=1
  done
  if [[ -d "$root/plans" ]]; then
    log_warn "standards: plans/ is retired by spec v4 — a plan is the '## Spec' section of its issue; run the workkit:migrate skill to move each one, then delete the directory"
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
        log_warn "standards: CHANGELOG.md has $bad entries not in the entry format — run the workkit:migrate skill, or 'node ~/.claude/workkit/changelog.js CHANGELOG.md' to see them"
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
  # The clone answers before anything else: a stray .workkit/settings.json that
  # landed in it must not read as a yes.
  if is_home_clone; then
    printf 'home'
    return 0
  fi
  if [[ -f "$REPO_SETTINGS" ]]; then
    case "$(repo_enabled_flag)" in
      false)      printf 'disabled' ;;
      unreadable) printf 'unreadable' ;;
      *)          printf 'enabled' ;;
    esac
    return 0
  fi
  # The machine file is read-only here and the decline is the one decision in it,
  # so no jq means no record — an undecided repo simply gets offered again.
  if [[ -f "$USER_REPOS" ]] && command -v jq >/dev/null 2>&1 \
    && [[ "$(jq -r --arg r "$root" '.repos[$r] // ""' "$USER_REPOS" 2>/dev/null)" == "declined" ]]; then
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

# The state mutex is the engine's, not this script's: `wk_take_state_lock`
# and `wk_drop_state_lock` in lib.sh are the single home, because the home
# repo's writers (the id cache, the home slug) take the same one and a second
# copy of it here would be a second mutex guarding the same files.
record_decline() {
  if ! command -v jq >/dev/null 2>&1; then
    log_warn "decline: jq is required to edit $USER_REPOS"
    exit 1
  fi
  mkdir -p "$(dirname "$USER_REPOS")" 2>/dev/null \
    || { log_warn "decline: cannot create $(dirname "$USER_REPOS")"; exit 1; }
  seed_user_repos
  [[ -f "$USER_REPOS" ]] || { log_warn "decline: cannot write $USER_REPOS"; exit 1; }

  # The decline is written under the shared mutex; the trap releases it however
  # this run ends, since a decline is the last thing it does.
  if wk_take_state_lock; then
    trap 'wk_drop_state_lock' EXIT
  else
    log_warn "decline: proceeding without the lock (held for 5s by another run)"
  fi

  edit_settings_json "$USER_REPOS" --arg r "$root" \
    '.repos = ((.repos // {}) + { ($r): "declined" })' || exit 1

  # A committed answer wins at resolve time, so saying "it will not be offered
  # again" would be a lie while that file says yes.
  if [[ -f "$REPO_SETTINGS" ]]; then
    log_ok "decline: recorded $root in $USER_REPOS"
    log_warn "decline: $REPO_SETTINGS still carries the repo's committed answer, which wins — this takes effect only if that file goes away"
  else
    log_ok "decline: recorded $root in $USER_REPOS — it will not be offered again"
  fi
}

# The machine-local roster: every repo this machine has healed, listed in
# `.repos.json` under the same `repos` key that holds this user's declines
# ("enabled" against the path, "declined" where a decline was recorded). The
# file is the ENGINE's — nothing in it is ever typed by hand, which is why it
# sits beside the hand-edited settings.json rather than in it. It is an INDEX,
# never the answer —
# the repo's committed settings.json stays the SSOT of membership, and this list
# only says which of those repos this machine has seen. The tower reads it
# instead of walking a filesystem root, so a repo never opened here is simply
# not on the dashboard.
#
# Maintained on contact and silently: a heal or an --enable adds the repo it is
# standing in and removes any listed path that is gone, whose committed file is
# gone, or whose committed file now says `enabled: false` — the three ways a
# repo stops being a member, exactly as resolve_state reads them. A decline
# entry is a decision, not an observation, and is never pruned.
#
# Best effort throughout — no jq, no roster file, or a roster file nobody
# can parse each leave the roster as it is. The heal never fails over its index.
register_in_roster() {
  local keys key stale='' stale_json flag locked=0

  command -v jq >/dev/null 2>&1 || return 0
  seed_user_repos
  [[ -f "$USER_REPOS" ]] || return 0

  # A file nobody can parse is SAID, not silently skipped: the roster would go
  # stale forever and the tower would quietly show the wrong machine.
  if ! keys="$(jq -r '(.repos // {}) | to_entries[] | select(.value != "declined") | .key' "$USER_REPOS" 2>/dev/null)"; then
    log_warn "roster: $USER_REPOS is not valid JSON — fix or remove it; until then this machine's roster is not maintained"
    return 0
  fi

  while IFS= read -r key; do
    [[ -n "$key" ]] || continue
    [[ "$key" == "$root" ]] && continue
    if [[ ! -d "$key" ]]; then
      stale="$stale$key"$'\n'
      continue
    fi
    # No committed file is the tri-state's way back to undecided or declined, so
    # it is the same "no longer a member" case as a path that is gone. Left in,
    # the entry would sit on the roster forever while the tower ignored it.
    if [[ ! -f "$key/$REPO_SETTINGS" ]]; then
      stale="$stale$key"$'\n'
      continue
    fi
    # `has`, not `//`: jq's alternative operator treats `false` as absent, which
    # is the one value this check exists to find.
    flag="$(jq -r 'if has("enabled") then (.enabled | tostring) else "absent" end' "$key/$REPO_SETTINGS" 2>/dev/null || true)"
    if [[ "$flag" == "false" ]]; then
      stale="$stale$key"$'\n'
    fi
  done <<<"$keys"

  # Nothing to add and nothing to remove: leave the file untouched, so a session
  # start on an up-to-date machine writes nothing at all.
  if [[ -z "$stale" ]] \
    && jq -e --arg r "$root" '(.repos // {})[$r] == "enabled"' "$USER_REPOS" >/dev/null 2>&1; then
    return 0
  fi

  stale_json="$(printf '%s' "$stale" | jq -Rs 'split("\n") | map(select(length > 0))' 2>/dev/null)" || return 0

  # The same mutex a decline takes, for the same reason: this is a whole-file
  # read-modify-write, and sessions opening together in several repos would
  # otherwise keep only the last one's registration. The heal runs once per repo
  # per day, so a lost registration keeps that repo off the tower, the board and
  # the brief until tomorrow. Released here rather than by an EXIT trap — the
  # heal has work left after this, and holding the lock through it would make
  # every concurrent run wait out the full five seconds.
  if wk_take_state_lock; then locked=1; fi

  edit_settings_json "$USER_REPOS" --arg r "$root" --argjson stale "$stale_json" \
    '.repos = ((.repos // {}) | with_entries(select(.key as $k | ($stale | index($k)) | not)) + { ($r): "enabled" })' \
    || true

  if [ "$locked" -eq 1 ]; then wk_drop_state_lock; fi
  return 0
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
# Append a commented block to .gitignore, keeping the file's shape. A file
# without a trailing newline would swallow the appended line, and a file with
# content gets one blank line of separation. A missing or empty .gitignore gets
# neither — it must not start with a blank line. Shared by the two heals below.
append_gitignore_block() {
  local file=".gitignore" comment="$1" lines="$2"

  if [[ -s "$file" ]]; then
    if [[ -n "$(tail -c 1 "$file")" ]]; then
      printf '\n' >>"$file"
    fi
    printf '\n' >>"$file"
  fi
  printf '# %s\n%s' "$comment" "$lines" >>"$file"
}

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
    append_gitignore_block "Workflow state (workflow spec) — only settings.json is committed" "$lines"
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

# ── 1a. The two entries every .gitignore needs ──
# `.DS_Store` (a Finder file committed by accident on every mac) and `.env`
# (where secrets live, and the reason the vendor guard lets them be edited at
# all). Only the missing ones are appended, so a repo that already covers them
# — in any spelling — is left exactly as it is.
GITIGNORE_BASICS=".DS_Store .env"

# Does .gitignore already cover ENTRY? Exact, or one of the glob spellings that
# plainly contains it. Deliberately not a glob engine: the answer only decides
# whether one more line is appended, so a spelling this misses costs a
# redundant-looking line and never a wrong ignore. A negation (`!`) is not
# coverage, and a comment is not a line.
gitignore_covers() {
  local entry="$1" file=".gitignore" line
  [[ -f "$file" ]] || return 1

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    case "$line" in
      ''|\#*|!*) continue ;;
      "$entry"|"$entry"/) return 0 ;;                       # .env      .env/
      "$entry"'*'|'/'"$entry"|'/'"$entry"'*') return 0 ;;   # .env*     /.env
      '*'"$entry"|'**/'"$entry"|'**/'"$entry"'*') return 0 ;;  # *.env  **/.env
    esac
  done <"$file"
  return 1
}

ensure_gitignore_basics() {
  local entry lines="" added=""

  for entry in $GITIGNORE_BASICS; do
    gitignore_covers "$entry" && continue
    lines="${lines}${entry}"$'\n'
    added="$added $entry"
  done

  if [[ -z "$lines" ]]; then
    log_skip "gitignore: $GITIGNORE_BASICS already ignored"
    return 0
  fi

  append_gitignore_block "Editor and environment files, ignored everywhere" "$lines"
  log_ok "gitignore: added${added}"
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

# ── 2b-i. The CHANGELOG linter, vendored ──
# The entry-format gates (the docs/changelog-guard and safety/commit-gate
# hooks) run only on a machine carrying the plugin, so a maintainer with an
# editor and a GitHub account meets no gate at all. CI is the enforcement point
# every author passes through, and a runner has no kit checkout — so the repo
# gets a copy of the linter it can run from its own tree.
#
# The kit stays the SSOT: the copy is rewritten whenever it differs from what
# this engine would produce, so an edit to the copy is undone on the next heal
# and the header says so. The comparison is over BYTES, which makes the step
# idempotent — a current copy is left untouched and nothing is reported.
CHANGELOG_LINT_DEST=".github/changelog-lint.js"
CHANGELOG_LINT_HEADER="// Vendored from the workflow core's changelog.js by standards.sh — the kit is the SSOT; edit it there. This copy is resynced on every heal."

# The header goes on line 2, after the shebang, so the file stays runnable.
render_changelog_linter() {
  head -n 1 "$CHANGELOG_LINTER"
  printf '%s\n' "$CHANGELOG_LINT_HEADER"
  tail -n +2 "$CHANGELOG_LINTER"
}

ensure_changelog_linter() {
  local dest="$CHANGELOG_LINT_DEST" tmp verb="created"

  if [[ ! -f "$CHANGELOG_LINTER" ]]; then
    log_warn "changelog lint: source missing at $CHANGELOG_LINTER — reinstall the workflow core"
    needs_attention=1
    return 0
  fi

  mkdir -p .github
  tmp="$dest.tmp.$$"
  if ! render_changelog_linter >"$tmp" 2>/dev/null || [[ ! -s "$tmp" ]]; then
    rm -f "$tmp"
    log_warn "changelog lint: could not build $dest from $CHANGELOG_LINTER"
    needs_attention=1
    return 0
  fi

  if [[ -f "$dest" ]]; then
    if cmp -s "$tmp" "$dest"; then
      rm -f "$tmp"
      log_skip "changelog lint: $dest already matches the workflow core"
      return 0
    fi
    verb="resynced"
  fi

  if ! mv "$tmp" "$dest"; then
    rm -f "$tmp"
    log_warn "changelog lint: could not write $dest"
    needs_attention=1
    return 0
  fi
  log_ok "changelog lint: $verb $dest from the workflow core — commit it"
}

# ── 2b-ii. The changelog job in the repo's checks.yml ──
# checks.yml is installed once and then belongs to the repo, so this adds ONE
# job to it rather than overwriting the file: a repo healed before this standard
# would otherwise never get the check, and a repo that extended its workflow
# would lose the extension. Idempotent by presence — the job is added when it is
# not there, and looked for by name every run after.
#
# The job's text has one home, the template, so the two can never drift.
# Appending is only correct while `jobs:` is the last top-level block; anything
# else is a layout this script cannot reason about, so it says what to add and
# leaves the file alone.
ensure_changelog_job() {
  local dest=".github/workflows/checks.yml" src="$TEMPLATES_DIR/github-workflows/checks.yml" block last

  [[ -f "$dest" ]] || return 0
  if grep -qE '^  changelog:' "$dest"; then
    log_skip "checks: the changelog job is already in $dest"
    return 0
  fi
  # A missing template was already reported by the install step above.
  [[ -f "$src" ]] || return 0

  block="$(awk '/^  changelog:/ { f = 1 } f && /^  [A-Za-z_-]+:/ && !/^  changelog:/ { exit } f' "$src")"
  if [[ -z "$block" ]]; then
    log_warn "checks: the template at $src defines no changelog job — reinstall the workflow core"
    needs_attention=1
    return 0
  fi

  last="$(grep -E '^[A-Za-z_-]+:' "$dest" | tail -n 1)"
  if [[ "$last" != "jobs:" ]]; then
    log_skip "checks: $dest does not end in its jobs: block — add a changelog job running 'node $CHANGELOG_LINT_DEST CHANGELOG.md --unreleased-only' by hand"
    return 0
  fi

  if [[ -n "$(tail -c 1 "$dest")" ]]; then
    printf '\n' >>"$dest"
  fi
  printf '%s\n' "$block" >>"$dest"
  log_ok "checks: added the changelog job to $dest — commit it"
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

# GitHub's answer to `gh label list`, kept from the sync so the steps below need
# no second round trip. Empty means the sync never reached GitHub, and they have
# nothing to decide on.
existing_labels=""

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
  existing_labels="$existing"

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

# ── 3b. Agent claims that went quiet are released ──
# An agent that claimed an issue and then died leaves it locked against every
# other worker. The claim is the CLAIM_LABEL plus the assignee, so releasing it
# removes both and says so in a comment — the issue's own trail records who
# freed it and why, which a silent unassign would not.
#
# A released issue that was status:building goes back to status:specced in the
# same edit: the spec is still accepted, the work is simply unclaimed again, and
# leaving it building would keep it counted as in flight by every surface that
# reads the pipeline. Whatever partial progress exists lives in the issue's own
# trail, so nothing is lost by moving the label back.
#
# Fail-safe by shape: only an ANSWER from GitHub licenses a write. A
# query that fails leaves every claim exactly as it is and flags the run, so the
# next session tries again rather than releasing work that is still running.
# A human claim (an assignee and no CLAIM_LABEL) is never in the query's answer
# and is never touched.
#
# The staleness test is jq's, not the shell's: `date -d` and `date -v` disagree
# across platforms, and jq is already required to read GitHub's answer at all.
sweep_stale_claims() {
  local issues stale n assignees args login building body can_flip="" moved=0 failed=0
  command -v jq >/dev/null 2>&1 || return 0
  command -v gh >/dev/null 2>&1 || return 0
  gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  # The label step creates CLAIM_LABEL from the manifest; without a manifest
  # (or a sync that never reached GitHub) the label may not exist here yet, and
  # a query for a label a repo does not have is not a failure worth reporting.
  [[ -n "$existing_labels" ]] || return 0
  jq -e --arg n "$CLAIM_LABEL" 'any(.[]; .name == $n)' <<<"$existing_labels" >/dev/null 2>&1 || return 0
  # The flip is a bonus, the release is the job. `gh issue edit` fails whole
  # when it is handed a label the repo does not have, so a repo whose
  # SPECCED_LABEL never made it to GitHub would lose the release too — the one
  # thing the sweep exists to do. Where the label is missing, release without
  # the flip, exactly as the sweep did before the flip existed.
  if jq -e --arg n "$SPECCED_LABEL" 'any(.[]; .name == $n)' <<<"$existing_labels" >/dev/null 2>&1; then
    can_flip=1
  fi

  if ! issues="$(gh issue list --state open --label "$CLAIM_LABEL" --json number,updatedAt,assignees,labels --limit 100 2>/dev/null)"; then
    log_warn "claims: could not list the issues carrying $CLAIM_LABEL — every claim is left in place"
    needs_attention=1
    return 0
  fi

  stale="$(jq -r --argjson max "$CLAIM_STALE_SECONDS" '
    .[] | select((.updatedAt | fromdateiso8601) < (now - $max)) | .number' <<<"$issues" 2>/dev/null || true)"

  while read -r n; do
    [[ -n "$n" ]] || continue
    # Every assignee comes off with the label: an assignee left behind still
    # reads as a claim to everyone querying the queue.
    assignees="$(jq -r --argjson n "$n" '.[] | select(.number == $n) | .assignees[].login' <<<"$issues" 2>/dev/null || true)"
    args=(--remove-label "$CLAIM_LABEL")
    while read -r login; do
      [[ -n "$login" ]] || continue
      args+=(--remove-assignee "$login")
    done <<<"$assignees"
    # The status flip rides along in the same edit: two edits would leave a
    # window where the issue is unclaimed but still reads as in flight.
    building=""
    if [[ -n "$can_flip" ]] && jq -e --argjson n "$n" --arg b "$BUILDING_LABEL" \
        '.[] | select(.number == $n) | any(.labels[]; .name == $b)' <<<"$issues" >/dev/null 2>&1; then
      building=1
      args+=(--remove-label "$BUILDING_LABEL" --add-label "$SPECCED_LABEL")
    fi

    if ! gh issue edit "$n" "${args[@]}" >/dev/null 2>&1; then
      log_warn "claims: could not release the stale claim on #$n — left as it was"
      failed=1
      continue
    fi
    # The comment follows the release, never precedes it: a comment about a
    # release that then failed would be the issue's record of something that
    # did not happen.
    body="Released by the standards stale-claim sweep: this issue carried $CLAIM_LABEL with no activity for 24 hours, so the label and any assignee were cleared. It is free to claim again."
    if [[ -n "$building" ]]; then
      body="$body It also went back from $BUILDING_LABEL to $SPECCED_LABEL — the spec is still accepted, the work is simply unclaimed; whatever partial progress exists is in this issue's own trail."
    fi
    gh issue comment "$n" --body "$body" >/dev/null 2>&1 \
      || log_warn "claims: released #$n but could not comment on it"
    moved=$((moved + 1))
  done <<<"$stale"

  [[ "$failed" -eq 1 ]] && needs_attention=1
  [[ "$moved" -gt 0 ]] && log_ok "claims: released $moved stale $CLAIM_LABEL claim(s) — idle for over 24 hours"
  return 0
}

# ── 3c. A claimed spec is work in flight ──
# `status:specced` is the authorization to start and the assignee is the claim,
# so an open issue carrying both has STARTED: the spec's flip to
# status:building happens the moment work does. Every surface reading the queue
# used to tolerate the claimed-specced shape as in flight instead, which made a
# transitional branch permanent because nothing ever flipped the issues. This
# sweep is what flips them (issue #62), so the label says what is true and the
# readers need no tolerance at all.
#
# It cannot fight the release sweep, which runs FIRST and removes the assignee
# in the same edit that demotes an issue to specced: what it releases has no
# claim left for this to promote. Neither ever sees the shape the other made.
#
# Fail-safe by shape, like the sweep above: only an ANSWER from GitHub licenses
# a write, and a repo whose BUILDING_LABEL never reached GitHub is left alone
# rather than edited into a whole-command failure.
flip_claimed_specced() {
  local issues claimed n moved=0 failed=0
  command -v jq >/dev/null 2>&1 || return 0
  command -v gh >/dev/null 2>&1 || return 0
  gh auth status >/dev/null 2>&1 || return 0
  git remote get-url origin >/dev/null 2>&1 || return 0
  [[ -n "$existing_labels" ]] || return 0
  jq -e --arg n "$BUILDING_LABEL" 'any(.[]; .name == $n)' <<<"$existing_labels" >/dev/null 2>&1 || return 0

  if ! issues="$(gh issue list --state open --label "$SPECCED_LABEL" --json number,assignees --limit 100 2>/dev/null)"; then
    log_warn "claims: could not list the issues carrying $SPECCED_LABEL — nothing was flipped"
    needs_attention=1
    return 0
  fi

  claimed="$(jq -r '.[] | select((.assignees | length) > 0) | .number' <<<"$issues" 2>/dev/null || true)"

  while read -r n; do
    [[ -n "$n" ]] || continue
    if ! gh issue edit "$n" --remove-label "$SPECCED_LABEL" --add-label "$BUILDING_LABEL" >/dev/null 2>&1; then
      log_warn "claims: could not flip #$n to $BUILDING_LABEL — left as it was"
      failed=1
      continue
    fi
    # The comment follows the edit, never precedes it: the issue's trail records
    # what happened, not what was about to be tried.
    gh issue comment "$n" --body "Flipped to $BUILDING_LABEL by the standards sweep: this issue was $SPECCED_LABEL with an assignee, which is a claim on an authorized spec — work in flight. If nobody is working on it, remove the assignee and put $SPECCED_LABEL back." >/dev/null 2>&1 \
      || log_warn "claims: flipped #$n but could not comment on it"
    moved=$((moved + 1))
  done <<<"$claimed"

  [[ "$failed" -eq 1 ]] && needs_attention=1
  [[ "$moved" -gt 0 ]] && log_ok "claims: flipped $moved claimed $SPECCED_LABEL issue(s) to $BUILDING_LABEL"
  return 0
}

# ── 4. Open issues carry conforming labels ──
# A violation FLAGS THE RUN (owner ruling, 2026-07-28: a missing status is an
# error, a double status is an error): templates can be installed before the
# label sync ever ran, GitHub silently drops nonexistent labels at issue
# creation, and web-filed issues arrive unlabeled — so a captured issue can sit
# outside every queue query, and the heal must keep saying so every session
# until it is routed, not once a day. The manifest is the rule: an `exclusive`
# group allows at most one of its labels per issue, and a `required` group
# (status, type) demands exactly one. Needs gh + auth like the label sync; the
# sync already said why those are missing, so this check skips silently
# without them.
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
    needs_attention=1
  fi
}

# ── 5. The hook layer is alive ──
# Every hook fails OPEN by design — a broken hook must never wedge a session —
# so a chmod-stripped script, a syntax error, or a missing tool disables a
# safety layer with nothing watching (issue #2). The per-event fail-open stays;
# this is the once-a-day assertion that the layer exists at all.
#
# Reports only, in two registers. A hook that cannot run is a BROKEN INSTALL:
# it warns and flags the run, the same as a missing template. A missing TOOL is
# a machine condition, not a repo's fault — it warns just as loudly but does not
# flag the run, so the version stamp and the drift report are not held hostage
# to something no repo can fix.
hook_names() {
  # Each wired command is `…/loader.sh <prefix>:<name>`; the name is what
  # resolves to a directory on disk.
  jq -r '.. | objects | select(has("command")) | .command' "$HOOKS_DIR/hooks.json" 2>/dev/null \
    | sed -E 's|.*loader\.sh[[:space:]]+||; s|[[:space:]].*||' \
    | grep -E '^[a-z]+[:/][a-z-]+$' | sort -u || true
}

hooks_checked=0
check_hook_layer() {
  local manifest="$HOOKS_DIR/hooks.json" name tool missing=""

  # No hook layer beside the engine: this is the engine installed on its own,
  # not a broken install.
  [[ -f "$manifest" ]] || return 0

  for tool in $HOOK_TOOLS; do
    command -v "$tool" >/dev/null 2>&1 || missing="$missing $tool"
  done
  if [[ -n "$missing" ]]; then
    log_warn "hooks: the hook layer needs$missing — without them the hooks exit 0 and their checks silently do not run"
  fi

  # Everything below reads the manifest, which needs jq. Without it the tool
  # warning above has already said what is wrong.
  command -v jq >/dev/null 2>&1 || return 0

  # The router every wired command goes through is checked first: unusable here
  # means no hook runs at all, whatever the scripts behind it look like.
  check_hook_script "loader.sh" "$HOOKS_DIR/loader.sh"
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    check_hook_script "$name" "$HOOKS_DIR/${name//://}/run.sh"
  done < <(hook_names)

  # The extraction's name filter is exact on purpose, so a wired command it
  # cannot parse would silently fall out of the check — compare against the
  # raw count of loader.sh commands and say so instead.
  local wired
  wired="$(jq -r '.. | objects | select(has("command")) | .command' "$HOOKS_DIR/hooks.json" 2>/dev/null \
    | grep 'loader\.sh' | sort -u | grep -c . || true)"
  if [[ -n "$wired" && "$wired" -gt $((hooks_checked - 1)) ]]; then
    log_warn "hooks: $wired commands are wired through loader.sh but only $((hooks_checked - 1)) resolved to checkable names — a hook name the checker cannot parse is going unchecked"
  fi

  [[ "$hooks_checked" -gt 0 ]] && log_skip "hooks: $hooks_checked hook scripts resolve, are executable, and parse"
  return 0
}

# One wired hook, by the three ways it can be dead. Counts into hooks_checked.
check_hook_script() {
  local name="$1" script="$2"
  hooks_checked=$((hooks_checked + 1))
  if [[ ! -f "$script" ]]; then
    log_warn "hooks: $name is wired in hooks.json but there is no script at $script — reinstall the workkit plugin"
    needs_attention=1
    return 0
  fi
  if [[ ! -x "$script" ]]; then
    log_warn "hooks: $name is not executable — the loader skips it and its checks never run (chmod +x $script)"
    needs_attention=1
    return 0
  fi
  if ! bash -n "$script" 2>/dev/null; then
    log_warn "hooks: $name has a syntax error — it exits non-zero before doing anything (bash -n $script)"
    needs_attention=1
    return 0
  fi
  return 0
}

# Set by any heal that could not finish on its own — the run stays exit 0 (a
# session start must never wedge) but says plainly that a human is needed.
needs_attention=0
# Set by report_drift when a check could not run for lack of a tool — the
# version is not stamped past a check that never happened.
drift_skipped=0

state="$(resolve_state)"

case "$mode" in
  state)    printf '%s\n' "$state"; exit 0 ;;
  announce) offer_line; printf '\n'; exit 0 ;;
  # The tower clone's own heal (issue #123). The clone is engine territory and
  # no session ever starts in it, so the two heals that make a repo FILEABLE
  # INTO — the labels every queue reads and the forms that apply them — are run
  # from the engine instead: `wk_home_heal` at setup and every morning. Same
  # code as every other repo gets, which is the whole point; the difference is
  # only which steps and who triggers them. The participation gate is not
  # bypassed but INVERTED — this mode heals the clone and refuses anything
  # else, so it can never write into a repo that has not said yes.
  home)     if [[ "$state" != "home" ]]; then
              log_warn "standards: $root is not the tower clone — --home heals the home repo and nothing else"
              exit 1
            fi
            log_info "standards: $root (the home clone)"
            ensure_issue_forms
            sync_labels
            [[ "$needs_attention" -eq 0 ]] || exit 1
            exit 0 ;;
  decline)  if [[ "$state" == "home" ]]; then
              log_warn "standards: $root is the tower clone — engine territory, and it never participates (nothing recorded)"
              exit 1
            fi
            record_decline; exit 0 ;;
  enable)   if [[ "$state" == "home" ]]; then
              log_warn "standards: $root is the tower clone — engine territory, and it never participates"
              exit 1
            fi
            write_repo_optin; state="enabled" ;;
esac

# Nothing is ever written into a repo that has not said yes — not a stub
# settings.json, not a .gitignore line, not a template. Every state is named:
# only a deliberate no is silent, so a state nobody anticipated speaks up rather
# than skipping a repo forever (review finding, 2026-07-24).
case "$state" in
  enabled)    ;;
  home)       log_skip "standards: $root is the tower clone — engine territory, nothing to heal"; exit 0 ;;
  undecided)  log_info "$(offer_line)"; exit 0 ;;
  disabled|declined) exit 0 ;;
  unreadable) log_warn "standards: $REPO_SETTINGS is not valid JSON — fix or remove it; healing nothing until then"; exit 0 ;;
  *)          log_warn "standards: unrecognized participation state '$state' — healing nothing; this is a bug worth reporting"; exit 0 ;;
esac

log_info "standards: $root"
# The address is written by a real heal only: a --state or --announce probe
# answers a question and writes nothing, and a repo that has not said yes is
# offered and left alone. Both exit above this line.
ensure_engine_link
register_in_roster
ensure_workflow_ignored
ensure_gitignore_basics
ensure_local_file inbox.md
ensure_local_file session.md
ensure_issue_forms
ensure_ci_workflow
ensure_changelog_linter
ensure_changelog_job
ensure_branch_protection
sync_labels
sweep_stale_claims
flip_claimed_specced
check_issue_labels
check_hook_layer

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
