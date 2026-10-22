#!/bin/bash
# hooks/lib/paths.sh: the tested package a repo path sits in, read off the
# tree. The module's twin is testPackageDir in hooks/mods/suite.js.
# SOURCED by hooks/_lib.sh, never executed, and it runs nothing at load: it
# defines functions and sets nothing. It reads wk_has_test_script
# (workflow/lib/suite.sh) from the entry.

# hook_test_package_dir <root> <path>: the nearest folder at or above <path>
# (relative to <root>), short of the root, whose package.json declares a test
# script, relative to <root>. Nothing means the root's; nothing under
# node_modules.
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
