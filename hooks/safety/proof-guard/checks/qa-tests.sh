#!/bin/bash
# hooks/safety/proof-guard/checks/qa-tests.sh: the check at the flip to
# status:qa, which runs the test files the working diff touched with
# `node --test` once per tree (the qa record in workflow/lib/suite.sh) and
# blocks the flip when one is red. SOURCED by the entry (run.sh), never
# executed, and it runs nothing at load: it defines functions and sets nothing.
# It calls _lib.sh's helpers.

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

qa_block() {
  {
    echo "proof-guard: BLOCKED this flip to status:qa: $1"
    printf '  %s\n' "${qa_run[@]}"
  } >&2
}

# qa_group_of <path>: the index into qa_groups of the package <path> runs in,
# its folder added when it is new, and its preloads, if any, named in
# qa_preloads for the pass notice.
qa_group_of() {
  qa_pkg=$(hook_test_package_dir "$qa_root" "$1")
  qa_gi=0
  while [ "$qa_gi" -lt "${#qa_groups[@]}" ]; do
    [ "${qa_groups[$qa_gi]}" = "$qa_pkg" ] && return 0
    qa_gi=$((qa_gi + 1))
  done
  qa_groups+=("$qa_pkg")
  qa_shown=$(hook_test_preloads "$qa_root${qa_pkg:+/$qa_pkg}" | tr '\n' ' ')
  if [ -n "$qa_shown" ]; then
    qa_label="${qa_pkg:-the repo root}"
    qa_preloads="${qa_preloads} Files in ${qa_label} ran under ${qa_label}'s test preloads (${qa_shown% })."
  fi
}

# qa_run_groups <dir>: each group in turn from its package folder, under its
# preloads, its files relative to that folder, group N's TAP to <dir>/N. The
# first red stops the sequence, so the last file written is the red group's.
qa_run_groups() {
  qa_gi=0
  while [ "$qa_gi" -lt "${#qa_groups[@]}" ]; do
    qa_pkg="${qa_groups[$qa_gi]}"
    qa_pre=()
    while IFS= read -r qa_word; do
      [ -n "$qa_word" ] || continue
      qa_pre+=("$qa_word")
    done <<<"$(hook_test_preloads "$qa_root${qa_pkg:+/$qa_pkg}")"
    qa_files=()
    qa_i=0
    while [ "$qa_i" -lt "${#qa_run[@]}" ]; do
      if [ "${qa_file_group[$qa_i]}" -eq "$qa_gi" ]; then
        qa_files+=("${qa_run[$qa_i]#"${qa_pkg:+$qa_pkg/}"}")
      fi
      qa_i=$((qa_i + 1))
    done
    (cd "$qa_root${qa_pkg:+/$qa_pkg}" \
      && node ${qa_pre[@]+"${qa_pre[@]}"} --test --test-reporter=tap -- "${qa_files[@]}") >"$1/$qa_gi" 2>&1 || return 1
    qa_gi=$((qa_gi + 1))
  done
}

# qa_tap_empty <tap file> <name>: the TAP shows <name> as its own top-level
# passed test, the flat shape a file that registered nothing prints. The name
# is TAP-unescaped and a backslash read as `/`, the way Windows may print it.
qa_tap_empty() {
  qa_name="$2" awk '
    /^ok [0-9]+ - / {
      name = $0
      sub(/^ok [0-9]+ - /, "", name)
      gsub(/\\#/, "#", name)
      gsub(/\\\\/, "/", name)
      if (name == ENVIRON["qa_name"]) found = 1
    }
    END { exit found ? 0 : 1 }' "$1"
}

# qa_first_failure <tap file>: the first `not ok` entry through the `...` that
# closes its YAML block, at most 25 lines, then the TAP's closing summary. A run
# that printed no `not ok` died before any test (a preload that failed to
# load), and its error sits near the top, so it shows its first lines instead.
qa_first_failure() {
  awk '
    NR <= 15 { first[NR] = $0 }
    !seen && /^ *not ok / {
      seen = 1
      open = 1
      close_line = sprintf("%" (match($0, /[^ ]/) + 1) "s...", "")
    }
    open {
      if (++n <= 25) print
      if ($0 == close_line) open = 0
      next
    }
    /^1\.\.[0-9]+$/ { summary = $0; next }
    summary != "" && /^# / { summary = summary "\n" $0 }
    END {
      if (seen) {
        if (summary != "") print summary
        exit
      }
      print "No not ok entry in the output; its first lines:"
      for (i = 1; i <= NR && i <= 15; i++) print first[i]
    }' "$1"
}

# check_qa_tests <dir>: the run in the repo holding <dir>, under a fixed 540s
# deadline inside the 600s the wiring gives the hook, so a hung test bounces
# instead of being cancelled into an allow.
check_qa_tests() {
  if ! qa_root=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null); then
    hook_pretool_notice "proof-guard: $1 is inside no git repository, so the touched-test run did not run at the qa flip."
    return 0
  fi
  qa_find_base "$qa_root"
  # Only test-shaped files run: a helper or a runner under a test folder
  # (tests/run.js runs the whole suite) is named, never executed.
  qa_run=()
  qa_skipped=""
  qa_helpers=""
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    hook_is_test_path "$path" || continue
    [ -f "$qa_root/$path" ] || continue
    if ! hook_is_test_name "$path"; then
      qa_helpers="$qa_helpers $path"
      continue
    fi
    case "$path" in
      *.js|*.mjs|*.cjs) qa_run+=("$path") ;;
      *) qa_skipped="$qa_skipped $path" ;;
    esac
  done <<<"$(qa_touched_paths "$qa_root" "$qa_base")"
  qa_not_run=""
  if [ -n "$qa_skipped" ]; then
    qa_not_run=" Not run, since node --test runs only .js, .mjs and .cjs:${qa_skipped}."
  fi
  if [ -n "$qa_helpers" ]; then
    qa_not_run="${qa_not_run} Touched under a test folder but not a test file, so not run:${qa_helpers}."
  fi
  if [ -z "$qa_base" ]; then
    qa_not_run="${qa_not_run} Commits since the default branch were not read: origin names no default branch and this branch has no upstream, or HEAD shares no merge base with it."
  fi
  if [ "${#qa_run[@]}" -eq 0 ]; then
    hook_pretool_notice "proof-guard: no touched test files in the working diff, so nothing ran at the qa flip.${qa_not_run}"
    return 0
  fi
  # Once per tree: hashed before the run and again after a green one, and
  # recorded only when the two match. A hash that cannot be taken before the
  # run runs the files and records nothing.
  qa_tree=$(wk_tree_hash "$qa_root") || qa_tree=""
  if [ -n "$qa_tree" ] && wk_qa_proved "$qa_root" "$qa_tree"; then
    hook_pretool_notice "proof-guard: the touched test files already ran green on this tree at an earlier qa flip, so they did not run again.${qa_not_run}"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    hook_pretool_notice "proof-guard: node is not on PATH, so the touched-test run did not run at the qa flip."
    return 0
  fi
  # A package's files run from its own folder, so its test script's preloads
  # resolve there; a file in no package keeps the root group.
  qa_groups=()
  qa_preloads=""
  qa_file_group=()
  for path in "${qa_run[@]}"; do
    qa_group_of "$path"
    qa_file_group+=("$qa_gi")
  done
  qa_dir=$(mktemp -d "${TMPDIR:-/tmp}/proof-guard-qa.XXXXXX")
  qa_run_groups "$qa_dir" &
  qa_pid=$!
  if ! hook_wait_deadline "$qa_pid" 540; then
    rm -rf "$qa_dir"
    qa_block "the touched tests were still running at 540s, so the flip cannot prove them green. Run them yourself with node --test, fix what hangs, then flip again:"
    exit 2
  fi
  if ! wait "$qa_pid"; then
    qa_gi=0
    while [ -f "$qa_dir/$((qa_gi + 1))" ]; do qa_gi=$((qa_gi + 1)); done
    qa_pkg="${qa_groups[$qa_gi]}"
    qa_block "a touched test file is red."
    {
      echo "First failure${qa_pkg:+ (run from $qa_pkg)}:"
      qa_first_failure "$qa_dir/$qa_gi"
    } >&2
    rm -rf "$qa_dir"
    exit 2
  fi
  # A file that registered nothing passes as one test named by its path, and so
  # does a self-running suite, whose exit code is its proof; only the text tells
  # the two apart.
  qa_self_re="require\.main[[:space:]]*===[[:space:]]*module"
  qa_green=""
  qa_green_n=0
  qa_unproved=""
  qa_i=0
  while [ "$qa_i" -lt "${#qa_run[@]}" ]; do
    path="${qa_run[$qa_i]}"
    qa_gi="${qa_file_group[$qa_i]}"
    qa_pkg="${qa_groups[$qa_gi]}"
    if qa_tap_empty "$qa_dir/$qa_gi" "${path#"${qa_pkg:+$qa_pkg/}"}" \
      && ! grep -Eq "$qa_self_re" "$qa_root/$path" 2>/dev/null; then
      qa_unproved="$qa_unproved $path"
    else
      qa_green="${qa_green:+$qa_green }$path"
      qa_green_n=$((qa_green_n + 1))
    fi
    qa_i=$((qa_i + 1))
  done
  rm -rf "$qa_dir"
  if [ -n "$qa_unproved" ]; then
    qa_unproved=" Registered no test under node --test, so not proved (a module that only exports its cases):${qa_unproved}."
  fi
  qa_unrecorded=""
  if [ "$qa_green_n" -eq 0 ]; then
    qa_unrecorded=" Nothing was proved, so no record was written and the next flip runs them again."
  elif [ -n "$qa_tree" ]; then
    if ! qa_after=$(wk_tree_hash "$qa_root"); then
      qa_unrecorded=" The tree could not be hashed after the run, so no record was written and the next flip runs them again."
    elif [ "$qa_after" != "$qa_tree" ]; then
      qa_unrecorded=" The tree changed during the run, so no record was written and the next flip runs them again."
    elif ! wk_qa_marker_write "$qa_root" "$qa_tree" 2>/dev/null; then
      qa_unrecorded=" The record could not be written, so the next flip runs them again."
    fi
  fi
  hook_pretool_notice "proof-guard: ran ${qa_green_n} touched test file(s) green at the qa flip${qa_green:+: $qa_green}.${qa_preloads}${qa_unproved}${qa_not_run}${qa_unrecorded}"
}
