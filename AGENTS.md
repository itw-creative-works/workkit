# workkit — Architecture Overview

> **Deep references go in `docs/<topic>.md`, not here.** Keep this file under ~250 lines.

## Identity

workkit is the issue-pipeline workflow system packaged as a Claude Code plugin: the standards heal, the manager crew, the guard hooks, the workflow skills, and the agent-agnostic engine they all call. It installs into any repo's sessions and brings that repo to one standard — GitHub Issues as the work-item SSOT, labels as the pipeline, a CHANGELOG entry per shipped item.

`docs/project-state.md` is the spec it implements — the ONE normative text, and the only home of the rules the parts below enforce: the label vocabulary and the pipeline, capture and triage, issue anatomy, `.workkit/` and the participation tri-state, the global layer (`~/.workkit`, the roster, the home repo), queue semantics, CHANGELOG entries. This file describes the ARCHITECTURE that executes those rules and points at the spec's sections instead of restating them; the README tells the same story in human voice, with the road and the crew charts.

## Repo structure

```
<repo>/
├── .claude-plugin/       # plugin.json + marketplace.json (this repo is its own marketplace)
├── hooks/                # hooks.json + the hook groups, resolved via ${CLAUDE_PLUGIN_ROOT}
│   ├── loader.sh         # name → path router (docs:board-guard → docs/board-guard/run.sh)
│   ├── _lib.sh           # shared helpers (sourced, never executed)
│   ├── docs/             # board-guard, changelog-guard, change-tracker, session, state-check
│   ├── safety/           # vendor-guard, commit-gate, commit-language, issue-guard, inbox-guard
│   ├── manager/          # resolver, profile + ladder.json (the tier SSOT)
│   └── workflow/         # standards (the daily heal)
├── agents/               # the crew — surface as workkit:<name> (roster + contract: docs/agents.md)
├── skills/               # the nine workflow skills — surface as workkit:<name>
├── workflow/             # the agent-agnostic engine (labels.json, standards.sh, home.sh, publish.sh, changelog.js, templates)
├── tower/                # mission control: api/ (the JSON API + its libs) + app/ (the OMEGA dashboard)
├── jobs/                 # scheduled work — the 9am daily brief, its launchd plist, and install.sh
├── docs/                 # project-state.md (the spec) · agents.md (the crew contract)
├── tests/                # Node runner + hook/script/tower suites (npm test)
└── .workkit/             # settings.json is COMMITTED (this repo's own opt-in)
```

## Install

From zero: clone, then `./workflow/workkit.sh setup` — the plugin, `gh`, the 9am schedule, the home repo (`<login>/workkit`, cloned and seeded into `~/.workkit/tower`), this repo's opt-in, and the `~/.local/bin/workkit` symlink, each checked before it acts. The plugin alone is still two lines:

```sh
claude plugin marketplace add <path-to-checkout>
claude plugin install workkit@workkit
```

The engine's stable filesystem address, `~/.claude/workkit` → this repo's `workflow/`, needs no install step: a real heal points it at the folder it is running from, when that folder is a checkout whose origin names this repo — a probe or a fixture copy leaves the machine's address alone (`--engine-link` is the step on its own, for `workkit setup|update`). The hooks resolve the engine from their own location instead, so they never wait on it; skills and docs reference it by that path.

## Hooks

Registered in `hooks/hooks.json`, every command routed through `hooks/loader.sh` so settings reference a hook by `prefix:name` rather than a path. A LOADER-level failure fails open (exit 0); the hook's own exit code passes through untouched, which blocking hooks (exit 2) need.

| Hook | Event | What it does |
|---|---|---|
| `workflow/standards` | SessionStart | Runs the engine's heal in a participating repo, once per repo per day (what the heal writes: `workflow/README.md`; the standard it heals to: the spec § Enforcement), and adds the one check that is the hook layer's own — every wired hook resolves, is executable, parses, and the tools they call are present. Reports only what it fixed; an undecided repo hears one offer and is never written to. The same daily run calls `workkit update --auto`, the machine-side upkeep — it updates a schedule a human already installed and installs nothing fresh |
| `docs/state-check` | SessionStart | Announces open `status:inbox` issues, a non-empty `.workkit/inbox.md`, broken pointer files, an oversized AGENTS.md |
| `docs/session` | SessionStart | Injects a participating repo's `.workkit/session.md` on every source — the task queue a compacted or restarted session reads first — and warns when it has grown past the light bar. Silent for a header-only or absent file |
| `workflow/reload-guard` | SessionStart + UserPromptSubmit | Stamps the load-time surfaces (`hooks.json` content, the `agents/` and `skills/` file list and mtimes) at session start and injects one line when they change — hook-script, skill-body, and engine edits are already live, so only these need `/reload-plugins`. Each change nags once |
| `manager/resolver` | PreToolUse (Task/Agent) | Supplies each crew spawn's model from `manager/ladder.json` and the live session model |
| `manager/spawn-guard` | PreToolUse (Task/Agent) | Warns — never blocks — when a crew spawn carries a hand-passed `model` param, or when a frontier session spawns the advisor |
| `manager/profile` | UserPromptSubmit | Injects the manager standing instruction — delegate to the crew — in frontier/workhorse sessions only |
| `safety/vendor-guard` | PreToolUse (Edit/Write) | Blocks edits to generated, vendored, and gitignored files (`_attic/`, `.workkit/`, `.env*` excepted) |
| `safety/commit-gate` | PreToolUse (Bash) | Blocks `git commit` unless tests pass, new source files come with test files, code carries a fresh review marker, any added CHANGELOG entry matches the format, and a commit closing an issue (`Fixes #N`) stages the entry it closes against |
| `safety/commit-language` | PreToolUse (Bash) | Bounces commit messages using kill/destroy/dead wording, suggesting the neutral terms, and subject lines that are not Conventional Commits or carry a version number outside `chore(release)` |
| `safety/issue-guard` | PreToolUse (Bash) | Blocks a `gh issue create/comment/edit`, a `gh pr create/comment/edit/merge/close`, or a `gh api graphql` carrying a discussion or issue mutation, whose outbound text carries a local `.env` value or a token-shaped string — every repo is assumed public (the spec § Issue anatomy). Names the key or the kind, never the match |
| `safety/inbox-guard` | PreToolUse (Read/Grep/Bash) | Blocks a read of `.workkit/inbox.md`'s contents outside a triage run — the owner's scratchpad, opened by the marker the `workkit:triage` skill records and stale after 30 minutes. Counting and appending stay open |
| `docs/board-guard` | PostToolUse (Edit/Write) | Bounces `CLAUDE.md` / `AGENTS.md` writes that break the spec's document rules |
| `docs/changelog-guard` | PostToolUse (Edit/Write) | Bounces a CHANGELOG entry that is an essay instead of one short linked paragraph — only entries the write ADDED |
| `docs/change-tracker` | Stop | Nags about uncommitted work, keeping the issue true, promoting findings out of `.workkit/`, and unfiled inbox notes |
| `manager/close-guard` | Stop | Warns — never continues the turn — when a frontier session did the bulk editing itself, or when worker output ended the turn with no verifier pass |

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

Agent-agnostic: shell + Node, no Claude Code knowledge. `workkit.sh` is the one command (`setup` · `update [--auto]` · `doctor` · `publish` · `enable` · `decline` · `note`) and the from-zero entry point, `labels.json` is the label SSOT, `standards.sh` the idempotent heal (plus `--enable` / `--decline` / `--state`, and the roster registration that keeps `~/.workkit/.repos.json` current), `changelog.js` the entry-format linter both guarding hooks call, `changelog-links.js` the release-time backfill of commit links and contributor handles, `wk.sh` the capture CLI (`wk.sh note "…"` appends to the nearest participating inbox, or files a `status:inbox` issue on the home repo outside every project), `templates/` what a repo receives on enable. Details: `workflow/README.md`.

**The home repo** is the engine's other half, in three sourced libraries plus a script (`lib.sh`, `home.sh`, `discussions.sh`, `publish.sh`). `~/.workkit` is a PLAIN folder — three files split by who writes them (hand-edited `settings.json`, machine-maintained `.repos.json`, disposable `.cache.json`) plus `jobs/`, nothing versioned — and the one git repo in it is `~/.workkit/tower`, the clone of a private `<login>/workkit`, seeded from this repo's `tower/app` so the home repo IS the tower project. The clone is ENGINE TERRITORY: it carries no `.workkit/` and no config of its own, the site options (`site.repo`/`site.publish`/`site.url`) live in the hand-edited machine settings file, `site.publish` deciding all-or-nothing whether the site publishes at all, and the captures that belong to no project are filed straight onto its issues. Only `setup` creates, clones, seeds or enables anything, and nothing is ever converted or adopted — anything already at the clone's path stops the home steps. Summaries publish as Discussions there; the site is built from the clone and pushed to `gh-pages`, so nothing generated is committed as source. Three shapes proved against the live tools: no mutation CREATES a discussion category (setup points at the page, delivery falls back to the default), Pages accepts only `/` or `/docs` as a source path (so the site is the ROOT of its own branch), and `omega build` resolves only inside `apps/web` (at the brand root the `omega` bin is the manager's, which has no build).

## The tower (`tower/`)

Mission control, in two processes. `tower/api/` is a plain-Node JSON API with zero dependencies (`npm run tower`, port 8693); `tower/app/` is the dashboard, an OMEGA app on port 4300 that reads it cross-origin. Six pages — Overview, Board, Crew, Usage, Health, Brief — over the cross-repo issue board, the live Claude crew and its token spend, per-repo health, and the daily brief, with an intake dialog on the topbar of every one. A view, never a second store: it reads the issues of the repos on this machine's roster (`repos` in `~/.workkit/.repos.json`, maintained by the heal) plus the home clone, which no roster lists and discovery adds by path, via one GraphQL sweep, the keep-awake markers, the session transcripts, and git; its two write paths are `gh issue create` behind the intake dialog and `gh issue edit` behind the Board's drag. The API is useful alone: `/api/brief` exists so the 9am job and the page share one payload. The framework owns the chrome, which is why the app consumes `@omega.js/*` by `file:` spec rather than vendoring a stylesheet — and why the PUBLISHED copy (this same app, seeded into the home repo by setup, built there by `workflow/publish.sh` and pushed to its `gh-pages` branch for Pages to serve, with a board snapshot baked in only when `site.board` says so — Pages is public even on a private repo) is built locally and never by CI. Reference: `tower/README.md`.

## The jobs (`jobs/`)

Scheduled work this machine runs. ONE job, at 9am, in two steps. The summaries step goes first: generated records are never files, so `claude-nightly.sh` composes the day (`nightly-payload.js`, or its `--cadence weekly|monthly` rollup over the summaries read back from the API) and PUBLISHES it as a Discussion on the home repo, logging its reason and exiting 0 wherever it cannot. Then the brief: `brief-payload.js` composes the tower's `/api/brief` WITHOUT the tower — the same roster, board, health and `buildBrief` under `tower/api/lib/` — and prints the digest instruction plus that payload, with `cc-news.js` appending the upstream Claude Code CHANGELOG entries that touch the harness since the last brief; `claude-daily.sh` is the entry point that runs both, sends the brief headless (haiku, no tools, a hard budget), logs the exchange, and puts the response's first line in a desktop notification — a summaries failure is logged and the brief still goes. Last, after the brief has gone, `workflow/publish.sh --quiet` rebuilds the tower project in `~/.workkit/tower` and pushes the site to the home repo's `gh-pages` branch — a failure is logged and the morning is untouched. `install.sh` renders the one plist for this checkout and loads it, only when something changed. Reference: `jobs/README.md`.

## Tests

`npm test` runs `tests/run.js`, which discovers every `tests/**/*.test.js`. A suite whose precondition this machine cannot meet calls `skipSuite()` and the runner names the skip rather than hiding it. Suites live under `tests/hooks/`, `tests/scripts/`, `tests/tower/`, and `tests/jobs/`.

## Conventions

- **Portable by default.** Nothing under `hooks/`, `agents/`, or `skills/` may carry a machine-specific absolute path. Hook commands resolve through `${CLAUDE_PLUGIN_ROOT}`; the engine's stable address is `~/.claude/workkit`.
- **Idempotent.** Every heal checks before acting; running twice equals running once.
- **The spec is the SSOT.** Rules live in `docs/project-state.md`; skills and hooks execute them and point at it rather than restating them.
