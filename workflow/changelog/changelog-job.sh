#!/usr/bin/env bash
# workflow/changelog/changelog-job.sh: the `changelog` job in a repo's
# checks.yml, read and rewritten, and the retired linter copies. Sourced by
# standards.sh and, for safety/commit-gate, by hooks/_lib.sh: one rewrite, so
# the gate never accepts a change the heal would not make. Functions only.
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

# wk_names_linter_copy [copy]: true when stdin names the copy (or any copy)
# outside a comment line, since naming it is running it. Both greps read all
# of stdin, so no writer upstream is cut short.
wk_names_linter_copy() {
  local copy args=()
  if [[ $# -gt 0 ]]; then
    args=(-e "$1")
  else
    while IFS= read -r copy; do args+=(-e "$copy"); done < <(wk_linter_copies)
  fi
  grep -v '^[[:space:]]*#' | grep -F "${args[@]}" >/dev/null
}

# wk_workflows_run_copy <root> [copy]: true when any file under
# <root>/.github/workflows names the copy (or any copy). An unreadable folder
# cannot prove the copy unused, so it answers yes.
wk_workflows_run_copy() {
  local dir="$1/.github/workflows" text
  [[ -d "$dir" ]] || return 1
  text="$(find "$dir" -type f -exec cat {} + 2>/dev/null)" || return 0
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

# wk_changelog_job_runs_copy <file>: true when the file's changelog job names a
# linter copy.
wk_changelog_job_runs_copy() {
  local job
  job="$(wk_changelog_job_block "$1")" || return 1
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

# wk_changelog_job_rewrite <checks.yml> <template>: the file as the heal leaves
# it, each swap only where it applies (`workflow/README.md`, the changelog-job
# row). Lines are written back in the file's own ending, and awk's status is
# the answer, so an unreadable file fails rather than coming back empty.
wk_changelog_job_rewrite() {
  local block header retired runs=""
  block="$(wk_changelog_job_block "$2")" || return 1
  header="$(wk_checks_header "$2")" || return 1
  retired="$(wk_retired_checks_headers)"
  [[ -n "$block" && -n "$header" ]] || return 1
  if wk_changelog_job_runs_copy "$1"; then runs=1; fi

  BLOCK="$block" HEADER="$header" RETIRED="$retired" RUNS="$runs" BOUNDARY="$(wk_job_boundary)" awk -v BINMODE=3 '
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
  ' "$1"
}
