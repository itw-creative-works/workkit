#!/bin/bash
# hooks/_lib.sh — helpers shared by hook scripts. Source it, never execute:
#   . "${BASH_SOURCE[0]%/*}/../../_lib.sh"   (from a depth-2 hook dir)
# Every helper fails toward the SAFE side for guards (visible text gates;
# missing tools degrade, never crash the hook).
#
# Consumers: safety/commit-gate, safety/commit-language (the git-commit
# detection trio below); safety/commit-gate + docs/changelog-guard
# (hook_changelog_linter); manager/resolver + manager/profile
# (hook_session_model, hook_model_tier, hook_manager_config). Add helpers
# only with a second named consumer.
#
# hook_session_model also exists in the user's personal hooks (~/.claude/hooks),
# where claude/session/context needs it. The duplication is deliberate: a
# plugin directory is not a stable import target for the personal hooks, so
# neither side sources the other. Change both together.

# The workflow state directory's name, for the HOOK layer — one string so a
# rename is one edit here. The other two layers hold their own copy for the
# same reason (the engine, workflow/standards.sh, and the test harness,
# tests/lib/harness.js); a test asserts all three still say the same thing.
# Hooks that do not source this file keep the literal and point back here.
WORKKIT_DIR=".workkit"

# hook_strip_heredocs <cmd> — remove heredoc BODIES (marker to terminator)
# for command DETECTION: bodies are file content, not commands (gotchas sweep
# 2026-07-23). EXCEPT when a heredoc feeds an interpreter (`bash <<EOF`) —
# that body IS executed code, so the strip is disabled entirely (light review
# 2026-07-23: stripping it opened a commit-gate bypass). Unterminated
# heredocs don't match and stay visible — fails toward gating, never bypass.
hook_strip_heredocs() {
  if ! command -v perl >/dev/null 2>&1 \
    || printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_.-])(bash|sh|zsh|dash|ksh|eval|env)([[:space:]][^;&|]*)?<<'; then
    printf '%s' "$1"
    return 0
  fi
  printf '%s' "$1" | perl -0777 -pe 's/(<<-?\s*(["\x27]?)([A-Za-z_][A-Za-z0-9_]*)\2).*?\n[\t ]*\3[\t ]*(?=\n|$)/$1/gs' 2>/dev/null || printf '%s' "$1"
}

# hook_strip_quotes <text> — replace single- and double-quoted spans with one
# inert placeholder word each. It REPLACES rather than deletes because the
# caller walks the result positionally: deleting the message in
# `git commit -m "docs" app.js` left `-m` to consume `app.js`, so the pathspec
# went unseen and the whole gate was skipped (issue #25). The placeholder holds
# the slot, carries no clause separator, and can never be read as a flag.
# An EMPTY span is still deleted, not replaced: deletion rejoins the text around
# it, and `git com""mit` is a real command that must stay detectable.
# The sed fallback stays line-based, so a multi-line quoted message there still
# truncates the clause — it fails toward gating, but a pathspec after such a
# message is not seen. Machines with perl (nearly all of them) take the first branch.
# MULTILINE-safe: a line-based strip leaves the tail lines of a multi-line
# quoted string looking unquoted, so a mention like `echo "todo\ngit commit"`
# would classify as a real commit (review 2026-07-23). The strip is ONE
# left-to-right alternation pass — sequential passes (doubles then singles,
# or the reverse) let a quote character INSIDE one span type pair with a
# later real span and swallow the command text between them (review
# 2026-07-23: `grep '"' f; git commit ...` hid the commit clause). On perl
# failure the text passes through UNSTRIPPED — a quoted mention may then
# false-gate, but a real commit can never hide (fails toward gating). Falls
# back to a line-based sed alternation only when perl is missing.
hook_strip_quotes() {
  if command -v perl >/dev/null 2>&1; then
    printf '%s' "$1" | perl -0777 -pe 's{"(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27}{ length($&) > 2 ? "_hookq_" : "" }ges' 2>/dev/null || printf '%s' "$1"
  else
    printf '%s' "$1" | sed -E "s/''|\"\"//g; s/'[^']*'|\"[^\"]*\"/_hookq_/g"
  fi
}

# _hook_count_placeholders <text> — count the `_hookq_` placeholders the quote
# strip left in <text>, into HOOK_PLACEHOLDER_COUNT. Pure parameter expansion —
# this runs inside hook_find_git_commit's per-clause walk, which sits on the
# PreToolUse path of every Bash command. Internal to hook_find_git_commit's
# placeholder-to-span mapping, not a general helper.
_hook_count_placeholders() {
  local s="$1"
  HOOK_PLACEHOLDER_COUNT=0
  while :; do
    case "$s" in
      *_hookq_*) s="${s#*_hookq_}"; HOOK_PLACEHOLDER_COUNT=$((HOOK_PLACEHOLDER_COUNT + 1)) ;;
      *) break ;;
    esac
  done
}

# _hook_span_is_commit <src> <n> — does the Nth (0-based) non-empty quoted
# span of <src> carry both `git` and `commit` as words? <src> is the
# heredoc-stripped ORIGINAL text, so its non-empty spans line up one-to-one
# with the `_hookq_` placeholders the strip wrote (empty spans are deleted,
# and the extraction skips them the same way). On a perl runtime failure — or
# with no perl at all — the answer degrades to "does the whole command carry
# git and commit as words": coarse, and toward the gate, but scoped (review
# 2026-07-25: a runtime failure used to flag EVERY Bash command outright).
# Internal to hook_find_git_commit, not a general helper.
_hook_span_is_commit() {
  local out rc=0
  if command -v perl >/dev/null 2>&1; then
    out=$(printf '%s' "$1" | perl -0777 -ne '
      my $n = '"$2"'; my $i = 0;
      while (/"(?:[^"\\]|\\.)*"|\x27[^\x27]*\x27/gs) {
        # Copy $& first: matching AGAINST $& would overwrite it mid-test.
        my $s = $&;
        next if length($s) <= 2;
        next unless $i++ == $n;
        print "W" if $s =~ /\bgit\b/ && $s =~ /\bcommit\b/;
        last;
      }' 2>/dev/null) || rc=$?
    if [ "$rc" -eq 0 ]; then
      [ "$out" = "W" ] && return 0
      return 1
    fi
  fi
  printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_])git([^[:alnum:]_]|$)' \
    && printf '%s' "$1" | grep -Eq '(^|[^[:alnum:]_])commit([^[:alnum:]_]|$)'
}

# hook_find_git_commit <cmd> — scan a Bash tool command for a real
# `git ... commit` clause (not a quoted mention, not heredoc file content).
# Splits the stripped command on ; & | and looks for a clause that invokes
# git — allowing `(`/`{` openers, `command`/`env`/`eval` prefixes, VAR=value
# assignments, and path spellings like /usr/bin/git — whose SUBCOMMAND (the
# first non-option word after git's global options) is `commit`, so
# `git log --grep commit` is not a commit (hardening 2026-07-25; each of
# those prefix shapes had walked past the old first-word-is-git test).
# Sets: HOOK_COMMIT_CLAUSE (the quote-stripped clause, empty if none),
#       HOOK_SAW_CD (1 if ANY clause starts with `cd`, `pushd` or `popd` — the
#       wrong-repo signal; all three address a different directory for what
#       follows, and the pushd spelling used to walk straight past this test
#       (issue #159)),
#       HOOK_SAW_STAGE (1 if a git clause BEFORE the commit stages — add/rm/mv/
#       stage — so the commit's content is decided by the same command line and
#       cannot be read ahead of it; the walk breaks at the commit clause, so
#       only clauses that change what the commit carries are seen),
#       HOOK_WRAPPED_COMMIT (1 when an interpreter string carries the commit:
#       `sh -c "git commit …"` / `eval "git commit …"` — the quote strip
#       replaces that span with a placeholder, so the clause scan can never
#       see inside it; consumers fail toward the gate).
# Wrapped detection reads COMMAND POSITION, never the raw text: only a clause
# whose command (after the peel) is an interpreter carrying a -c string, or an
# eval whose argument is a quoted span, has its ORIGINAL span tested for
# git+commit words. A quoted span anywhere else — a grep pattern, echo text,
# the -m message itself — is data and can never flag (review 2026-07-25: the
# old raw-text regex blocked `git commit -m "… sh -c 'git commit' …"`, and
# the block message asked for the plain form the user was already running).
hook_find_git_commit() {
  HOOK_COMMIT_CLAUSE=""
  HOOK_SAW_CD=0
  HOOK_SAW_STAGE=0
  HOOK_WRAPPED_COMMIT=0
  local src stripped clause sub w pre expect saw_eval nc ci pi=0 had_glob=1
  src=$(hook_strip_heredocs "$1")
  stripped=$(hook_strip_quotes "$src")
  # No glob expansion during the word split below; restore on return.
  case $- in *f*) had_glob=0 ;; esac
  set -f
  while IFS= read -r clause; do
    # Placeholder bookkeeping for the wrapped test: `pi` placeholders sit in
    # the clauses already scanned, `ci` in the words of this clause already
    # walked — so a candidate's span sits at ordinal pi+ci in the ORIGINAL.
    _hook_count_placeholders "$clause"
    nc=$HOOK_PLACEHOLDER_COUNT
    ci=0
    saw_eval=0
    # shellcheck disable=SC2086  # word splitting is intentional; quotes are stripped
    set -- $clause
    # Peel wrapper prefixes so `(git …`, `{ git …; }`, `command git …`,
    # `env git …`, and `GIT_DIR=x git …` read as the git clause they run.
    # `eval` peels too: over PLAIN words it executes them essentially as
    # written, so the remainder IS the clause (hardening 2026-07-25 — an
    # unquoted `eval git commit -m x` walked past both hooks). The peeled
    # words stay in HOOK_COMMIT_CLAUSE for consumers to judge.
    while [ $# -gt 0 ]; do
      case "$1" in
        \(|\{) shift ;;
        \(*) w="${1#\(}"; shift; set -- "$w" "$@" ;;
        command|env) shift ;;
        eval) saw_eval=1; shift ;;
        [A-Za-z_]*=*) _hook_count_placeholders "$1"; ci=$((ci + HOOK_PLACEHOLDER_COUNT)); shift ;;
        *) break ;;
      esac
    done
    case "${1:-}" in
      cd|pushd|popd) HOOK_SAW_CD=1 ;;
    esac
    # eval whose argument is a QUOTED span: the strip replaced the span with a
    # placeholder, so nothing below can read it — test the ORIGINAL span. A
    # quote character surviving here means the strip did not run (no perl, or
    # perl failed), where the span test degrades to the coarse whole-command
    # word test — toward the gate either way.
    if [ "$saw_eval" -eq 1 ]; then
      case "${1:-}" in
        _hookq_*|\"*|\'*)
          if _hook_span_is_commit "$src" "$((pi + ci))"; then HOOK_WRAPPED_COMMIT=1; fi
          pi=$((pi + nc))
          continue
          ;;
      esac
    fi
    # An interpreter in command position carrying a -c string is the same
    # wrapped shape by another spelling — `sh -c "git commit …"`, `bash -lc
    # '…'`, and the attached `bash -c"…"` (no space, which the old raw-text
    # regex demanded and so missed).
    case "${1:-}" in
      sh|bash|zsh|dash|ksh|*/sh|*/bash|*/zsh|*/dash|*/ksh)
        shift
        expect=0
        while [ $# -gt 0 ]; do
          case "$1" in
            _hookq_*|\"*|\'*)
              # The string operand. Only a preceding -c cluster makes it
              # executed code — `bash "script.sh"` names a FILE.
              if [ "$expect" -eq 1 ] && _hook_span_is_commit "$src" "$((pi + ci))"; then
                HOOK_WRAPPED_COMMIT=1
              fi
              break
              ;;
            -[!-]*)
              # A short option cluster. With the string ATTACHED (`-c_hookq_`,
              # or a raw quote when the strip did not run) the cluster before
              # it must end in c; otherwise a cluster carrying c makes the
              # NEXT operand the string.
              pre="${1%%_hookq_*}"
              [ "$pre" = "$1" ] && pre="${1%%[\"\']*}"
              if [ "$pre" != "$1" ]; then
                case "$pre" in
                  *c) if _hook_span_is_commit "$src" "$((pi + ci))"; then HOOK_WRAPPED_COMMIT=1; fi ;;
                esac
                break
              fi
              case "$1" in *c*) expect=1 ;; esac
              shift
              ;;
            --*) _hook_count_placeholders "$1"; ci=$((ci + HOOK_PLACEHOLDER_COUNT)); shift ;;
            *) break ;;
          esac
        done
        pi=$((pi + nc))
        continue
        ;;
    esac
    case "${1:-}" in
      git|*/git) ;;
      *) pi=$((pi + nc)); continue ;;
    esac
    shift
    # Find git's subcommand: skip global options, where value-taking ones
    # (-C <dir>, -c <k=v>, --git-dir <p>, …) consume their separate value so
    # it can never be read as the subcommand.
    sub=""
    while [ $# -gt 0 ]; do
      case "$1" in
        -C|-c|--git-dir|--work-tree|--namespace|--exec-path) [ $# -ge 2 ] || break; shift 2 ;;
        -*) shift ;;
        *) sub="$1"; break ;;
      esac
    done
    # A staging subcommand in the same command line, ahead of the commit: what
    # the commit will carry is written by a clause that has not run yet.
    case "$sub" in
      add|rm|mv|stage) HOOK_SAW_STAGE=1 ;;
    esac
    if [ "$sub" = "commit" ]; then HOOK_COMMIT_CLAUSE="$clause"; break; fi
    pi=$((pi + nc))
  done <<EOF
$(printf '%s' "$stripped" | tr ';|&' '\n')
EOF
  [ "$had_glob" -eq 1 ] && set +f
  return 0
}

# Resolve the workflow engine's CHANGELOG linter — the single home for the
# entry rules, shared by the docs/changelog-guard hook (write time) and the
# safety/commit-gate hook (commit time). Prints the path; returns non-zero when
# node or the engine is missing, so both callers fail open the same way.
hook_changelog_linter() {
  command -v node >/dev/null 2>&1 || return 1
  # Resolve the engine from this file's PHYSICAL location — `pwd -P` resolves
  # any symlink in the path before the `..` walk, so the climb out of hooks/
  # lands on the real workflow/ beside it instead of a textual path that does
  # not exist. Same form (and the same WORKFLOW_DIR override for tests) as the
  # workflow/standards hook.
  local dir="${WORKFLOW_DIR:-}"
  [ -n "$dir" ] || dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/../workflow"
  [ -f "$dir/changelog.js" ] || return 1
  printf '%s\n' "$dir/changelog.js"
}

# hook_session_model <session_id> <transcript_path> — the session's CURRENT
# model, resolved the only honest way (the accuracy contract lives in
# claude/session/context/README.md: the model/effort env vars are settings
# defaults frozen at launch and are NEVER read). Sets:
#   HOOK_SESSION_MODEL     — raw model id (e.g. claude-fable-5[1m]); empty when
#                            unknowable (first prompt of a fresh VS Code session)
#   HOOK_SESSION_MODEL_SRC — live | transcript | none
# Tiers: the statusline cache written per-session by claude/session/statusline
# (live, terminal sessions only; trusted only when statusline-shaped — model or
# thinking present), then the transcript's last assistant entry (exact, lags
# one response). Callers treat empty as "unknown", never as an error.
# Consumers: manager/resolver, manager/profile (and, in a user's personal
# hooks, claude/session/context — see the duplication note at the top).
hook_session_model() {
  HOOK_SESSION_MODEL=""
  HOOK_SESSION_MODEL_SRC="none"
  local session_id="$1" transcript_path="${2:-}" safe state_file
  [ -n "$session_id" ] || return 1
  safe="${session_id//[^a-zA-Z0-9]/_}"
  state_file="${TMPDIR:-/tmp}/claude-session-state/${safe}.json"
  if [ -f "$state_file" ]; then
    # The statusline-shape trust gate (model/thinking present) exists for the
    # cache's EFFORT fields; for the model itself, present is trustworthy and
    # absent is absent — no gate needed here.
    HOOK_SESSION_MODEL=$(jq -r '.model.id // empty' "$state_file" 2>/dev/null || true)
    [ -n "$HOOK_SESSION_MODEL" ] && HOOK_SESSION_MODEL_SRC="live"
  fi
  if [ -z "$HOOK_SESSION_MODEL" ] && [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
    # Last assistant entry's message.model — grep narrows, jq validates real
    # entries so quoted transcript content can never poison the value.
    HOOK_SESSION_MODEL=$(grep '"type":"assistant"' "$transcript_path" 2>/dev/null | tail -20 \
      | jq -R -r 'fromjson? | select(.type == "assistant") | .message.model // empty' 2>/dev/null \
      | tail -1 || true)
    [ -n "$HOOK_SESSION_MODEL" ] && HOOK_SESSION_MODEL_SRC="transcript"
  fi
  [ -n "$HOOK_SESSION_MODEL" ]
}

# hook_model_tier <model_id> — the model family a raw id belongs to. Sets
# HOOK_MODEL_TIER to fable|opus|sonnet|haiku (empty + non-zero return for an
# unrecognized id — callers decide their own "unknown" behavior). Pure string
# logic: strips context-window suffixes like [1m] and matches the family word,
# so claude-opus-5[1m], claude-opus-4-5, and a bare "opus" all read as opus.
# Consumers: manager/resolver, manager/profile.
hook_model_tier() {
  HOOK_MODEL_TIER=""
  local id="${1%%[*}"
  case "$id" in
    *fable*)  HOOK_MODEL_TIER="fable" ;;
    *opus*)   HOOK_MODEL_TIER="opus" ;;
    *sonnet*) HOOK_MODEL_TIER="sonnet" ;;
    *haiku*)  HOOK_MODEL_TIER="haiku" ;;
    *) return 1 ;;
  esac
}

# _hook_manager_layer <settings_file> — the OVERRIDABLE slice of a settings
# file's `manager` block, as a compact JSON object ({} for a missing file, one
# without the block, or anything jq cannot read). Only `mode`, `enabled`, and
# the three `tiers` keys are overridable — `classes` and `ladder` stay global,
# so a repo can move a class onto a cheaper rung but never redefine the rungs
# themselves. Internal to hook_manager_config.
_hook_manager_layer() {
  [ -f "$1" ] || { printf '{}'; return 0; }
  jq -c '(.manager // {})
    | {mode: .mode, enabled: .enabled,
       tiers: ((.tiers // {}) | {frontier, workhorse, fast} | with_entries(select(.value != null)))}
    | with_entries(select(.value != null and .value != {}))' "$1" 2>/dev/null || printf '{}'
}

# hook_manager_config <ladder_path> <cwd> — the manager system's EFFECTIVE
# config for this session, as a compact JSON object in HOOK_MANAGER_CONFIG.
# Three layers, deep-merged, each beating the one before it:
#   GLOBAL  the ladder manifest (the SSOT; MANAGER_LADDER overrides the path)
#   USER    the `manager` block of ~/.workkit/settings.json
#           (MANAGER_USER_SETTINGS overrides the path)
#   REPO    the `manager` block of <repo root>/.workkit/settings.json, the
#           repo root resolved from <cwd> by git (plain <cwd> when git says
#           nothing); skipped entirely when <cwd> is empty
# The settings files' own top-level keys belong to the ISSUE-WORKFLOW system
# and are never read here — the manager's config is the separate `manager` key.
# Returns non-zero when the merged config carries `enabled: false`: the repo
# has opted out of the crew, and both consumers do nothing at all. Every other
# failure (no jq, missing or unparseable file, no git) contributes nothing and
# falls through to the layer below — a config read must never break a session.
# Consumers: manager/resolver, manager/profile.
hook_manager_config() {
  local ladder="$1" cwd="${2:-}" global="{}" user repo="{}" repo_root off
  HOOK_MANAGER_CONFIG="{}"
  command -v jq >/dev/null 2>&1 || return 0
  if [ -f "$ladder" ]; then
    global=$(jq -c 'if type == "object" then . else {} end' "$ladder" 2>/dev/null || printf '{}')
  fi
  user=$(_hook_manager_layer "${MANAGER_USER_SETTINGS:-$HOME/$WORKKIT_DIR/settings.json}")
  if [ -n "$cwd" ]; then
    repo_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null || true)
    [ -n "$repo_root" ] || repo_root="$cwd"
    repo=$(_hook_manager_layer "$repo_root/$WORKKIT_DIR/settings.json")
  fi
  HOOK_MANAGER_CONFIG=$(printf '%s\n%s\n%s\n' "$global" "$user" "$repo" \
    | jq -c -s '.[0] * .[1] * .[2]' 2>/dev/null || printf '%s' "$global")
  # `.enabled // true` would read FALSE as absent, so the test is explicit.
  off=$(printf '%s' "$HOOK_MANAGER_CONFIG" | jq -r 'if .enabled == false then "1" else "" end' 2>/dev/null || true)
  [ -z "$off" ]
}

# A file's modification time, in seconds since the epoch; 0 when it cannot be
# read. `stat` disagrees across platforms and does NOT fail cleanly: on GNU
# coreutils `-f` selects filesystem status, where `%m` is undefined, so
# `stat -f %m` prints `?` and exits 0 — a plain `||` chain never reaches the
# GNU spelling and hands the caller a non-numeric string. Each spelling is
# therefore accepted only when its output is all digits.
hook_file_mtime() {
  local ts
  for ts in "$(stat -c %Y "$1" 2>/dev/null)" "$(stat -f %m "$1" 2>/dev/null)"; do
    case "$ts" in
      ''|*[!0-9]*) ;;
      *) printf '%s\n' "$ts"; return 0 ;;
    esac
  done
  printf '0\n'
}
