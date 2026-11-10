#!/usr/bin/env bash
# workflow/standards/templates.sh: the issue forms a repo receives from the
# kit's templates, each installed once and never overwritten. Sourced by
# standards.sh, functions only.

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
      wk_warn "issue forms: template missing at $(wk_native_path "$FORMS_DIR/$form.md"); reinstall the workflow core"
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
