#!/usr/bin/env bash
# workflow/lib/participation.sh: what the kit means by a repo root, by a repo's
# answer and by its own hooks folder, for the engine and the hooks. Sourced,
# functions only; the hooks source it directly so they never load the engine's addresses.

# wk_is_repo_root <dir>: `-e`, never `-d`, since `.git` is a file in a worktree
# and in a submodule. Asked of the directory, so a walk needs no git call apiece.
wk_is_repo_root() {
  [ -e "$1/.git" ]
}

# _wk_settings_key <file> <true|false>: 0 when the top-level `enabled` of <file>
# is that value, non-empty text that does not parse reading false and empty text
# neither; 1 when not; 2 with no node. wk_node is platform.sh's, which every
# caller sources before this file.
_wk_settings_key() {
  local node
  node="$(wk_node)" || return 2
  "$node" -e 'const t = require("fs").readFileSync(process.argv[1], "utf8"); let s = null;
if (t.trim() === "") process.exit(1);
try { s = JSON.parse(t); } catch {}
process.exit((s === null ? false : s.enabled) === (process.argv[2] === "true") ? 0 : 1);' "$1" "$2" 2>/dev/null && return 0
  return 1
}

# wk_settings_declined <file> / wk_settings_enabled <file>: the top-level
# `enabled` key through _wk_settings_key, as the hooks module's gate reads it:
# unreadable or unparsable is declined, empty is neither. With no node, a text match,
# nested keys too. Not each other's negation: no key is the legacy opt-in.
wk_settings_declined() {
  local rc
  [ -e "$1" ] || return 1
  [ -r "$1" ] || return 0
  _wk_settings_key "$1" false
  rc=$?
  [ "$rc" -eq 2 ] || return "$rc"
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*false' "$1" 2>/dev/null
}

wk_settings_enabled() {
  local rc
  [ -r "$1" ] || return 1
  _wk_settings_key "$1" true
  rc=$?
  [ "$rc" -eq 2 ] || return "$rc"
  grep -qE '"enabled"[[:space:]]*:[[:space:]]*true' "$1" 2>/dev/null
}

# wk_session_judges <root>: 0 when a Claude session's checks rule in <root>:
# CLAUDECODE=1, HOOK_DISABLE not 1, and a settings file there that does not
# decline. The `-e` is needed, since wk_settings_declined says no for an
# absent file. The gate of the full-suite hold and of the git hooks alike.
wk_session_judges() {
  [ "${CLAUDECODE:-}" = 1 ] || return 1
  [ "${HOOK_DISABLE:-}" != 1 ] || return 1
  [ -e "$1/.workkit/settings.json" ] || return 1
  ! wk_settings_declined "$1/.workkit/settings.json"
}

# wk_githooks_kit <root> <folder>: 0 and prints the kit root when <folder>, a
# relative one read against <root> as git reads it, is a kit's hooks folder under
# any spelling (its physical path ends /workflow/githooks and it holds both hooks
# and judge.js); 1 otherwise.
wk_githooks_kit() {
  local real
  [[ -n "$2" ]] || return 1
  real="$(cd "$1" 2>/dev/null && cd -P "$2" 2>/dev/null && pwd -P)" || return 1
  [[ "$real" == */workflow/githooks && -x "$real/pre-commit" && -x "$real/commit-msg" && -f "$real/judge.js" ]] || return 1
  (cd -P "$real/../.." && pwd -P)
}

# wk_githooks_spelled <folder>: 0 when <folder> is spelled as a kit's hooks
# folder, the kit's own path or the engine link's.
wk_githooks_spelled() {
  case "$1" in
    */workflow/githooks|*/workkit/githooks) return 0 ;;
  esac
  return 1
}

# wk_githooks_kitlike <root> <folder>: 0 when <folder> is a kit's (wk_githooks_kit),
# or spelled as one and gone, a plugin update's leftover or a dangling link. An
# existing folder of the repo's own that only ends /workflow/githooks is not.
wk_githooks_kitlike() {
  wk_githooks_kit "$1" "$2" >/dev/null && return 0
  wk_githooks_spelled "$2" || return 1
  ! (cd "$1" 2>/dev/null && [ -e "$2" ])
}
