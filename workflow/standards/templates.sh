#!/usr/bin/env bash
# workflow/standards/templates.sh: the two installs a repo receives from the
# kit's templates, once each and never overwritten: the issue forms and the
# required-checks CI workflow. SOURCED by standards.sh, never executed, and it
# runs nothing at load: it defines functions and sets nothing.

# ── 2. Issue forms ──
ensure_issue_forms() {
  local dest=".github/ISSUE_TEMPLATE" form created=0 existing=0

  mkdir -p "$dest"
  for form in bug enhancement idea dump; do
    if [[ -f "$dest/$form.md" ]]; then
      existing=$((existing + 1))
      continue
    fi
    if [[ ! -f "$FORMS_DIR/$form.md" ]]; then
      wk_warn "issue forms: template missing at $FORMS_DIR/$form.md; reinstall the workflow core"
      needs_attention=1
      continue
    fi
    cp "$FORMS_DIR/$form.md" "$dest/$form.md"
    created=$((created + 1))
  done

  if [[ "$created" -gt 0 ]]; then
    wk_ok "issue forms: created $created in $dest"
  fi
  if [[ "$existing" -gt 0 ]]; then
    wk_skip "issue forms: $existing already present"
  fi
}

# ── 2b. Required-checks CI workflow ──
# One file, installed once. A pull request from an author without the local
# hooks (a cloud agent, a collaborator) still meets the test bar before merge.
# Never overwritten: the installed copy belongs to the repo, which may extend
# it (different runner, extra steps) without the heal fighting the edit.
# PRESENCE is the check, not content, so a repo that wants no Actions run
# keeps the file with the jobs removed (or empty) rather than deleting it;
# a deleted file would be re-installed on the next heal.
ensure_ci_workflow() {
  local dest=".github/workflows/checks.yml" src
  src="$(wk_checks_template)"

  if [[ -f "$dest" ]]; then
    wk_skip "checks: $dest already present"
    return 0
  fi
  if [[ ! -f "$src" ]]; then
    wk_warn "checks: template missing at $src; reinstall the workflow core"
    needs_attention=1
    return 0
  fi
  mkdir -p .github/workflows
  cp "$src" "$dest"
  wk_ok "checks: created $dest; commit it so it runs on every pull request"
}
