# workkit — Architecture Overview

> **This file is the ENTRY, not the book.** Every detail has one home — `docs/<topic>.md` or the folder's own README — and this file points at it. Budget: ≤250 lines and no line over 400 bytes, enforced by `docs:board-guard`.

## Identity

workkit is the issue-pipeline workflow system packaged as a Claude Code plugin: it installs into any repo's sessions and brings that repo to one standard — GitHub Issues as the work-item SSOT, labels as the pipeline, a CHANGELOG entry per shipped item.

`docs/project-state.md` is the spec it implements: the ONE normative text, and the only home of the rules the parts below enforce. This file is the entry to the architecture that executes them; `README.md` tells the same story in human voice.

## Repo structure

```
<repo>/
├── .claude-plugin/       # plugin.json + marketplace.json (this repo is its own marketplace)
├── hooks/                # hooks.json + the hook groups, resolved via ${CLAUDE_PLUGIN_ROOT}
│   ├── loader.sh         # name → path router (docs:board-guard → docs/board-guard/run.sh)
│   ├── _lib.sh           # shared helpers (sourced, never executed)
│   ├── docs/             # board-guard, changelog-guard, change-tracker, session, session-guard, state-check
│   ├── safety/           # vendor-guard, commit-gate, commit-language, issue-guard, capture-guard, tree-guard
│   ├── manager/          # resolver, profile, spawn-guard, close-guard + ladder.json (the tier SSOT)
│   └── workflow/         # standards (the daily heal) + reload-guard
├── agents/               # the crew — surface as workkit:<name> (roster + contract: docs/agents.md)
├── skills/               # the nine workflow skills — surface as workkit:<name>
├── workflow/             # the agent-agnostic engine (labels.json, standards.sh, home.sh, publish.sh, changelog.js, templates)
├── tower/                # mission control: api/ (the JSON API + its libs) + app/ (the OMEGA dashboard)
├── jobs/                 # scheduled work — the 9am daily brief, its launchd plist, and install.sh
├── docs/                 # project-state.md (the spec) · agents.md (the crew contract) · hooks.md (the hook detail) · cloud.md (remote provisioning) · history-purge.md (the rewrite runbook)
├── tests/                # Node runner + hook/script/tower suites (npm test)
└── .workkit/             # settings.json is COMMITTED (this repo's own opt-in)
```

## Install

From zero: clone, then `./workflow/workkit.sh setup` — one pass, each step checked before it acts: the plugin, `gh`, the 9am schedule, the home repo and its clone at `~/.workkit/tower`, the publish question, the cloud brief's seeded runner and its two secrets, this repo's opt-in, the `~/.local/bin/workkit` symlink. Every mechanic: `workflow/README.md`.

The plugin alone is still two lines:

```sh
claude plugin marketplace add <path-to-checkout>
claude plugin install workkit@workkit
```

The engine's stable filesystem address is `~/.claude/workkit` → this repo's `workflow/`; the hooks resolve the engine from their own location instead, so they never wait on it. Mechanics: `workflow/README.md` § How it is reached.

## Hooks

Registered in `hooks/hooks.json`, every command routed through `hooks/loader.sh` so settings reference a hook by `prefix:name` rather than a path. A LOADER-level failure fails open (exit 0); the hook's own exit code passes through untouched, which blocking hooks (exit 2) need.

The index of all eighteen and what each one does: `docs/hooks.md`. Three carry a README beside the script as well: `tree-guard`, `session-guard`, `change-tracker`.

## Agents

Five, namespaced `workkit:<name>`: `scout` (recon), `worker` (implementation), `verifier` (blind review), `advisor` (frontier consult), `reviewer` (compliance lens). The first four are CAPABILITY CLASSES, their model supplied per spawn by the `manager/resolver` hook. Roster, classes, crew sizing, the file-handoff convention, the definition rules: `docs/agents.md`.

## Skills

Nine, namespaced `workkit:<name>`: `feature` · `interview` · `diagnose` · `review` · `triage` · `status` · `migrate` · `parallel` · `ship`. One `SKILL.md` each, which is that skill's own home — what it does, when it fires, and how it runs.

## The engine (`workflow/`)

Agent-agnostic: shell + Node, no Claude Code knowledge, which is why the hooks call it rather than contain it. `workkit.sh` is the one command and the from-zero entry point — `setup [--token]` · `update [--auto]` · `doctor` · `publish` · `brief [--local]` · `tower` · `enable` · `decline` · `heal` · `note`.

Beside it live the label SSOT, the heal, the CHANGELOG linter, the capture CLI, the templates a repo receives on enable, and the home repo's whole lifecycle. Every file and every step: `workflow/README.md`.

## The tower (`tower/`)

Mission control in two processes behind one command (`npm run tower`): the plain-Node JSON API on port 8693 (`tower/api/`, zero dependencies) and the OMEGA dashboard on 4300 that reads it cross-origin (`tower/app/`). Seven pages — Overview, Board, Crew, Usage, Brief, Health, Settings — over the board, the crew and its spend, the mornings, what is broken, and a published copy's token.

A view, never a second store, one focus per page (#177): Overview surveys and points, Brief shows the mornings themselves, Health shows only what is broken and sits last in the nav. The pages, the dependency graph, the telemetry, the two write paths, and the published copy that speaks GitHub from the browser: `tower/README.md`.

## The jobs (`jobs/`)

ONE job, at 9am, in five steps — the summaries, the runner reconcile, the brief, the publish, the stale-brief marker (#173) — and ONE script that runs them (#107): `morning.sh`, the entry point both schedulers invoke, this machine's launchd agent and the seeded `brief.yml` on a runner.

Each step is gated by what the environment it woke up in can do; the brief itself runs in the CLOUD, on the home repo, since that is where the sweep token and the roster live. Every step, both environments, the payloads, the two tokens and the handover: `jobs/README.md`.

## Tests

`npm test` runs `tests/run.js`, which discovers every `tests/**/*.test.js`. A suite whose precondition this machine cannot meet calls `skipSuite()` and the runner names the skip rather than hiding it. Suites live under `tests/hooks/`, `tests/scripts/`, `tests/tower/`, and `tests/jobs/`.

## Conventions

- **Portable by default.** Nothing under `hooks/`, `agents/`, or `skills/` may carry a machine-specific absolute path. Hook commands resolve through `${CLAUDE_PLUGIN_ROOT}`; the engine's stable address is `~/.claude/workkit`.
- **Generic by construction.** No owner names and no personal paths anywhere in the kit; `~/.workkit` and `.workkit/` are the only filesystem anchors.
- **One mechanism, branching by environment.** Never two parallel copies of the same job — one entry point, each step gated on what its environment can do.
- **Idempotent.** Every heal checks before acting; running twice equals running once.
- **The spec is the SSOT.** Rules live in `docs/project-state.md`; skills and hooks execute them and point at it rather than restating them.
- **One home per fact.** Every detail lands in its topic home — `docs/<topic>.md`, a folder's README, a `SKILL.md` — and is never restated where it is pointed at from.
