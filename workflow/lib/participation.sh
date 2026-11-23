#!/usr/bin/env bash
# workflow/lib/participation.sh: what the kit means by a repo root, by a repo's
# answer, by a setting and by its own hooks folder, for the engine and the
# hooks. Sourced, functions only; the hooks source it directly so they never
# load the engine's addresses.

# wk_is_repo_root <dir>: `-e`, never `-d`, since `.git` is a file in a worktree
# and in a submodule. Asked of the directory, so a walk needs no git call apiece.
wk_is_repo_root() {
  [ -e "$1/.git" ]
}

# wk_settings_enabled <file>: 0 when the file's top-level `enabled` is true, as
# repoFlag (the kit's hooks/mods/gate.js, the one rule) reads it; 1 otherwise.
# With no node, a text match, nested keys too. wk_node is platform.sh's, which
# every caller sources before this file.
wk_settings_enabled() {
  local node
  [ -r "$1" ] || return 1
  if ! node="$(wk_node)"; then
    grep -qE '"enabled"[[:space:]]*:[[:space:]]*true' "$1" 2>/dev/null
    return
  fi
  "$node" -e 'const { repoFlag } = require(require("path").resolve(process.argv[1])); let t = null;
try { t = require("fs").readFileSync(process.argv[2], "utf8"); } catch {}
process.exit(repoFlag(t) === "true" ? 0 : 1);' \
    "${BASH_SOURCE[0]%/*}/../../hooks/mods/gate.js" "$1" 2>/dev/null && return 0
  return 1
}

# wk_opted_in <root>: 0 when the repo at <root> turned workkit on: its own
# .workkit/settings.json says `"enabled": true`. No file, an empty one, one with
# no key or any other value is off, the default; the machine's file has no say.
# The shell side's one opt-in test, the twin of settingsOptedIn (hooks/mods/gate.js).
wk_opted_in() {
  [ -f "$1/.workkit/settings.json" ] || return 1
  wk_settings_enabled "$1/.workkit/settings.json"
}

# wk_setting <root> <dotted.key>: the merged view's key: the kit's defaults (two
# folders above this file) under the machine's settings.json under <root>'s, none
# with an empty <root>; `enabled` is <root>'s own. A string prints raw, null as
# nothing, else JSON. Defaults missing or broken: an error naming the file, 1.
wk_setting() {
  local defaults="${BASH_SOURCE[0]%/*}/../../defaults/settings.json" user repo=''
  user="$(wk_user_dir)/settings.json"
  [ -z "$1" ] || repo="$1/.workkit/settings.json"
  command -v jq >/dev/null 2>&1 || return 0
  if [ ! -f "$defaults" ] || ! wk_jq -e 'type == "object"' "$defaults" >/dev/null 2>&1; then
    printf 'workkit: the kit'"'"'s settings defaults %s are missing or not a JSON object; reinstall the kit\n' "$defaults" >&2
    return 1
  fi
  wk_jq -r -n --slurpfile d "$defaults" \
    --arg u "$([ -f "$user" ] && cat "$user" 2>/dev/null)" \
    --arg r "$([ -n "$repo" ] && [ -f "$repo" ] && cat "$repo" 2>/dev/null)" --arg k "$2" '
    def layer: try fromjson catch null;
    def merge($b; $o): if ($o | type) != "object" then $b
      else reduce ($o | keys_unsorted[]) as $key ($b;
        $o[$key] as $v | if $v == null then .
          elif (.[$key] | type) == "object" then
            (if ($v | type) == "object" then .[$key] = merge(.[$key]; $v) else . end)
          else .[$key] = $v end) end;
    $d[0] as $D | ($r | layer) as $R
    | merge(merge($D; $u | layer); $R)
    | .enabled = (if ($R | type) == "object" and $R.enabled != null then $R.enabled else $D.enabled end)
    | (try getpath($k | split(".")) catch null) | if . == null then empty elif type == "string" then . else tojson end'
}

# wk_session_judges <root>: 0 when a Claude session's checks rule in <root>:
# CLAUDECODE=1, HOOK_DISABLE not 1, and the repo opted in. The gate of the git
# hooks and the two shims, the twin of sessionJudges (hooks/mods/gate.js).
wk_session_judges() {
  [ "${CLAUDECODE:-}" = 1 ] || return 1
  [ "${HOOK_DISABLE:-}" != 1 ] || return 1
  wk_opted_in "$1"
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

# git_hooks_installed <root>: prints the folder core.hooksPath names, read with
# --path so a ~/ spelling is expanded, 0 when it is a kit's hooks folder
# (wk_githooks_kit); 1 for any other value or none. Asks git alone, no node.
git_hooks_installed() {
  local path
  path="$(git -C "$1" config --local --path core.hooksPath 2>/dev/null)" || return 1
  wk_githooks_kit "$1" "$path" >/dev/null || return 1
  printf '%s' "$path"
}
