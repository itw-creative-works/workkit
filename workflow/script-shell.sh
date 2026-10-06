#!/usr/bin/env bash
# workflow/script-shell.sh: npm's script shell, once `npm config set
# script-shell` names it. The proved-tree records (lib/suite.sh) are the
# engine-agnostic contract and this file is npm's adapter: a green bare root
# `npm test`, run detached, writes the suite record; every other green `test`
# event (narrowed anywhere, or a nested package's bare run) runs in the
# foreground and writes the package record; every other script is plain sh.

# Functions only, called on the last line: bash reads a script as it runs, but
# parses a function whole.

# recorded_run <root> <pkg> -c <script>: hash, run, hash, record; an empty
# <pkg> is the whole root suite. Hashed before and after: an edit made while it
# runs is never proved. A failed hash is its own answer, never an empty id read
# as a changed tree.
recorded_run() {
  local root="$1" pkg="$2" what=suite record=record hashed=1 before after rc=0
  local changed='the tree changed during the run, so no record was written; run npm test again'
  shift 2
  if [ -n "$pkg" ]; then
    what=run record='package record'
    changed='the tree changed during it, so no record was written; run it again'
  fi
  before=$(wk_tree_hash "$root") || hashed=0
  sh "$@" || rc=$?
  [ "$rc" -eq 0 ] || exit "$rc"
  after=$(wk_tree_hash "$root") || hashed=0
  if [ "$hashed" -eq 0 ]; then
    printf 'script-shell: the %s passed, but the tree of %s could not be hashed, so no record was written\n' "$what" "$root" >&2
    exit 1
  fi
  if [ "$before" != "$after" ]; then
    printf 'script-shell: the %s passed, but %s\n' "$what" "$changed" >&2
    exit 0
  fi
  if [ -n "$pkg" ]; then
    wk_pkg_marker_write "$root" "$before" "$pkg" || rc=1
  else
    wk_suite_marker_write "$root" "$before" || rc=1
  fi
  if [ "$rc" -ne 0 ]; then
    printf 'script-shell: the %s passed, but the %s of %s could not be written\n' "$what" "$record" "$root" >&2
    exit 1
  fi
  exit 0
}

# suite_body <root> -c <script>: the detached whole root run. Its last line is
# always `script-shell: exit <code>`, for a reader of the log.
suite_body() {
  local root="$1"
  shift
  wk_body_traps script-shell
  recorded_run "$root" "" "$@"
}

load_libs() {
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  # shellcheck source=./lib/platform.sh
  . "$SCRIPT_DIR/lib/platform.sh"
  # shellcheck source=./lib/suite.sh
  . "$SCRIPT_DIR/lib/suite.sh"
  # shellcheck source=./lib/changelog.sh
  . "$SCRIPT_DIR/lib/changelog.sh"
  # shellcheck source=./lib/detach.sh
  . "$SCRIPT_DIR/lib/detach.sh"
}

main() {
  if [ "${1:-}" = --suite-body ]; then
    shift
    load_libs
    suite_body "$@"
  fi
  [ "${npm_lifecycle_event:-}" = test ] || exec sh "$@"
  load_libs

  # The package npm is running, as a folder relative to the git root (`.` for the
  # root). npm may hand a native Windows path, so either separator ends the
  # folder; a package outside the root records nothing.
  root=$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null) || exec sh "$@"
  [ -n "${npm_package_json:-}" ] || exec sh "$@"
  pkg_dir=$(cd "${npm_package_json%[/\\]*}" 2>/dev/null && pwd -P) || exec sh "$@"
  real_root=$(cd "$root" && pwd -P) || exec sh "$@"
  case "$pkg_dir" in
    "$real_root") rel=. ;;
    "$real_root"/*) rel=${pkg_dir#"$real_root"/} ;;
    *) exec sh "$@" ;;
  esac

  # npm appends a narrowed run's arguments (`npm test -- <file>`) to the script
  # text, so only the root's bare script is the whole suite. Every other test
  # run is the package path: in the foreground, no CHANGELOG lint.
  if [ "$rel" != . ] || [ "${2:-}" != "${npm_lifecycle_script:-}" ]; then
    recorded_run "$root" "$rel" "$@"
  fi

  # The gate's cheap check first, so a bad CHANGELOG entry costs a second, not
  # a suite: every tracked CHANGELOG.md the working tree modifies. -z keeps a
  # path with a space unquoted; a rename's origin follows as its own field.
  changelogs=()
  if wk_changelog_linter >/dev/null; then
    while IFS= read -r -d '' entry; do
      case "${entry:0:2}" in
        R*|C*|?R|?C) IFS= read -r -d '' _ ;;
      esac
      case "${entry:0:2}" in
        *D*) continue ;;
      esac
      if wk_is_changelog "${entry:3}"; then changelogs+=("${entry:3}"); fi
    done < <(git -C "$root" status --porcelain -z --untracked-files=no)
  fi
  if [ "${#changelogs[@]}" -gt 0 ] && ! lint_msg=$(wk_changelog_lint "$root" "${changelogs[@]}" 2>&1); then
    printf 'script-shell: %s\n' "$lint_msg" >&2
    exit 1
  fi

  # The suite runs in its own session, so a kill of the shell that started it
  # leaves it running to its record; INT (a human's Ctrl-C) still ends it.
  log=$(wk_suite_log_path "$root") || exit 1
  lock=$(wk_suite_lock_path "$root") || exit 1
  rc=0
  wk_run_detached "$log" "$lock" -- "$BASH" "$SCRIPT_DIR/script-shell.sh" --suite-body "$root" "$@" || rc=$?
  if [ -n "$WK_HELD_PID" ]; then
    printf 'script-shell: a root npm test is already running (pid %s); its output is in %s\n' "$WK_HELD_PID" "$log" >&2
    exit 1
  fi
  exit "$rc"
}

main "$@"
