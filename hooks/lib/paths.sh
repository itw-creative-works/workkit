#!/bin/bash
# hooks/lib/paths.sh: what a repo path IS: the test file shapes and the code
# file shape, read off its shape alone, and the tested package it sits in, read
# off the tree. SOURCED by
# hooks/_lib.sh, never executed, and it runs nothing at load: it defines
# functions and sets nothing. It reads no name of the entry's.

# hook_is_test_name <path>: the basename is test-shaped (`*.test.*`,
# `*.spec.*`, `*_test.*`), whatever folder it sits in.
# Consumers: safety/proof-guard (what the qa flip runs), hook_is_test_path.
hook_is_test_name() {
  case "${1##*/}" in
    *.test.*|*.spec.*|*_test.*) return 0 ;;
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

# hook_test_package_dir <root> <path>: the nearest folder at or above <path>
# (relative to <root>), short of the root, whose package.json declares a test
# script, relative to <root>. Nothing means the root's; nothing under
# node_modules. Consumers: safety/commit-gate, _hook_suite_at_root.
hook_test_package_dir() {
  local root dir
  root="$1"
  dir="$2"
  case "/$dir/" in */node_modules/*) return 0 ;; esac
  while [ -n "$dir" ]; do
    if [ -f "$root/$dir/package.json" ] && hook_jq -e '.scripts.test' "$root/$dir/package.json" >/dev/null 2>&1; then
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
