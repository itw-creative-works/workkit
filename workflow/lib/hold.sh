#!/usr/bin/env bash
# workflow/lib/hold.sh: the full-suite hold, judged where the root suite runs
# (script-shell.sh's bare root run, prove.sh) and in the repo it runs in.
# Sourced, functions only, by script-shell.sh and the hooks' _lib.sh; it reads
# wk_jq (platform.sh), wk_settings_declined (participation.sh), wk_repo_slug
# (slug.sh), wk_suite_proved and wk_suite_marker_path (suite.sh).

# wk_issues_building [repo]: the open issues at status:building, run in the
# current directory, a line each: the number, a tab, the label; 2 when gh cannot
# answer. Never agent:claimed: an agent:ok item keeps that claim through the
# park. Its gh argv changes together with buildingList in hooks/mods/gh.js.
wk_issues_building() {
  local repo="${1:-}" list
  command -v gh >/dev/null 2>&1 || return 2
  command -v jq >/dev/null 2>&1 || return 2
  if [ -n "$repo" ]; then
    list=$(gh issue list --repo "$repo" --state open --label status:building --limit 1000 --json number,labels 2>/dev/null) || return 2
  else
    list=$(gh issue list --state open --label status:building --limit 1000 --json number,labels 2>/dev/null) || return 2
  fi
  [ -n "$list" ] || return 2
  wk_jq -r '.[] | [.number, ([.labels[]?.name // "" | select(. == "status:building")] | join(","))]
    | select(.[1] != "") | "\(.[0])\t\(.[1])"' <<<"$list" 2>/dev/null || return 2
}

# wk_suite_hold <root> <tree-reader>: 0 to run the root suite, 1 to refuse with
# the reason on stderr. <tree-reader> prints the tree the run proves, given the
# root, and is called only once the run is judged, so an unjudged run hashes
# nothing extra. Judged only in a Claude session (CLAUDECODE=1),
# never under HOOK_DISABLE=1, and only in a root that opted in: the `-e` is
# needed, since wk_settings_declined says no for an absent file.
wk_suite_hold() {
  local root="$1" reader="$2" tree building numbers="" n
  local narrow="Run the narrowest test that proves the change (\`npm test -- <file>\` from the package's folder)"
  [ "${CLAUDECODE:-}" = 1 ] || return 0
  [ "${HOOK_DISABLE:-}" != 1 ] || return 0
  [ -e "$root/.workkit/settings.json" ] || return 0
  ! wk_settings_declined "$root/.workkit/settings.json" || return 0

  tree=$("$reader" "$root") || tree=""
  if wk_suite_proved "$root" "$tree"; then
    printf 'suite-hold: this tree is already proved: the full suite ran green on it and %s records it. %s; the commit gate reads the same record for a commit whose staged tree matches it. Never set HOOK_DISABLE or clear CLAUDECODE to get past this hold.\n' \
      "$(wk_suite_marker_path "$root")" "$narrow" >&2
    return 1
  fi
  [ -n "$(wk_repo_slug "$root")" ] || return 0
  if ! building=$(cd "$root" && wk_issues_building); then
    printf 'suite-hold: could not read the open issues at status:building (gh could not answer), so the building hold did not run on this command.\n' >&2
    return 0
  fi
  while IFS= read -r n; do
    [ -n "$n" ] || continue
    numbers="${numbers:+$numbers, }#$n (status:building)"
  done < <(printf '%s\n' "$building" | cut -f1)
  [ -n "$numbers" ] || return 0
  printf 'suite-hold: the full suite runs once, at the commit, after every item in the tree is parked and passed; still building: %s. That work has to finish first: its tests green and its Proof: comment posted, then its own park moves it to status:qa. Never relabel an item, set HOOK_DISABLE or clear CLAUDECODE to get past this hold. %s.\n' \
    "$numbers" "$narrow" >&2
  return 1
}
