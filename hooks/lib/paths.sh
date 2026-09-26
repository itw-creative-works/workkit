#!/bin/bash
# hooks/lib/paths.sh: what a repo path IS, read off its shape alone: the test
# file shapes. SOURCED by hooks/_lib.sh, never executed, and it runs nothing at
# load: it defines functions and sets nothing. It reads no name of the entry's.

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
# Consumers: safety/commit-gate (check 1), safety/proof-guard (the qa flip).
hook_is_test_path() {
  hook_is_test_name "$1" && return 0
  case "$1" in
    test/*|tests/*|__tests__/*|*/test/*|*/tests/*|*/__tests__/*) return 0 ;;
  esac
  return 1
}
