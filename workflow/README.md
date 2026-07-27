# workflow — the issue-workflow core

The agent-agnostic core of the issue workflow. It knows nothing about Claude Code, which is why it lives at the plugin's top level instead of under `hooks/` — the hooks call it, and `~/.claude/workkit` is its stable address for anything else that does.

| File | What it is |
|---|---|
| `labels.json` | Machine SSOT for the label vocabulary — every label is `group:value`, with its description and color |
| `standards.sh` | Brings a repo to the standard, idempotently: creates the labels from `labels.json` (and corrects description/color drift), installs the issue templates and the required-checks CI workflow, asks for branch protection on the test check (best effort), moves a repo's old `.workflow/` to `.workkit/` once, keeps `.workkit/` in `.gitignore`, seeds `.workkit/inbox.md` and `.workkit/session.md`, and reports leftovers from a retired convention |
| `templates/issue-forms/` | The markdown GitHub issue templates (bug · enhancement · idea · dump) installed into a repo's `.github/ISSUE_TEMPLATE/`. Each pre-fills the issue anatomy (`## Description` then `## Spec`) and auto-applies `status:inbox` + its `type:` label |
| `templates/github-workflows/` | `checks.yml`, the CI workflow installed into a repo's `.github/workflows/` — runs the test suite on every pull request. Installed once; the repo's copy is its own to extend and is never overwritten |
| `templates/inbox.md` · `templates/session.md` | The two gitignored working files seeded into a participating repo's `.workkit/`. A file that already has content is never overwritten |
| `changelog.js` | Machine SSOT for the CHANGELOG entry rules, and the CLI both guarding hooks call: `node changelog.js <file> [--added-only] [--staged]` |
| `changelog-links.js` | Release-time backfill of each entry's commit link and contributor handle: `node changelog-links.js [--file X] [--range A..B] [--dry-run]` |

## The CHANGELOG entry format

An entry is one short paragraph pointing at the depth, never a second copy of the commit body. Written during ordinary work as `- [#4](../../issues/4) — What changed.`; the commit link and `Thanks [@who]!` are filled in at release time by `changelog-links.js`, which matches entries to commits through the `Fixes #N` trailer they already carry. The rules and the reasoning live in [`docs/project-state.md`](../docs/project-state.md) → "CHANGELOG entries"; `changelog.js` is where they are executable.

## The standard version

`settings.json`'s `version` records the standard a repo was last healed to; the script carries the current one. A repo already at it does what it always did — cheap idempotent checks. A repo BELOW it also gets a drift report, then has its version stamped forward once the mechanical heals succeed (a half-heal leaves it alone, so the repo is asked again).

The report names, and never touches, what a script must not decide alone: `PROGRESS.md`, `INBOX.md`, `TODO.md`, and `plans/` (each still holds work items nobody migrated), and a `CHANGELOG.md` whose entries are not in the entry format. Each line says what to run. Deleting those files is a judgment call and a human's to make.

## The two settings files

Same filename, one mental model, two owners.

| File | Owner | Holds |
|---|---|---|
| `<repo>/.workkit/settings.json` | the project (committed) | `{ "version": 1, "enabled": true }` — the repo's yes. `"enabled": false` is the project's deliberate no |
| `~/.workkit/settings.json` (`$WORKFLOW_HOME` overrides) | one developer (never committed) | `{ "version": 1, "repos": { "<absolute repo root>": "declined" } }` — personal decisions about repos that carry no committed answer |

Never-asked and declined are personal, not project facts (owner ruling, 2026-07-24): a teammate seeing `enabled: false` in a shared repo would read it as the project declining when it was one developer undecided. Only a real yes belongs in the repo.

## Participation — the tri-state

| Repo state | `standards.sh` does |
|---|---|
| committed `enabled: true`, or no `enabled` key at all | heal |
| committed `enabled: false` | nothing, silently |
| no committed file, no record | print one line offering to enable — and write **nothing** into the repo |
| no committed file, recorded `declined` | nothing, silently |

Both answers are explicit commands, never something a hook decides:

```sh
bash ~/.claude/workkit/standards.sh --enable [repo]    # write the committed opt-in, then heal
bash ~/.claude/workkit/standards.sh --decline [repo]   # record it in the USER file; never offered again
bash ~/.claude/workkit/standards.sh --state [repo]     # enabled | disabled | declined | undecided | nogit
bash ~/.claude/workkit/standards.sh --announce [repo]  # the offer line, for a hook to relay
```

`--decline` writes only the `repos` key: every other key in the user file, and its value, survives untouched. Both files are created lazily — nothing exists until there is a decision to record.

## How it is reached

The hooks resolve this folder from their own location, so they work the moment the plugin is installed. Everything else — the spec, the skills, anything scripting the standard by hand — reaches it at `~/.claude/workkit`, a symlink this script maintains itself: every run points the address at the folder it is running from, and removes the link the address carried under its previous name. The hook takes a `WORKFLOW_DIR` override and the address step a `WORKFLOW_CLAUDE_HOME` one; the tests use both.

Run it by hand against any repo:

```sh
bash ~/.claude/workkit/standards.sh [repo-root]
```

Only the label step needs `jq`, `gh`, and a reachable remote; the migration, gitignore, working-file, and forms heals are pure bash and always run. The gitignore heal checks its result with `git check-ignore` rather than looking for its own text — if some other pattern still hides `.workkit/settings.json` (the directory form `.workkit/` does exactly that, and no negation can undo it), the run names that line and reports the repo as needing attention instead of claiming success.

## Where this is going

This folder is the seed of a future installable kit — the workflow defined once, installed per agent and per developer, in repos beyond the owner's own. Tracking: issue #2. Keep it self-contained: nothing here may depend on `~/.claude`, on Claude Code, or on anything else in this repo.

The spec it implements: [`../docs/project-state.md`](../docs/project-state.md).
