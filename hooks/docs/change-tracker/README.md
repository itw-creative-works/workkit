# docs:change-tracker

**Hook type:** Stop

Keeps the work item true and checks documentation parity when the working tree has uncommitted code/config changes. Implements the three-layer system described in the project-state spec v3 (`docs/project-state.md`).

## Two behaviors, one hook

1. **Work-item tracking (always):** Nudges Claude to keep the GitHub issue true — exactly one `status:` label, the trail in comments — and to promote durable findings out of `.workkit/` onto the issue before stopping, with **collapse-on-ship** (the turn that writes the CHANGELOG entry closes the issue pointing at it). Unfiled entries in `.workkit/inbox.md` are surfaced with an offer of the `workkit:triage` skill. A repo still carrying a `PROGRESS.md`/`INBOX.md` gets a migration reminder until it moves to issues.
2. **Doc parity (finalized only):** If work is finalized and behavior-affecting, nudges Claude to review `README.md`, `AGENTS.md`, `docs/<topic>.md`, and `CHANGELOG.md [Unreleased]`.

Both share the same detection logic (dirty tree with non-doc changes) and fire once per response.

## Design principles

- **Nudge, don't command.** The prompt tells Claude to SKIP doc parity if work isn't finalized.
- **Fire at most once per response** (`stop_hook_active` gate).
- **Nudge once per unique dirty state per session.** A marker in `$TMPDIR/claude-change-tracker/<session>.last` stores a hash of `git status --porcelain`; if the tree hasn't changed since the last nudge, the hook stays silent — pure Q&A turns over a pre-existing dirty tree don't re-block every Stop. New/changed modifications re-arm the nudge.
- **Stay SILENT** on clean trees or doc-only changes.
- **Prompt lives in `prompt.md`** — edit the nudge without touching bash.
- No network, no AI, runs in milliseconds. Pure git + jq.

## The three-layer system

| Layer | File(s) | Cadence |
|-------|---------|---------|
| Work item | The issue (labels + comments) | Every turn |
| Docs | `AGENTS.md`, `README.md`, `docs/*` | When finalized |
| Changelog | `CHANGELOG.md [Unreleased]` | When shipped |

Pipeline: work item → docs → changelog.

## Files

- `run.sh` — detection logic, reads `prompt.md`, emits reminder
- `prompt.md` — the injected context (edit this to change the nudge)
- `README.md` — this file
