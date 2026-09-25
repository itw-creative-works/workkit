---
name: migrate
description: Bring a repo the rest of the way onto project-state spec v4 (retired PROGRESS/INBOX/TODO/plans files become issues, CHANGELOG history is rewritten to the entry format). - Use when the user says "migrate this repo", "bring this repo to the standard", or "fix the changelog history".
user-invocable: true
argument-hint: "[repo path] [files|changelog]"
---

# Migrate: the judgment half of a repo migration

`workflow:standards` heals what is safe to heal automatically. Everything it can only REPORT lands here: each item destroys information or needs a human's call. It runs only when invoked; no hook fires it.

Spec (SSOT for every rule below): the workkit plugin's `docs/project-state.md`.

## 0. Scope from the drift report, never from a fresh scan

Run the reporter and migrate exactly what it names:

```sh
bash ~/.claude/workkit/standards.sh --state <repo>   # is the repo even opted in?
bash ~/.claude/workkit/standards.sh <repo>           # the drift report
```

- Deriving the list again here would let the two disagree about what counts as drift.
- Report silent: the repo is already at the standard. Say so and stop.
- Not opted in: not migrated. Offer `--enable` and stop. Migrating a repo that never said yes writes issues into someone else's tracker.
- An argument narrows the run: `files` does §1 only, `changelog` does §2 only. Default is both.

## 1. Retired files → issues

`PROGRESS.md`, `INBOX.md`, `TODO.md`, and `plans/` are retired. Their contents are work items, and work items live as GitHub issues.

This is `workkit:triage`'s routing pointed at a file instead of an inbox. **Invoke that skill for the routing decisions**; this section adds only the file handling:

1. Read the whole file first. Split it into discrete items; never file a mixed dump as one issue.
2. Drop what is already true. A board's `Done` lane is history, which lives in the CHANGELOG and the commits. Never file completed work as an open issue.
3. File each live item with `## Description` then `## Spec`, exactly one `status:` label, and a `type:` label. A small item's Spec is the literal line `None needed: small item.` Never apply `agent:ok`; that is the owner's to grant.
4. A `plans/` file becomes the `## Spec` of its issue: one plan, one issue. A spec already marked rejected is not filed; it stays rejected.
5. **Print the Filed trail before deleting anything.** It is the `**🗂️ Filed**` section `workkit:triage` prints: one bullet per item, leading with its issue link, in the cold-reader line (`docs/project-state.md` § Restating an issue).
6. **Never delete a file whose items are not yet filed.** Delete it only once every live item in it has an issue number; the trail is the receipt. Deleting first turns a mis-read into lost work.

An item whose home is genuinely unclear: file it `status:inbox` and mark it `(check placement)` in the trail. Do not stop to ask per item.

## 2. CHANGELOG history → the entry format

- The entry rules and their reasoning: the workkit plugin's `docs/project-state.md` § CHANGELOG entries. The machine SSOT is `~/.claude/workkit/changelog.js`.
- In short: one short paragraph per entry, at most 50 words. It starts with `[#N](../../issues/N)` or the literal `(no issue)`, then ` - ` before the prose.
- The depth is NOT deleted: it already lives in the commit each entry links to. That makes the compression safe.

**The WHOLE file migrates, and the linter cannot scope this work for you.**
- `changelog.js`'s section detector deliberately skips non-semver `## [...]` headings (the `## [Plans for 2026]` guard).
- So a pre-issue era section (`## [cp1–cp99]: …`) lints green while every entry in it is still a massive old-format line.
- Scope by EYEBALL: every `## ` section with bullets under it migrates. Any long-line entry anywhere means the work is not done.
- Pre-issue-tracker entries take the literal `(no issue)`.

### Split the work by version section

A long history does not fit one context. Fan it out:

1. List every `## [version]` heading and its line range, including non-semver era headings the linter ignores.
2. Divide into contiguous ranges, one subagent per range.
3. Give each agent **the count of sections it owns**. It states that count back and confirms it rewrote all of them before returning. The count catches an agent that returns only the first section of its range.
4. Each agent returns rewritten markdown for its range ONLY, never the whole file.

### What every agent must preserve

- Every `## [version] - date` heading, verbatim, including versions with no entries.
- Every `### Added` / `### Changed` / `### Fixed` / `### Removed` / `### Security` category heading that has entries under it. A dropped `### Removed` loses what was taken away, which is exactly what history gets consulted for.
- Any `---` rules and prose sections between version blocks.
- An entry that already has generated metadata (`[`sha`](../../commit/sha)`, `Thanks [@who]!`) keeps it, untouched.

Rewriting a released entry is a rewrite of the RECORD. Compress the prose; never change what an entry claims happened.

### Assemble and gate

Reassemble in order, then gate on the whole file:

```sh
node ~/.claude/workkit/changelog.js CHANGELOG.md
```

- Whole file, not `--added-only`: this pass rewrites history rather than adding lines. It must exit 0 before the work is done.
- Confirm, out loud, that the section count after equals the section count before.

## 3. Close out

- Report the before/after: section count (must be equal), entry count, file size.
- Stamp the standard forward by re-running `bash ~/.claude/workkit/standards.sh <repo>`. With the drift gone, it writes the version itself. Do not hand-edit `.workkit/settings.json`.
- CHANGELOG entry + commit belong to the normal flow (`workkit:ship`), not to this skill. Migrating is not shipping.

## Rules

- **Never invent priority or ordering.** Queue position is the owner's call; `status:specced` with no priority label is the default.
- **Idempotent.** Re-running on a migrated repo finds nothing in the drift report and does nothing.
- A repo with no CHANGELOG at all is not given one here. That is a repo-setup decision, not a migration.
