# workflow — the issue-workflow core

The agent-agnostic core of the issue workflow. It knows nothing about Claude Code, which is why it lives at the plugin's top level instead of under `hooks/` — the hooks call it, and `~/.claude/workkit` is its stable address for anything else that does.

| File | What it is |
|---|---|
| `labels.json` | Machine SSOT for the label vocabulary — every label is `group:value`, with its description and color |
| `standards.sh` | Brings a repo to the standard, idempotently: creates the labels from `labels.json` (and corrects description/color drift), installs the issue templates and the required-checks CI workflow, vendors `changelog.js` to the repo's `.github/changelog-lint.js` and adds the `changelog` job to its `checks.yml`, asks for branch protection on the test check (best effort), moves a repo's old `.workflow/` to `.workkit/` once, keeps `.workkit/` in `.gitignore` along with the basics every repo needs (`.DS_Store`, `.env` — appended only when nothing already covers them), seeds `.workkit/inbox.md` and `.workkit/session.md`, releases agent claims that went quiet, checks that the hook layer beside it is alive, reports an open issue whose status labels are missing or doubled (and flags the run so the next session hears it again), and reports leftovers from a retired convention |
| `templates/issue-forms/` | The markdown GitHub issue templates (bug · enhancement · idea · dump) installed into a repo's `.github/ISSUE_TEMPLATE/`. Each pre-fills the issue anatomy (`## Description` then `## Spec`) and auto-applies `status:inbox` + its `type:` label |
| `templates/github-workflows/` | `checks.yml`, the CI workflow installed into a repo's `.github/workflows/` — the `test` job runs the suite on every pull request, the `changelog` job holds the `[Unreleased]` section to the entry format. Installed once; the repo's copy is its own to extend and is never overwritten, except that the `changelog` job is appended once to a workflow healed before it existed |
| `templates/inbox.md` · `templates/session.md` | The two gitignored working files seeded into a participating repo's `.workkit/`. A file that already has content is never overwritten |
| `wk.sh` | The capture CLI: `wk.sh note <text...>` appends one bullet to the right inbox |
| `changelog.js` | Machine SSOT for the CHANGELOG entry rules, and the CLI both guarding hooks call: `node changelog.js <file> [--added-only] [--staged] [--unreleased-only]` |
| `changelog-links.js` | Release-time backfill of each entry's commit link and contributor handle: `node changelog-links.js [--file X] [--range A..B] [--dry-run]` |

## The capture CLI

`wk.sh` gets a thought out of a head and into an inbox with no session, no agent, and no network:

```sh
bash ~/.claude/workkit/wk.sh note fix the tower poller
```

The words after `note` join with spaces, so the call works unquoted, and the bullet lands in the inbox of the repo the shell is standing in — decided by a walk UP from the current directory to the first ancestor whose `.workkit/settings.json` says the repo participates. Standing outside one, it lands in the user's own `~/.workkit/inbox.md`. A missing inbox is created from `templates/inbox.md`, so a hand-made file reads exactly like a seeded one; existing content is only ever appended to. No arguments, an unknown subcommand, or an empty note prints usage on stderr and exits 1. Triage drains both inboxes into issues.

Putting it on the PATH or behind an alias is the user's own shell config (dotfiles) — the heal maintains the address below and nothing beyond it.

## The CHANGELOG entry format

An entry is one short paragraph pointing at the depth, never a second copy of the commit body. Written during ordinary work as `- [#4](../../issues/4) — What changed.`; the commit link and `Thanks [@who]!` are filled in at release time by `changelog-links.js`, which matches entries to commits through the `Fixes #N` trailer they already carry. The rules and the reasoning live in [`docs/project-state.md`](../docs/project-state.md) → "CHANGELOG entries"; `changelog.js` is where they are executable.

The two guarding hooks run only where the plugin is installed, so the format is also checked in CI, which every author passes through. The heal vendors `changelog.js` to each participating repo's `.github/changelog-lint.js` — headed by a line saying the kit owns it, byte-synced on every run, so an edit to the copy is undone next heal — and the `changelog` job runs it as `--unreleased-only`. Released history is already published and is never judged there; a repo with no `CHANGELOG.md` passes cleanly.

## The standard version

`settings.json`'s `version` records the standard a repo was last healed to; the script carries the current one. A repo already at it does what it always did — cheap idempotent checks. A repo BELOW it also gets a drift report, then has its version stamped forward once the mechanical heals succeed (a half-heal leaves it alone, so the repo is asked again).

The report names, and never touches, what a script must not decide alone: `PROGRESS.md`, `INBOX.md`, `TODO.md`, and `plans/` (each still holds work items nobody migrated), and a `CHANGELOG.md` whose entries are not in the entry format. Each line says what to run. Deleting those files is a judgment call and a human's to make.

## The hook layer self-check

Every hook fails open by design, so a chmod-stripped script, a syntax error, or a missing tool takes a safety layer offline with nothing watching. Once a day, the heal asserts the layer beside it: every hook wired in `hooks.json` resolves through `loader.sh` to a script that exists, is executable, and parses (`bash -n`), and the tools they call (`jq`, `git`, `node`, `shasum`) are on the PATH. A broken script is a broken install — it warns and marks the run unfinished, so the next session tries again. A missing tool warns just as loudly but never marks the run: no repo can install it, and holding the version stamp hostage to it would nag forever. An engine installed with no hook layer beside it checks nothing and says nothing (`WORKFLOW_HOOKS_DIR` overrides the location).

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

Only the label step, the claim sweep, and the label report need `jq`, `gh`, and a reachable remote; the migration, gitignore, working-file, and forms heals are pure bash and always run. The gitignore heal checks its result with `git check-ignore` rather than looking for its own text — if some other pattern still hides `.workkit/settings.json` (the directory form `.workkit/` does exactly that, and no negation can undo it), the run names that line and reports the repo as needing attention instead of claiming success.

## Where this is going

This folder is the seed of a future installable kit — the workflow defined once, installed per agent and per developer, in repos beyond the owner's own. Tracking: issue #2. Keep it self-contained: nothing here may depend on `~/.claude`, on Claude Code, or on anything else in this repo.

The spec it implements: [`../docs/project-state.md`](../docs/project-state.md).
