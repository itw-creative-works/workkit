#!/bin/bash
# hooks/safety/proof-guard/checks/qa-tests.sh: the check at the flip to
# status:qa, which runs no test and reads two records: each package owning a
# touched test file needs a green npm test recorded on this tree
# (wk_pkg_proved), and a green whole root suite (wk_suite_proved) covers them
# all. A missing record blocks the flip. SOURCED by the entry (run.sh), never
# executed; it runs nothing at load, sets nothing and calls _lib.sh's helpers.

# The base the committed leg is read against: the merge base of HEAD with
# origin's default branch, else with this branch's upstream. Sets qa_base, empty
# when neither ref is named or HEAD shares no history with it.
qa_find_base() {
  qa_ref=$(git -C "$1" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)
  if [ -z "$qa_ref" ]; then
    qa_ref=$(git -C "$1" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
  fi
  qa_base=""
  if [ -n "$qa_ref" ]; then
    qa_base=$(git -C "$1" merge-base "$qa_ref" HEAD 2>/dev/null || true)
  fi
}

# The paths under root $1, one per line: the working diff (hook_working_paths)
# and the commits since base $2 when there is one. Deletions never count (the
# caller skips a path with no file), and paths come unquoted.
qa_touched_paths() {
  {
    { hook_working_paths "$1" || true; } | tr '\0' '\n'
    if [ -n "$2" ]; then
      git -C "$1" -c core.quotePath=false diff --name-only --diff-filter=d "$2" HEAD 2>/dev/null || true
    fi
  } | sort -u
}

# qa_package_of <path>: the index into qa_pkgs of the package that owns <path>
# (hook_test_package_dir, `.` for the root), added when it is new.
qa_package_of() {
  qa_pkg=$(hook_test_package_dir "$qa_root" "$1")
  [ -n "$qa_pkg" ] || qa_pkg="."
  qa_pi=0
  while [ "$qa_pi" -lt "${#qa_pkgs[@]}" ]; do
    [ "${qa_pkgs[$qa_pi]}" = "$qa_pkg" ] && return 0
    qa_pi=$((qa_pi + 1))
  done
  qa_pkgs+=("$qa_pkg")
  qa_pkg_files+=("")
  qa_pkg_counts+=(0)
}

# qa_label <pkg>: the package as a reader names it, the root as `the repo root`.
qa_label() {
  if [ "$1" = . ]; then printf 'the repo root'; else printf '%s' "$1"; fi
}

# check_qa_tests <dir>: the record check in the repo holding <dir>. It runs no
# test: the records are written by npm's script shell around the package's own
# `npm test` (workflow/lib/suite.sh).
check_qa_tests() {
  if ! qa_root=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null); then
    hook_pretool_notice "proof-guard: $1 is inside no git repository, so the park's test-record check did not run at the qa flip."
    return 0
  fi
  qa_find_base "$qa_root"
  # Any test-shaped file counts, whatever its extension; a helper or a runner
  # under a test folder (tests/run.js) is named, never required.
  qa_tests=()
  qa_helpers=""
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    hook_is_test_path "$path" || continue
    [ -f "$qa_root/$path" ] || continue
    if hook_is_test_name "$path"; then
      qa_tests+=("$path")
    else
      qa_helpers="$qa_helpers $path"
    fi
  done <<<"$(qa_touched_paths "$qa_root" "$qa_base")"
  qa_notes=""
  if [ -n "$qa_helpers" ]; then
    qa_notes=" Touched under a test folder but not a test file, so not required:${qa_helpers}."
  fi
  if [ -z "$qa_base" ]; then
    qa_notes="${qa_notes} Commits since the default branch were not read: origin names no default branch and this branch has no upstream, or HEAD shares no merge base with it."
  fi
  if [ "${#qa_tests[@]}" -eq 0 ]; then
    hook_pretool_notice "proof-guard: no touched test files in the working diff, so the qa flip needs no test record.${qa_notes}"
    return 0
  fi
  if ! qa_tree=$(wk_tree_hash "$qa_root"); then
    echo "proof-guard: BLOCKED this flip to status:qa: the working tree of $qa_root could not be hashed, so the park's test record cannot be read. Fix what stops git hashing the tree (git add -A into a throwaway index, then git write-tree), then flip again." >&2
    exit 2
  fi
  if wk_suite_proved "$qa_root" "$qa_tree"; then
    hook_pretool_notice "proof-guard: the whole root suite is green on this tree, which covers the ${#qa_tests[@]} touched test file(s).${qa_notes}"
    return 0
  fi
  qa_pkgs=()
  qa_pkg_files=()
  qa_pkg_counts=()
  qa_unprovable=""
  for path in "${qa_tests[@]}"; do
    qa_package_of "$path"
    # The root with no test script has no npm test to record a run.
    if [ "$qa_pkg" = . ] && ! wk_has_test_script "$qa_root"; then
      qa_unprovable="$qa_unprovable $path"
      continue
    fi
    qa_pkg_files[$qa_pi]="${qa_pkg_files[$qa_pi]:+${qa_pkg_files[$qa_pi]} }${path#"$qa_pkg/"}"
    qa_pkg_counts[$qa_pi]=$((qa_pkg_counts[qa_pi] + 1))
  done
  if [ -n "$qa_unprovable" ]; then
    qa_notes=" Cannot be proved by npm test, since the repo root has no test script, so not required:${qa_unprovable}.${qa_notes}"
  fi
  qa_proved=""
  qa_missing=()
  qa_missing_count=0
  qa_pi=0
  while [ "$qa_pi" -lt "${#qa_pkgs[@]}" ]; do
    qa_pkg="${qa_pkgs[$qa_pi]}"
    if [ "${qa_pkg_counts[$qa_pi]}" -gt 0 ]; then
      if wk_pkg_proved "$qa_root" "$qa_tree" "$qa_pkg"; then
        qa_proved="${qa_proved:+$qa_proved, }$(qa_label "$qa_pkg") (${qa_pkg_counts[$qa_pi]} file(s))"
      else
        qa_missing+=("$(qa_label "$qa_pkg"): ${qa_pkg_files[$qa_pi]}")
        qa_missing_count=$((qa_missing_count + qa_pkg_counts[qa_pi]))
      fi
    fi
    qa_pi=$((qa_pi + 1))
  done
  if [ "${#qa_missing[@]}" -gt 0 ]; then
    {
      echo "proof-guard: BLOCKED this flip to status:qa: the $qa_missing_count touched test file(s) below have no green test run recorded on this tree. In each package named, run its own tests narrowed to those files (\`npm test -- <files>\` from that folder, with the paths in the form its runner takes), then flip again."
      printf '%s\n' "${qa_missing[@]}"
    } >&2
    exit 2
  fi
  if [ -z "$qa_proved" ]; then
    hook_pretool_notice "proof-guard: no touched test file can be proved by npm test here, so the qa flip needs no test record.${qa_notes}"
    return 0
  fi
  hook_pretool_notice "proof-guard: every touched test file has a green npm test recorded on this tree: ${qa_proved}.${qa_notes}"
}
