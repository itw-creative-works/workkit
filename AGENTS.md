# workkit — Architecture Overview

> **Deep references go in `docs/<topic>.md`, not here.** Keep this file under ~250 lines.

## Identity

workkit is the issue-pipeline workflow system packaged as a Claude Code plugin: the standards heal, the manager crew, the guard hooks, the workflow skills, and the agent-agnostic engine they all call. It installs into any repo's sessions and brings that repo to one standard — GitHub Issues as the work-item SSOT, labels as the pipeline, a CHANGELOG entry per shipped item.

The spec it implements is `docs/project-state.md`; the README carries the visual map of the same system — the road and the crew.

## Repo structure

```
<repo>/
├── .claude-plugin/       # plugin.json + marketplace.json (this repo is its own marketplace)
├── hooks/                # hooks.json + the hook groups, resolved via ${CLAUDE_PLUGIN_ROOT}
│   ├── loader.sh         # name → path router (docs:board-guard → docs/board-guard/run.sh)
│   ├── _lib.sh           # shared helpers (sourced, never executed)
│   ├── docs/             # board-guard, changelog-guard, change-tracker, state-check
│   ├── safety/           # vendor-guard, commit-gate, commit-language
│   ├── manager/          # resolver, profile + ladder.json (the tier SSOT)
│   └── workflow/         # standards (the daily heal)
├── agents/               # the crew — surface as workkit:<name> (roster + contract: docs/agents.md)
├── skills/               # the nine workflow skills — surface as workkit:<name>
├── workflow/             # the agent-agnostic engine (labels.json, standards.sh, changelog.js, templates)
├── tower/                # mission control: api/ (the JSON API + its libs) + app/ (the OMEGA dashboard)
├── docs/                 # project-state.md (the spec) · agents.md (the crew contract)
├── tests/                # Node runner + hook/script/tower suites (npm test)
└── .workkit/             # settings.json is COMMITTED (this repo's own opt-in)
```

## Install

```sh
claude plugin marketplace add <path-to-checkout>
claude plugin install workkit@workkit
```

The engine's stable filesystem address, `~/.claude/workkit` → this repo's `workflow/`, needs no install step: the standards heal points it at the folder it is running from on every run. The hooks resolve the engine from their own location instead, so they never wait on it; skills and docs reference it by that path.

## Hooks

Registered in `hooks/hooks.json`, every command routed through `hooks/loader.sh` so settings reference a hook by `prefix:name` rather than a path. A LOADER-level failure fails open (exit 0); the hook's own exit code passes through untouched, which blocking hooks (exit 2) need.

| Hook | Event | What it does |
|---|---|---|
| `workflow/standards` | SessionStart | Brings an enabled repo to the standard once per repo per day — labels from `labels.json`, issue templates, the required-checks CI workflow plus its `changelog` job and the vendored `.github/changelog-lint.js`, best-effort branch protection, `.workkit/` seeded and gitignored, agent claims idle for 24 hours released, and the hook layer itself asserted alive (every wired hook resolves, is executable, parses; the tools they call are present) — and reports only what it fixed. An undecided repo hears one offer and is never written to |
| `docs/state-check` | SessionStart | Announces open `status:inbox` issues, a non-empty `.workkit/inbox.md`, broken pointer files, an oversized AGENTS.md |
| `workflow/reload-guard` | SessionStart + UserPromptSubmit | Stamps the load-time surfaces (`hooks.json` content, the `agents/` and `skills/` file list and mtimes) at session start and injects one line when they change — hook-script, skill-body, and engine edits are already live, so only these need `/reload-plugins`. Each change nags once |
| `manager/resolver` | PreToolUse (Task/Agent) | Supplies each crew spawn's model from `manager/ladder.json` and the live session model |
| `manager/profile` | UserPromptSubmit | Injects the manager standing instruction — delegate to the crew — in frontier/workhorse sessions only |
| `safety/vendor-guard` | PreToolUse (Edit/Write) | Blocks edits to generated, vendored, and gitignored files (`_attic/`, `.workkit/`, `.env*` excepted) |
| `safety/commit-gate` | PreToolUse (Bash) | Blocks `git commit` unless tests pass, new source files come with test files, code carries a fresh review marker, any added CHANGELOG entry matches the format, and a commit closing an issue (`Fixes #N`) stages the entry it closes against |
| `safety/commit-language` | PreToolUse (Bash) | Bounces commit messages using kill/destroy/dead wording, suggesting the neutral terms |
| `docs/board-guard` | PostToolUse (Edit/Write) | Bounces `CLAUDE.md` / `AGENTS.md` writes that break the spec's document rules |
| `docs/changelog-guard` | PostToolUse (Edit/Write) | Bounces a CHANGELOG entry that is an essay instead of one short linked paragraph — only entries the write ADDED |
| `docs/change-tracker` | Stop | Nags about uncommitted work, keeping the issue true, promoting findings out of `.workkit/`, and unfiled inbox notes |

## Agents

Five, namespaced `workkit:<name>`: `scout` (read-only recon), `worker` (implementation against a brief), `verifier` (blind review + review scorer), `advisor` (frontier consult, never implements), `reviewer` (compliance lens, derives its checklist from the live repo docs).

The first four are CAPABILITY CLASSES: the `manager/resolver` hook supplies each spawn's model from `hooks/manager/ladder.json` and the live session model, so the `model:` frontmatter is only a fallback. Roster, the file-handoff convention, and the definition rules: `docs/agents.md` (kept out of `agents/` — every markdown file there surfaces as an agent type).

## Skills

Nine, namespaced `workkit:<name>`, one `SKILL.md` each:

| Skill | What it does |
|---|---|
| `feature` | The scaled build flow — explore, grill, propose, gate, build, review; builds only from `status:specced` |
| `grill` | Alignment interrogation — one decision at a time, each with a recommendation |
| `diagnose` | Reproduce-first debugging |
| `review` | Multi-lens code review: parallel lenses, a separate scorer, ≥80 threshold; leaves the marker the commit gate checks |
| `simplify` | Test-gated cleanup of a fresh diff — green before AND after |
| `triage` | Routes every captured entry to exactly one home and prints the Filed trail |
| `whats-next` | Plain-language digest of the repo's open issues |
| `migrate` | The judgment half of a migration: retired files become issues, CHANGELOG history becomes the entry format |
| `ship` | Ship a release — review, commit (or PR), version bump, publish, GitHub release, deploy |

## The engine (`workflow/`)

Agent-agnostic: shell + Node, no Claude Code knowledge. `labels.json` is the label SSOT, `standards.sh` the idempotent heal (plus `--enable` / `--decline` / `--state`), `changelog.js` the entry-format linter both guarding hooks call, `changelog-links.js` the release-time backfill of commit links and contributor handles, `templates/` what a repo receives on enable. Details: `workflow/README.md`.

## The tower (`tower/`)

Mission control, in two processes. `tower/api/` is a plain-Node JSON API with zero dependencies (`npm run tower`, port 8693); `tower/app/` is the dashboard, an OMEGA app on port 4300 that reads it cross-origin. Six pages — Overview, Board, Crew, Usage, Health, Brief — over the cross-repo issue board, the live Claude crew and its token spend, per-repo health, and the daily brief, with an intake dialog on the topbar of every one. A view, never a second store: it reads the opted-in repos' issues via one GraphQL sweep, the keep-awake markers, the session transcripts, and git; its only write path is `gh issue create`. The API is useful alone: `/api/brief` exists so the 9am job and the page can share one payload, and the job is switched over separately. The framework owns the chrome, which is why the app consumes `@omega.js/*` by `file:` spec rather than vendoring a stylesheet. Reference: `tower/README.md`.

## Participation is a tri-state

A repo's committed `.workkit/settings.json` (`{ "version": 1, "enabled": true }`) is the project's yes; `"enabled": false` is its deliberate no; per-developer declines live in `~/.workkit/settings.json`. A repo with no answer hears one offer per session and is never written to. Everything else under `.workkit/` is gitignored session state.

## Tests

`npm test` runs `tests/run.js`, which discovers every `tests/**/*.test.js`. A suite whose precondition this machine cannot meet calls `skipSuite()` and the runner names the skip rather than hiding it. Suites live under `tests/hooks/`, `tests/scripts/`, and `tests/tower/`.

## Conventions

- **Portable by default.** Nothing under `hooks/`, `agents/`, or `skills/` may carry a machine-specific absolute path. Hook commands resolve through `${CLAUDE_PLUGIN_ROOT}`; the engine's stable address is `~/.claude/workkit`.
- **Idempotent.** Every heal checks before acting; running twice equals running once.
- **The spec is the SSOT.** Rules live in `docs/project-state.md`; skills and hooks execute them and point at it rather than restating them.
