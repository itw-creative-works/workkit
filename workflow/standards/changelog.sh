#!/usr/bin/env bash
# workflow/standards/changelog.sh: the CHANGELOG heals: the retired linter
# copies removed, the em dash separator converted once, and the changelog job
# put in the repo's checks.yml. The job's reading and rewriting is
# changelog-job.sh's. Sourced by standards.sh, functions only.

# ── 2b-i. The CHANGELOG linter copy, retired ──
# Only a copy carrying the kit's vendor header on line 2 is removed, and a copy
# a workflow still runs is kept and reported. This runs after the job rewrite,
# so the job the heal owns never holds a copy in place.
remove_changelog_linter_copies() {
  local copy

  while IFS= read -r copy; do
    [[ -f "$copy" ]] || continue
    case "$(sed -n 2p "$copy")" in
      "// Vendored"*) ;;
      *)
        wk_warn "changelog lint: $copy is not the kit's copy; CI runs the kit's workflow now, so move or delete it by hand"
        needs_attention=1
        continue
        ;;
    esac

    if wk_workflows_run_copy . "$copy"; then
      wk_warn "changelog lint: kept $copy: a workflow under .github/workflows still runs it; point that step at the kit's workflow and the next heal removes the copy"
      needs_attention=1
      continue
    fi
    if ! rm -f "$copy"; then
      wk_warn "changelog lint: could not remove $copy"
      needs_attention=1
      continue
    fi
    wk_ok "changelog lint: removed $copy, CI runs the kit's workflow now; commit it"
  done < <(wk_linter_copies)
}

# ── 2b-ii. The CHANGELOG separator ──
# A repo written before the no-em-dash rule is converted once, prose and
# separator alike, and the linter then proves the whole file.
ensure_changelog_separator() {
  local file="CHANGELOG.md" count

  [[ -f "$file" ]] || return 0
  # grep -q first: under pipefail a count pipeline over a clean file is a
  # failing status, and that would end the heal for the common case.
  LC_ALL=C grep -q $'\xe2\x80\x94' "$file" || return 0
  count=$(LC_ALL=C grep -o $'\xe2\x80\x94' "$file" | wc -l | tr -d ' ')

  # Inline, a spaced hyphen; at a line boundary, a bare hyphen in place, so no
  # newline is ever swallowed and a wrapped entry keeps its lines.
  if ! perl -CSD -pi -e 's/(?<=\S)[ \t]*\x{2014}[ \t]*(?=\S)/ - /g; s/\x{2014}/-/g' "$file"; then
    wk_warn "changelog separator: could not convert $file; replace its em dashes with spaced hyphens by hand"
    needs_attention=1
    return 0
  fi
  wk_ok "changelog separator: converted $count em dashes in $file to spaced hyphens; commit it"
}

# ── 2b-iii. The changelog job in the repo's checks.yml ──
# checks.yml is the repo's own, so the heal appends the template's job or
# rewrites an existing one (changelog-job.sh), never the whole file. Appending
# is only safe while `jobs:` is the last top-level block.
ensure_changelog_job() {
  local dest=".github/workflows/checks.yml" src block runs=0 last tmp
  src="$(wk_checks_template)"

  [[ -f "$dest" ]] || return 0
  # A missing template was already reported by the install step above.
  [[ -f "$src" ]] || return 0

  block="$(wk_changelog_job_block "$src")"
  if [[ -z "$block" ]]; then
    wk_warn "checks: the template at $src defines no changelog job; reinstall the workflow core"
    needs_attention=1
    return 0
  fi

  if grep -qE '^  changelog:' "$dest"; then
    if wk_changelog_job_runs_copy "$dest"; then runs=1; fi
    tmp="$dest.tmp.$$"
    if ! wk_changelog_job_rewrite "$dest" "$src" >"$tmp" 2>/dev/null || [[ ! -s "$tmp" ]]; then
      rm -f "$tmp"
      wk_warn "checks: could not rewrite the changelog job in $dest; replace it with the template's job by hand"
      needs_attention=1
      return 0
    fi
    if cmp -s "$tmp" "$dest"; then
      rm -f "$tmp"
      wk_skip "checks: the changelog job is already in $dest"
      return 0
    fi
    if ! mv "$tmp" "$dest"; then
      rm -f "$tmp"
      wk_warn "checks: could not write $dest"
      needs_attention=1
      return 0
    fi
    if [[ "$runs" -eq 1 ]]; then
      wk_ok "checks: the changelog job in $dest now calls the kit's workflow; commit it"
    else
      wk_ok "checks: the header comment in $dest now describes the kit's workflow; commit it"
    fi
    return 0
  fi

  last="$(grep -E '^[A-Za-z_-]+:' "$dest" | tail -n 1)"
  if [[ "$last" != "jobs:" ]]; then
    wk_skip "checks: $dest does not end in its jobs: block; add a changelog job whose one line is '$(grep -m 1 'uses:' <<<"$block" | sed 's/^ *//')' by hand"
    return 0
  fi

  if [[ -n "$(tail -c 1 "$dest")" ]]; then
    printf '\n' >>"$dest"
  fi
  printf '%s\n' "$block" >>"$dest"
  wk_ok "checks: added the changelog job to $dest; commit it"
}
