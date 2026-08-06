The working tree has uncommitted code/config changes. Work items live as GitHub issues (the SSOT); `.workkit/` holds per-session working state that is never committed (only `.workkit/settings.json`, the repo's workflow opt-in, is tracked). Before you stop:

## 1. Keep the work item true (always)

The issue is the record — its labels say where the work is, its comments carry the trail.

- Work in flight → the issue is assigned to you (the assignment IS the claim) and carries exactly one `status:` label (`building` while the work runs, `blocked` when a human decision is pending — the question goes in a comment).
- Work shipped this turn → write the CHANGELOG `[Unreleased]` entry, then close the issue with a comment pointing at it (`Fixes #N` in the commit message does both).
- New notes/ideas surfaced this turn → a `status:inbox` issue; print the `Filed:` trail for what you filed. If GitHub cannot be reached, put the finding in chat and stop there — the owner decides. Never write to `.workkit/inbox.md`: it is the owner's capture surface, cleared only by a triage run.

Only log meaningful progress — skip trivial formatting or typo fixes.

## 2. Promote durable findings out of `.workkit/`

Anything durable that surfaced this turn — a finding, a decision, a blocker — belongs on its issue as a comment BEFORE you stop. Scratch is session state: it is gitignored, private to this developer, and nobody else ever reads it.

## 3. Doc parity (finalized work only)

If this work is FINALIZED, follow the doc-parity rules in AGENTS.md (README, AGENTS.md, relevant docs/*.md, CHANGELOG `[Unreleased]` on any user-visible change). If mid-stream, skip.

## 4. Sign off

State which path you took (e.g. "issue updated" or "issue + docs updated" or "trivial change — skipping"), then stop. Do not re-run this check.
