#!/usr/bin/env bash
# workflow/standards/changelog.sh: the CHANGELOG heals: the retired linter
# copies removed and the em dash separator converted once. Sourced by
# standards.sh, functions only.

# ── 2b-i. The CHANGELOG linter copy, retired ──
# Only a copy carrying the kit's vendor header on line 2 is removed, and a copy
# a workflow still runs is kept and reported. This runs after the caller's
# rewrite, so the checks.yml the heal owns never runs a copy.
remove_changelog_linter_copies() {
  local copy runs

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

    runs=0
    wk_workflows_run_copy . "$copy" 2>/dev/null || runs=$?
    if [[ "$runs" -eq 0 ]]; then
      wk_warn "changelog lint: kept $copy: a workflow under .github/workflows still runs it; point that step at the kit's workflow and the next heal removes the copy"
      needs_attention=1
      continue
    fi
    # An unreadable folder cannot prove the copy unused, so it stays.
    if [[ "$runs" -ne 1 ]]; then
      wk_warn "changelog lint: kept $copy: .github/workflows could not be read, so nothing proves the copy unused"
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
