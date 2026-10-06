#!/bin/bash
# hooks/lib/suite.sh: which command runs the ROOT suite, the guard's judgment.
# The proved-tree record it is checked against is the engine's suite record
# (workflow/lib/suite.sh), never its sibling package record. Sourced by hooks/_lib.sh; defines functions only.

# _hook_suite_at_root <repo_root> <cwd>: <cwd>'s nearest tested package is the
# root, so `npm test` there is the root's suite. A folder that cannot be
# entered reads as the root. Internal to the helpers below.
_hook_suite_at_root() {
  local cwd_prefix
  cwd_prefix=$(cd "$2" 2>/dev/null && git rev-parse --show-prefix 2>/dev/null) || cwd_prefix=""
  [ -z "$(hook_test_package_dir "$1" "${cwd_prefix%/}")" ]
}

# _hook_suite_member <repo_root> <dir> <name>: the folder npm's `-w <name>`
# names: <dir>/<name> when that is a folder, else the package called <name>
# (a nameless package goes by its folder's name), outside node_modules.
_hook_suite_member() {
  local file pkg name
  if [ -d "$2/$3" ]; then
    printf '%s\n' "$2/$3"
    return 0
  fi
  while IFS= read -r file; do
    pkg="${file%/package.json}"
    if [ "${pkg##*/}" = "$3" ] || grep -qF "\"$3\"" "$file" 2>/dev/null; then
      name=$(hook_jq -r '.name // ""' "$file" 2>/dev/null) || continue
      if [ "$name" = "$3" ] || { [ -z "$name" ] && [ "${pkg##*/}" = "$3" ]; }; then
        printf '%s\n' "$pkg"
        return 0
      fi
    fi
  done < <(find "$1" \( -name node_modules -o -name .git \) -prune -o -name package.json -type f -print 2>/dev/null)
  return 1
}

# _hook_suite_npm_full <repo_root> <cwd> <dir> <word>...: an `npm` invocation
# (its words, npm first) run from <dir> reaches the root's script. <dir> is
# what its `cd` steps left: empty for <cwd>, relative to it, absolute, or `?`.
# npm's folder flags move it. npm takes any unambiguous abbreviation of a long
# flag, so every flag not known here is judged full, `--include*` among them.
_hook_suite_npm_full() {
  local root="$1" dir="$3" ws=0 prefix="" name member names=()
  case "$dir" in
    '?') return 0 ;;
    '') dir="$2" ;;
    /*|[A-Za-z]:[/\\]*) ;;
    *) dir="$2/$dir" ;;
  esac
  shift 4
  while [ $# -gt 0 ]; do
    case "$1" in
      --) break ;;
      --prefix|-C|-w|--workspace)
        [ $# -ge 2 ] || return 0
        if [ "$1" = -w ] || [ "$1" = --workspace ]; then names+=("$(hook_unquote_word "$2")"); else prefix=$(hook_unquote_word "$2"); fi
        shift ;;
      --prefix=*) prefix=$(hook_unquote_word "${1#*=}") ;;
      --workspace=*) names+=("$(hook_unquote_word "${1#*=}")") ;;
      -ws|--workspaces|--workspaces=true) ws=1 ;;
      -s|--silent|-q|--quiet|--if-present) ;;
      -*) return 0 ;;
    esac
    shift
  done
  case "$prefix" in
    '') ;;
    /*|[A-Za-z]:[/\\]*) dir="$prefix" ;;
    *) dir="$dir/$prefix" ;;
  esac
  [ "$ws" -eq 0 ] || return 1
  if [ ${#names[@]} -gt 0 ]; then
    for name in "${names[@]}"; do
      member=$(_hook_suite_member "$root" "$dir" "$name") || return 0
      ! _hook_suite_at_root "$root" "$member" || return 0
    done
    return 1
  fi
  _hook_suite_at_root "$root" "$dir"
}

# hook_suite_prove_run <cmd>: prints `prove` when <cmd> runs `workkit prove`
# (the command or the engine's workkit.sh by any path), the full suite on the
# staged tree. The word test spares every other command a fork.
hook_suite_prove_run() {
  case "$1" in *prove*) ;; *) return 0 ;; esac
  printf '%s' "$1" | grep -Eq '(^|[[:space:];|&(])([^[:space:];|&()]*/)?workkit(\.sh)?[[:space:]]+prove([[:space:];|&)<>]|$)' \
    && echo prove
  return 0
}

# hook_suite_root_run <cmd> <repo_root> <cwd>: prints `full` when <cmd> runs the
# root's scripts.test directly, `workkit prove`, or npm's spellings of it in the
# folder its `cd` steps and npm's folder flags leave, judged by the nested-package
# rule. Every occurrence is judged. Consumer: safety/suite-guard.
hook_suite_root_run() {
  local script npm_re cmd kind dir step words line argv
  script=$(hook_test_script_text "$2")
  [ -n "$script" ] || return 0
  if [ -n "$(hook_suite_prove_run "$1")" ]; then
    echo full
    return 0
  fi
  # A redirect's `&` never splits a step; the script is folded alike, so the
  # two still compare.
  cmd=$(hook_fold_redirect_amp "$1")
  script=$(hook_fold_redirect_amp "$script")
  # npm's own spellings of the whole suite: the `run` form, the bare form, the
  # `t` alias, and npm's flags in front of any of them, a folder flag's value too.
  npm_re='(^|[^[:alnum:]_./-])npm([[:space:]]+(-(-prefix|C|w|-workspace)[[:space:]]+[^-[:space:]][^[:space:]]*|-[^[:space:]]+))*[[:space:]]+(run[[:space:]]+test|test|t)'
  # One event per line, its fields split by the unit separator: `script`, or
  # an `npm` run with the folder its step runs from, the step, and its words.
  while IFS= read -r line; do
    IFS=$'\037' read -r kind dir step words <<<"$line"
    case "$kind" in
      script) echo full; return 0 ;;
      npm)
        # npm reads its config from the environment too, any case.
        case "$cmd" in *[Nn][Pp][Mm]_[Cc][Oo][Nn][Ff][Ii][Gg]_*) echo full; return 0 ;; esac
        # A run judged from the folder its own step's cd leaves.
        if hook_names_dir_change "$step"; then
          hook_cd_step "$dir" "$step"
          dir="$HOOK_CD_DIR"
        fi
        read -r -a argv <<<"$words"
        if _hook_suite_npm_full "$2" "$3" "$dir" "${argv[@]}"; then
          echo full
          return 0
        fi ;;
    esac
  done < <(_hook_suite_events "$cmd" "$script" "$npm_re")
}

# _hook_suite_events <cmd> <script> <npm_re>: hook_suite_root_run's events:
# `script` when <cmd> runs <script> by its text, else, for a command naming npm
# at all, an `npm` event per run reaching a script by text, from its step in
# hook_step_dirs: `npm<US><dir><US><step><US><words>`.
_hook_suite_events() {
  local verdict
  verdict='
    function verdict(tail, kind,   s) {
      s = tail
      sub(/[[:space:]]*[0-9]*[;|&<>)].*$/, "", s)
      if (s != "" && s !~ /^[[:space:]]/) return 0
      if (kind == "npm") return (s ~ /^[[:space:]]*--[[:space:]]+[^[:space:]]/) ? 0 : 1
      return (s ~ /[^[:space:]]/) ? 0 : 1
    }'
  case "$(printf '%s' "$1" | awk -v npmre="$3" -v needle="$2" "$verdict"'
    {
      text = text (NR > 1 ? "\n" : "") $0
      pos = 1
      while ((i = index(substr($0, pos), needle)) > 0) {
        start = pos + i - 1
        pre = (start == 1) ? "" : substr($0, start - 1, 1)
        pos = start + length(needle)
        if (pre != "" && pre !~ /[[:space:];|&(]/) continue
        if (verdict(substr($0, pos), "script")) { print "script"; found = 1; exit }
      }
    }
    END { if (!found && text ~ npmre) print "npm" }
  ' 2>/dev/null)" in
    script) echo script ;;
    npm)
      hook_step_dirs "$1" | awk -v npmre="$3" "$verdict"'
        {
          i = index($0, "\037")
          if (i == 0) next
          s = substr($0, i + 1)
          i = index(s, "\037")
          dir = substr(s, 1, i - 1)
          s = substr(s, i + 1)
          rest = s
          while (match(rest, npmre)) {
            words = substr(rest, RSTART)
            rest = substr(rest, RSTART + RLENGTH)
            if (!verdict(rest, "npm")) continue
            sub(/^[^n]*/, "", words)
            print "npm\037" dir "\037" s "\037" words
          }
        }
      ' 2>/dev/null || true ;;
  esac
}
