#!/usr/bin/env bash
# workflow/changelog/changelog-job.sh: the `changelog` job and the push trigger
# in a repo's checks.yml, read and rewritten, and the retired linter copies.
# Sourced by standards.sh and, for safety/commit-gate, by hooks/_lib.sh: one
# rewrite, so the gate never accepts a change the heal would not make.
# Functions only.
#
# Every awk runs with `-v BINMODE=3`, so gawk on Windows keeps a file's own
# line endings; each awk strips a trailing `\r` itself before comparing.

# The linter copies an earlier heal vendored, one path per line: the current
# name and the older .js one.
wk_linter_copies() {
  printf '%s\n' .github/changelog-lint.cjs .github/changelog-lint.js
}

# Where a job ends: the next line, not blank and not a comment, indented 0 or 2
# spaces, which is the next job (whatever its id: `e2e:`, `lint.v2:`) or a
# top-level key. A comment is never a boundary, so a comment above the next job
# is not read as the start of it.
wk_job_boundary() {
  printf '%s\n' '^(  )?[^ #]'
}

# The header paragraphs a checks.yml carried before the reusable workflow, one
# per linter copy with a blank line between: the rewrite swaps an exact match
# for the template's paragraph, which opens with the same first line.
wk_retired_checks_headers() {
  local copy sep=""
  while IFS= read -r copy; do
    printf '%s' "$sep"
    printf '%s\n' \
      '# The `changelog` job is the only job the heal adds to an EXISTING checks.yml,' \
      "# appended once at the end of \`jobs:\`. Its linter is the copy of the kit's" \
      "# changelog.js the heal vendors to $copy on every run."
    sep=$'\n'
  done < <(wk_linter_copies)
}

# The checks.yml template in the engine folder, the one home of the job's text.
wk_checks_template() {
  printf '%s/templates/github-workflows/checks.yml\n' "$(cd "${BASH_SOURCE[0]%/*}/.." && pwd -P)"
}

# wk_names_linter_copy [copy]: 0 when stdin names the copy (or any copy)
# outside a comment line, since naming it is running it; 1 when it does not; 2
# when a grep failed. Both greps read all of stdin, so no writer is cut short.
wk_names_linter_copy() {
  local copy args=() status
  if [[ $# -gt 0 ]]; then
    args=(-e "$1")
  else
    while IFS= read -r copy; do args+=(-e "$copy"); done < <(wk_linter_copies)
  fi
  grep -v '^[[:space:]]*#' | grep -F "${args[@]}" >/dev/null
  status=("${PIPESTATUS[@]}")
  if (( status[0] > 1 || status[1] > 1 )); then return 2; fi
  return "${status[1]}"
}

# wk_workflows_run_copy <root> [copy]: 0 when any file under
# <root>/.github/workflows names the copy (or any copy), 1 when none does, 2
# when the folder could not be read; find's stderr is the caller's to keep.
wk_workflows_run_copy() {
  local dir="$1/.github/workflows" text
  [[ -d "$dir" ]] || return 1
  text="$(find "$dir" -type f -exec cat {} +)" || return 2
  wk_names_linter_copy "${@:2}" <<<"$text"
}

# wk_changelog_job_block <file>: the `changelog` job, from its `  changelog:`
# line to the boundary, comments and blank lines inside it included. Read
# without its carriage returns.
wk_changelog_job_block() {
  BOUNDARY="$(wk_job_boundary)" awk -v BINMODE=3 '
    { sub(/\r$/, "") }
    /^  changelog:/ { f = 1; print; next }
    f && $0 ~ ENVIRON["BOUNDARY"] { exit }
    f
  ' "$1"
}

# wk_changelog_job_runs_copy <file>: 0 when the file's changelog job names a
# linter copy, 1 when it does not, 2 when the file or a grep could not be read.
wk_changelog_job_runs_copy() {
  local job
  job="$(wk_changelog_job_block "$1")" || return 2
  wk_names_linter_copy <<<"$job"
}

# wk_checks_header <template>: the template's header paragraph, from the line
# the retired paragraph also opens with to the last comment line after it.
wk_checks_header() {
  local first
  first="$(wk_retired_checks_headers)"
  FIRST="${first%%$'\n'*}" awk -v BINMODE=3 '
    { sub(/\r$/, "") }
    $0 == ENVIRON["FIRST"] { f = 1 }
    f && !/^#/ { exit }
    f
  ' "$1"
}

# wk_checks_push_trigger <checks.yml>: the file with the template's `push:`
# trigger added at the end of its `on:` block, reindented to that block's keys,
# when the block lists `pull_request:` and no `push:`, quoted or not; any other
# file comes back byte for byte. Added lines take the file's own line ending.
wk_checks_push_trigger() {
  local push at
  push="$(awk -v BINMODE=3 '
    { sub(/\r$/, "") }
    /^on:/ { f = 1; next }
    f && /^[^ #]/ { exit }
    f && /^  ["'\'']?push["'\'']?:/ { p = 1; print; next }
    p && /^    / { print; next }
    p && !/^[[:space:]]*(#.*)?$/ { exit }
  ' "$(wk_checks_template)")" || return 1
  [[ -n "$push" ]] || return 1

  # The line the block goes before, a tab, and the indent of the on: keys.
  at="$(awk -v BINMODE=3 '
    { sub(/\r$/, "") }
    !seen && /^["'\'']?on["'\'']?:[[:space:]]*(#.*)?$/ { f = 1; seen = 1; next }
    f && /^[^ #]/ { f = 0; next }
    !f || /^[[:space:]]*(#.*)?$/ { next }
    {
      match($0, /^ */); ind = RLENGTH
      if (key == "") key = ind
      if (ind == key && $0 ~ /^ *["'\'']?pull_request["'\'']?:/) pr = 1
      if (ind == key && $0 ~ /^ *["'\'']?push["'\'']?:/) ps = 1
      last = NR
    }
    END { if (pr && !ps) printf "%d\t%d\n", last + 1, key }
  ' "$1")" || return 1
  if [[ -z "$at" ]]; then
    cat "$1"
    return
  fi

  PUSH="$push" AT="${at%%$'\t'*}" KEY="${at#*$'\t'}" awk -v BINMODE=3 '
    function insert(   i, n, l, pad) {
      pad = sprintf("%" ENVIRON["KEY"] "s", "")
      n = split(ENVIRON["PUSH"], l, "\n")
      for (i = 1; i <= n; i++) printf "%s%s%s", pad, substr(l[i], 3), eol
    }
    BEGIN { eol = "\n" }
    NR == 1 && /\r$/ { eol = "\r\n" }
    NR == ENVIRON["AT"] + 0 { insert() }
    { print }
    END { if (NR < ENVIRON["AT"] + 0) insert() }
  ' "$1"
}

# wk_changelog_job_rewrite <checks.yml> <template>: the file as the heal leaves
# it, each swap only where it applies (`workflow/README.md`, the changelog-job
# row), over the file with its push trigger in place. Lines are written back in
# the file's own ending; a failed read in either step fails the rewrite.
wk_changelog_job_rewrite() {
  local block header retired runs="" asked=0 status
  block="$(wk_changelog_job_block "$2")" || return 1
  header="$(wk_checks_header "$2")" || return 1
  retired="$(wk_retired_checks_headers)"
  [[ -n "$block" && -n "$header" ]] || return 1
  wk_changelog_job_runs_copy "$1" || asked=$?
  case "$asked" in 0) runs=1 ;; 1) ;; *) return 1 ;; esac

  wk_checks_push_trigger "$1" | BLOCK="$block" HEADER="$header" RETIRED="$retired" RUNS="$runs" BOUNDARY="$(wk_job_boundary)" awk -v BINMODE=3 '
    function emit(s) { printf "%s%s", s, eol }
    function flush(   i) { for (i = 1; i <= m; i++) emit(pend[i]); m = 0 }
    # The retired paragraph the pending lines are a prefix of: a full match
    # first, else any prefix, else 0.
    function candidate(   k, i, ok, best) {
      best = 0
      for (k = 1; k <= nk; k++) {
        if (m > n[k]) continue
        ok = 1
        for (i = 1; i <= m; i++) if (pend[i] != old[k, i]) { ok = 0; break }
        if (ok && m == n[k]) return k
        if (ok && !best) best = k
      }
      return best
    }
    BEGIN {
      nl = split(ENVIRON["RETIRED"], r, "\n")
      nk = 1; n[1] = 0
      for (i = 1; i <= nl; i++) {
        if (r[i] == "") { nk++; n[nk] = 0; continue }
        old[nk, ++n[nk]] = r[i]
      }
      nh = split(ENVIRON["HEADER"], hdr, "\n")
      nb = split(ENVIRON["BLOCK"], blk, "\n")
      eol = "\n"
    }
    NR == 1 && /\r$/ { eol = "\r\n" }
    { sub(/\r$/, "") }
    # A retired paragraph, matched line by line; a partial match is written
    # back exactly as it was read, and the line that broke it is tried as the
    # start of a new one before it goes on to the job rules.
    !skip && !swapped {
      pend[++m] = $0
      k = candidate()
      if (k) {
        if (m == n[k]) { for (i = 1; i <= nh; i++) emit(hdr[i]); m = 0; swapped = 1 }
        next
      }
      m--
      flush()
      pend[++m] = $0
      if (candidate()) next
      m = 0
    }
    ENVIRON["RUNS"] != "" && !skip && !done && /^  changelog:/ { for (i = 1; i <= nb; i++) emit(blk[i]); skip = 1; done = 1; next }
    skip && $0 ~ ENVIRON["BOUNDARY"] { skip = 0; for (i = 1; i <= nhold; i++) emit(held[i]); nhold = 0 }
    skip {
      if ($0 ~ /^[[:space:]]*$/ || $0 ~ /^(  )?#/) held[++nhold] = $0
      else nhold = 0
      next
    }
    { emit($0) }
    END { flush(); for (i = 1; i <= nhold; i++) emit(held[i]) }
  '
  status=("${PIPESTATUS[@]}")
  (( status[0] == 0 && status[1] == 0 ))
}
