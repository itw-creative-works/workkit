---
name: migrate
description: Bring a repo the rest of the way onto project-state spec v3 — file the contents of retired PROGRESS.md/INBOX.md/TODO.md/plans as issues and delete them, and rewrite CHANGELOG history into the entry format. - Use when the user says "migrate this repo", "bring this repo to the standard", "fix the changelog history", "delete PROGRESS.md", or when the workflow:standards drift report names retired files or CHANGELOG entries out of format.
user-invocable: true
argument-hint: [repo path] [files|changelog]
---

# Migrate — the judgment half of a repo migration

`workflow:standards` heals what is safe to heal automatically. Everything it can only REPORT is here, because every item on that list either destroys information or needs a human's call. This skill runs only when invoked; nothing about it fires from a hook.

Spec (SSOT for every rule below): the workkit plugin's `docs/project-state.md`.

## 0. Scope from the drift report, never from a fresh scan

Run the reporter and migrate exactly what it names:

```sh
bash ~/.claude/workflow/standards.sh --state <repo>   # is the repo even opted in?
bash ~/.claude/workflow/standards.sh <repo>           # the drift report
```

Deriving the list again here would let the two disagree about what counts as drift. If the report is silent, the repo is already at the standard — say so and stop.

A repo that is not opted in is not migrated. Offer `--enable` and stop; migrating a repo that never said yes writes issues into someone else's tracker.

An invocation argument narrows the run: `files` does §1 only, `changelog` does §2 only. Default is both.

## 1. Retired files → issues

`PROGRESS.md`, `INBOX.md`, `TODO.md`, and `plans/` are retired. Their contents are work items, and work items live as GitHub issues.

This is `workkit:triage`'s routing pointed at a file instead of an inbox — **invoke that skill for the routing decisions** rather than restating them here. What this section adds is the file-specific handling:

1. Read the whole file first. Split it into discrete items; never file a mixed dump as one issue.
2. Drop what is already true: a board's `Done` lane is history, and history lives in the CHANGELOG and the commits. Do not file completed work as an open issue.
3. File each live item with `## Description` then `## Plan` (a small item's Plan is the literal line `None needed — small item.`), exactly one `status:` label, and a `type:` label. Never apply `agent:ok` — that is Ian's to grant.
4. A `plans/` file becomes the `## Plan` section of its issue. One plan, one issue. A plan already marked rejected is not filed; it stays rejected.
5. **Print the Filed trail before deleting anything**, one line per item: `"<summary>" → #<number>`.
6. Delete the file only after every live item in it has an issue number. Deleting first turns a mis-read into lost work.

If an item's home is genuinely unclear, file it `status:inbox` and mark it `(check placement)` in the trail. Do not stop to ask per item.

## 2. CHANGELOG history → the entry format

The entry rules and their reasoning live in the workkit plugin's `docs/project-state.md` → "CHANGELOG entries"; the machine SSOT is `~/.claude/workflow/changelog.js`. In short: one short paragraph per entry, starting with `[#N](../../issues/N)` or the literal `(no issue)`, ` — ` before the prose, at most 50 words.

The depth is NOT deleted — it already lives in the commit each entry links to. That is what makes the compression safe to do.

### Split the work by version section

A long history does not fit one context. Fan it out:

1. List every `## [version]` heading and its line range.
2. Divide into contiguous ranges, one subagent per range.
3. Give each agent **the count of sections it owns** and require it to state that count back and confirm it rewrote all of them before returning. An agent here returned only the first section of its range on the first attempt, and the range had to be redone — the count is the check that catches it.
4. Each agent returns rewritten markdown for its range ONLY, never the whole file.

### What every agent must preserve

- Every `## [version] - date` heading, verbatim, including versions with no entries.
- Every `### Added` / `### Changed` / `### Fixed` / `### Removed` / `### Security` category heading that has entries under it. A whole `### Removed` category was dropped in the first pass here, and what was taken away is exactly what history gets consulted for.
- Any `---` rules and prose sections between version blocks.
- An entry that already has generated metadata (`[`sha`](../../commit/sha)`, `Thanks [@who]!`) keeps it, untouched.

Rewriting a released entry is a rewrite of the RECORD. Compress the prose; never change what an entry claims happened.

### Assemble and gate

Reassemble in order, then gate on the whole file:

```sh
node ~/.claude/workflow/changelog.js CHANGELOG.md
```

Whole file, not `--added-only` — the point of this pass is the history, which adds no lines. It must exit 0 before the work is done. Also confirm, out loud, that the section count after equals the section count before.

## 3. Close out

- Report the before/after: section count (must be equal), entry count, file size.
- Stamp the standard forward by re-running `bash ~/.claude/workflow/standards.sh <repo>` — with the drift gone, it writes the version itself. Do not hand-edit `.workkit/settings.json`.
- CHANGELOG entry + commit belong to the normal flow (`workkit:ship`), not to this skill. Migrating is not shipping.

## Rules

- **Never delete a file whose items are not yet filed.** The Filed trail is the receipt.
- **Never invent priority or ordering.** Queue position is Ian's call; `status:queued` with no priority label is the default.
- **Idempotent.** Re-running on a migrated repo finds nothing in the drift report and does nothing.
- A repo with no CHANGELOG at all is not given one here — that is a repo-setup decision, not a migration.
