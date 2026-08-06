# docs:change-tracker

**Hook type:** Stop

Keeps the work item true and checks documentation parity when the working tree has uncommitted code/config changes. Implements the three-layer system described in the project-state spec v4 (`docs/project-state.md`).

## Two behaviors, one hook

1. **Work-item tracking (always):** Nudges Claude to keep the GitHub issue true — exactly one `status:` label, the trail in comments — and to promote durable findings out of `.workkit/` onto the issue before stopping, with **collapse-on-ship** (the turn that writes the CHANGELOG entry closes the issue pointing at it). Unfiled entries in `.workkit/capture.md` are surfaced with an offer of the `workkit:triage` skill. A repo still carrying a `PROGRESS.md`/`INBOX.md` gets a migration reminder until it moves to issues.
2. **Doc parity (finalized only):** If work is finalized and behavior-affecting, nudges Claude to review `README.md`, `AGENTS.md`, `docs/<topic>.md`, and `CHANGELOG.md [Unreleased]`.

Both share the same detection logic (dirty tree with non-doc changes) and fire once per response.

## Design principles

- **Nudge, don't command.** The prompt tells Claude to SKIP doc parity if work isn't finalized.
- **Fire at most once per response** (`stop_hook_active` gate).
- **Repeat only when something changed** (issue #132). The hook fingerprints what it nags ABOUT — `git status --porcelain`, the diff behind it, the content of the untracked files, and the content of both capture surfaces (`INBOX.md`, `.workkit/capture.md`) — and remembers the fingerprint it last nagged on in `.workkit/agents/.change-tracker`, the agents' own state. Same fingerprint on the next Stop → silent, so a parked batch and the pure Q&A turns over it cost one nudge, not one per stop. A new edit (which the diff catches even when the status line is identical), an edit to a file still untracked (which only its content catches — the status line is the same name either way), a new file, or a new capture → one more nudge and the new fingerprint. The fingerprint has no clock in it: two identical trees fingerprint identically. Nothing is remembered on a clean tree with an empty capture file — the state file is never written — and neither a repo with no `.workkit/` (UNDECIDED, never written to) nor one whose `.workkit/` is not gitignored gets a memory: the state file is session state, never a file the repo would be asked to commit, so both hear the nudge every Stop.
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
- `.workkit/agents/.change-tracker` — not here but in the repo being watched: the fingerprint last nudged on, written only where `.workkit/` is gitignored like it should be
