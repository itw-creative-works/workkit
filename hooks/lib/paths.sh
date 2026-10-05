#!/bin/bash
# hooks/lib/paths.sh: what a repo path IS: the test file shapes and the code
# file shape, read off its shape alone, and the tested package it sits in, read
# off the tree, with the preloads that package's test script runs under.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads no name of the entry's.

# hook_is_test_name <path>: the basename is test-shaped (`*.test.*`,
# `*.spec.*`, `*_test.*`), whatever folder it sits in.
# Consumers: safety/proof-guard (what the qa flip runs), hook_is_test_path.
hook_is_test_name() {
  case "${1##*/}" in
    *.test.*|*.spec.*|*_test.*) return 0 ;;
  esac
  return 1
}

# hook_is_fixture_path <path>: a folder of the path is `fixtures`, `_fixtures`
# or `__fixtures__`, at any depth: what sits there is input to another test.
# Consumer: safety/proof-guard (the qa flip).
hook_is_fixture_path() {
  case "/$1" in
    */fixtures/*|*/_fixtures/*|*/__fixtures__/*) return 0 ;;
  esac
  return 1
}

# hook_is_test_path <path>: a test file by name, or any file under a `test`,
# `tests` or `__tests__` folder at any depth, the top level included.
# Consumers: safety/commit-gate (check 1), safety/proof-guard (the qa flip),
# safety/test-reminder, hook_is_code_path.
hook_is_test_path() {
  hook_is_test_name "$1" && return 0
  case "$1" in
    test/*|tests/*|__tests__/*|*/test/*|*/tests/*|*/__tests__/*) return 0 ;;
  esac
  return 1
}

# hook_has_code_ext <basename>: the name ends in a code extension, the one
# list every code-versus-docs judgment reads.
# Consumers: hook_is_code_path, safety/commit-gate (the docs classifier),
# docs/change-tracker.
hook_has_code_ext() {
  case "$1" in
    *.js|*.cjs|*.mjs|*.ts|*.jsx|*.tsx|*.sh|*.zsh|*.py|*.rb) return 0 ;;
  esac
  return 1
}

# hook_is_code_path <path>: a source file the test obligation covers: a code
# extension, never a test path, a `*.config.*` file, or anything under _attic/.
# Consumers: safety/commit-gate (check 1), safety/test-reminder.
hook_is_code_path() {
  hook_is_test_path "$1" && return 1
  case "$1" in
    _attic/*|*/_attic/*) return 1 ;;
  esac
  case "${1##*/}" in
    *.config.*) return 1 ;;
  esac
  hook_has_code_ext "${1##*/}"
}

# hook_test_script_text <dir>: prints <dir>/package.json's scripts.test text;
# nothing when it is absent or unreadable, never what jq parsed before failing.
# Consumers: hook_suite_root_run, hook_test_preloads.
hook_test_script_text() {
  local text
  text=$(hook_jq -r '.scripts.test // ""' "$1/package.json" 2>/dev/null) || return 0
  printf '%s' "$text"
}

# hook_test_preloads <dir>: the preload flags of <dir>/package.json's test
# script, one word per line, read only off a `node` command in it: `--require`,
# `-r` or `--import` then its value unquoted, or `--require=X` and `--import=X`
# as one word. Nothing else is carried. Consumer: safety/proof-guard.
hook_test_preloads() {
  local text word flag="" in_node="" words
  text=$(hook_test_script_text "$1")
  read -r -a words <<<"$text"
  for word in ${words[@]+"${words[@]}"}; do
    if [ -n "$flag" ]; then
      printf '%s\n%s\n' "$flag" "$(hook_unquote_word "$word")"
      flag=""
      continue
    fi
    case "$word" in
      '&&'|'||'|';'|'|'|'&') in_node=""; continue ;;
    esac
    # A node command opens at its word and closes at its first non-flag word.
    if [ -z "$in_node" ]; then
      case "$word" in node|*/node) in_node=1 ;; esac
      continue
    fi
    case "$word" in
      --require|-r|--import) flag="$word" ;;
      --require=*|--import=*) printf '%s=%s\n' "${word%%=*}" "$(hook_unquote_word "${word#*=}")" ;;
      -*) ;;
      *) in_node="" ;;
    esac
  done
}

# hook_test_package_dir <root> <path>: the nearest folder at or above <path>
# (relative to <root>), short of the root, whose package.json declares a test
# script, relative to <root>. Nothing means the root's; nothing under
# node_modules. Consumers: _hook_suite_at_root, safety/proof-guard.
hook_test_package_dir() {
  local root dir
  root="$1"
  dir="$2"
  case "/$dir/" in */node_modules/*) return 0 ;; esac
  while [ -n "$dir" ]; do
    if wk_has_test_script "$root/$dir"; then
      printf '%s\n' "$dir"
      return 0
    fi
    case "$dir" in
      */*) dir="${dir%/*}" ;;
      *) dir="" ;;
    esac
  done
  return 0
}
