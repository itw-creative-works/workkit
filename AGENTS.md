# workkit: Architecture Overview

> **This file is the ENTRY, not the book.** Every detail has one home (`docs/<topic>.md` or the folder's own README) and this file points at it. Budget: ≤250 lines and no line over 400 bytes, enforced by `docs:board-guard`.

## Identity

workkit is the issue-pipeline workflow system packaged as a Claude Code plugin: it installs into any repo's sessions and brings that repo to one standard: GitHub Issues as the work-item SSOT, labels as the pipeline, a CHANGELOG entry per shipped item.

`docs/project-state.md` is the spec it implements: the ONE normative text, and the only home of the rules the parts below enforce. This file is the entry to the architecture that executes them; `README.md` tells the same story in human voice.

## Repo structure

```
<repo>/
├── .claude-plugin/       # plugin.json + marketplace.json (this repo is its own marketplace)
├── .github/workflows/    # checks.yml (the suite, every pull request and every push to main but a release-only one) · changelog.yml (the reusable entry check) · pages.yml (the central dashboard, on a release)
├── hooks/                # hooks.json (its `modules` list) + the hooks module + the shell library the scripts source, resolved via ${CLAUDE_PLUGIN_ROOT}
│   ├── register.js       # the hooks module: the twenty-nine in-process hooks, the one file that touches `$`
│   ├── mods/             # each hook's logic and the reads they share, plain functions over plain data
│   ├── _lib.sh           # the shell library's entry (sourced by scripts/, prove.sh and the snapshot entry, never a hook)
│   ├── lib/              # _lib.sh's helper groups, one file per concern: markers, paths, tree, snapshot
│   └── manager/          # resources/ladder.json (the tier SSOT)
├── agents/               # the crew: surface as workkit:<name> (roster + contract: docs/agents.md)
├── briefs/               # the role brief templates, one per crew job, the manager fills the slots: docs/agents.md § File-handoff convention
├── skills/               # the nine workflow skills: surface as workkit:<name>
├── workflow/             # the agent-agnostic engine (labels.json, standards.sh + standards/, workkit.sh + workkit/, home.sh + home/, publish.sh + publish/ (build.sh, site-repos.js), lib.sh + lib/, changelog/, ship/, test/ (the test runner), templates)
├── tower/                # mission control: api/ (the JSON API + its libs) + app/ (the OMEGA dashboard)
├── jobs/                 # scheduled work: the 9am daily brief, its launchd plist, and install.sh
├── scripts/              # four scripts, the only platform-touching commands the skills and agents have: the two markers the skills call (review, triage), red-proof.sh (the verifier's red run), review-covers.sh (the ship's review tier)
├── docs/                 # project-state.md (the spec) · agents.md (the crew contract) · hooks.md (the hook detail) · tests.md (the test bar and runner) · setup.md (the install walkthrough) · cloud.md (remote provisioning) · history-purge.md (the rewrite runbook)
│   └── assets/           # the README's hero and its mark in two inks, rendered by the showcase repo (ITW-Creative-Works/showcase, private)
├── test/                 # run.js (hands off to the kit's runner, workflow/test/run.js) + the hook/script/tower suites (npm test)
└── .workkit/             # settings.json is COMMITTED (this repo's own opt-in)
```

## Install

From zero: clone, then `./workflow/workkit.sh setup`. One pass, each step checked before it acts. The steps in order, the plugin-only install, the home repo, opting a repo in and the layout: `docs/setup.md`. Every mechanic: `workflow/README.md`.

A SHIP re-runs it: when the shipped diff touched the setup surface, the ship runs `workkit setup` itself once the work commit's CI is green, so the install follows the kit rather than waiting on the owner. The paths and the clause: `skills/ship/SKILL.md` Step 7.

The engine's stable filesystem address is `~/.claude/workkit` → this repo's `workflow/`; the hooks resolve the engine from their own location instead, so they never wait on it. Mechanics: `workflow/README.md` § How it is reached.

## Hooks

All twenty-nine run in process, in the hooks module the `modules` list of `hooks/hooks.json` names (`hooks/register.js`, each hook's logic in `hooks/mods/`), loaded once per session. Settings and the hooks log name a hook by `prefix:name`.

A repo that has not opted in gets none of the hooks: the module's gate stands every one down there but the setup reminder, the restart notice and the secrets guard (`docs/hooks.md` § Where every hook stands down).

The index of all twenty-nine and what each one does: `docs/hooks.md` § The hooks module.

## Agents

Five, namespaced `workkit:<name>`: `scout` (recon), `worker` (implementation), `verifier` (blind review), `advisor` (frontier consult), `reviewer` (compliance lens). The first four are CAPABILITY CLASSES, their model supplied per spawn by the `manager/resolver` hook. Roster, classes, crew sizing, the file-handoff convention and its `briefs/` role templates, the definition rules: `docs/agents.md`.

## Skills

Nine, namespaced `workkit:<name>`: `feature` · `interview` · `diagnose` · `review` · `triage` · `status` · `checkpoint` · `migrate` · `ship`. One `SKILL.md` each, which is that skill's own home: what it does, when it fires, and how it runs.

## The engine (`workflow/`)

Agent-agnostic: shell + Node, which is why the hooks call it rather than contain it. It calls the `claude` CLI in two places only: the setup commands in `workflow/workkit/` (the plugin's install and list, and `claude setup-token`) and the test runner's mod half (`claude plugin test`, run only when `test/mods/*.test.ts` exist).

`workkit.sh` is the one command and the from-zero entry point: `setup [--token | --login | --home]` · `update [--auto]` · `doctor` · `publish` · `brief [--local]` · `log [-n N] [--follow]` · `tower` · `enable` · `decline` · `heal` · `note` · `test [paths]` · `prove`.

Beside it live the label SSOT, the heal, the CHANGELOG linter in `changelog/`, the capture CLI, the ship's four helpers in `ship/` (`publish-plan.js`, `release.js`, `ship-items.sh`, `ci-watch.sh`), the templates a repo receives on enable, the bot identity in `identity/` (`workflow/README.md` § The bot identity), and the home repo's whole lifecycle. Every file and every step: `workflow/README.md`.

## The tower (`tower/`)

Mission control in two processes behind one command (`npm run tower`): the plain-Node JSON API on port 8693 (`tower/api/`, zero dependencies) and the OMEGA dashboard on 4300 that reads it cross-origin (`tower/app/`). Seven pages (Overview, Board, Crew, Usage, Brief, Health, Settings) over the board, the crew and its spend, the mornings, what is broken, and a published copy's token.

A view, never a second store, one focus per page: Overview surveys and points, Brief shows the mornings themselves, Health shows only what is broken and sits last in the nav. The pages, the dependency graph, the telemetry, the two write paths, and the published copy that speaks GitHub from the browser: `tower/README.md`.

## The jobs (`jobs/`)

ONE job, at 9am, in six steps (the summaries, the runner reconcile, the brief, the publish, the stale-brief marker, the owner's `morning.d` scripts) and ONE script that runs them: `morning.sh`, the entry point both schedulers invoke, this machine's launchd agent and the seeded `brief.yml` on a runner.

Each step is gated by what the environment it woke up in can do; the brief itself runs in the CLOUD, on the home repo, since that is where the sweep token and the roster live. Every step, both environments, the payloads, the two tokens and the handover: `jobs/README.md`.

## Tests

What a test must be worth and may cost (the bar), and the shape every repo's runner keeps: `docs/tests.md`.

`npm test` runs `test/run.js`, which hands off to the runner the kit ships, `workflow/test/run.js` (its library in `workflow/test/lib/`; `workkit test` hands its arguments to this `npm test`); `test/lib/harness.js` is a one-line re-export of its entry, which carries the whole library, and `test/lib/serial.js` is this repo's serial list.

A suite whose precondition this machine cannot meet calls `skipSuite()`, and the runner names the skip. Suites live under `test/hooks/`, `test/scripts/`, `test/tower/`, `test/jobs/`, `test/docs/` and `test/mods/`, plus the library's own suites at the `test/` root (`runner`, `node-test`, `harness`, `log`, `spawn`).

A suite keeps to its own temp folder through `mkTmp` and touches no fixed shared path; one that must is added to `SERIAL`, with the path named in a one-line comment beside its entry.

Then the mod half: `claude plugin test` on the kit root runs the hooks module's wiring suites, `test/mods/*.test.ts`, inside the engine, and the runner adds its counts beside the Node suites'. With no `claude` on PATH it is a named skip and the Node half still runs. A named `test/mods/<name>.test.ts` after `--` runs the whole mod half, since `claude plugin test` takes a folder.

Every suite ends with `if (require.main === module) selfRun(<its export>);`. One suite runs alone as `npm test -- test/<path>.test.js` (the runner takes suite paths after `--`, and exits 1 naming a path that matches no suite), and still as `node test/<path>.test.js` through `selfRun`; `test/runner.test.js` fails naming a suite without the line.

Every suite runs on macOS and on Windows under Git Bash, or skips whole by name on the platform it cannot answer. Everything that differs (the shell a case spawns, a PATH it controls, the POSIX spelling a shell script sees, how a tool reaches a stub PATH) lives in `test/lib/platform.js`, every export the identity on macOS and Linux.

A world a case spawns comes from the same seam:

- `homeEnv()` is the scratch home in every spelling a tool reads one by (HOME, USERPROFILE, `GH_CONFIG_DIR`, no ambient token, Node's compile cache off), so no child of a test reads the developer's own home or reaches GitHub as them;
- `stubTool()` is the one writer of a PATH stub, which a shell starts on either platform and Node starts on neither;
- `test/lib/mods-inputs.js` is the one builder of the arguments the logic suites hand the `hooks/mods/` functions (`mods(name)`, `textOf`, `stateFacts`, `reminderFacts`, `standardsState`, `runResult`, `sessionFacts`, `briefMarker`, `daysBefore`, `row` (`row.user`, `row.result`, `row.tool`), `MODELS`, `REMINDER_ROOT`), so every suite spells a shape the same way;
- `test/lib/mod-fixtures.mjs` is the one home of the fixtures both halves share (`MODELS`, `SESSION_NOW`, `daysBefore`, `briefMarker`, `row`), which `mod-world.ts` re-exports whole and `mods-inputs.js` all but `SESSION_NOW`;
- and `test/lib/mod-world.ts` is the one world beneath the hooks module for the `test/mods/*.test.ts` wiring suites (`mkWorld(on)`: files, git, gh, the engine scripts, the store and the session, answered from memory).

A scratch folder has one writer as well: `mkTmp(prefix)` in the kit's `scratch.js`, reached through `test/lib/harness.js`; it resolves the path and removes every folder it made when the process exits. The kit's version stamp has one reader as well: `test/lib/version-stamp.js` holds `STAMP`, `readStamp(file)` and `kitVersion()`, so no suite spells the stamp file or its first-line read itself.

A world built the same way for every case has one home too: `seeded(build)` in the kit's `seed.js`, reached through `test/lib/harness.js`, builds it once per process for each shape on first use, removes it at exit, and returns a copier that `fs.cpSync`s that shape's seed into the case's own folder, so no case is handed the seed.

A case only one platform can answer names its skip through the harness's `skip()`. On a Windows machine `workkit setup` builds the kit's script shell (`workflow/script-shell.cs`) and points npm at it, so a root `npm test` there records its tree.

The Windows lane runs in CI: `checks.yml` runs the suite on Linux and Windows for every pull request and every push to `main`, except a push that changes only `CHANGELOG.md` and `.claude-plugin/plugin.json`; a tag push runs nothing.

Lanes per layer (`docs/project-state.md` § The proof):
- Unit: a module called directly.
- Integration: a script run whole with a stubbed `gh`.
- End to end: no lane here (a live session is the only surface), so a park names that layer as skipped.

A missing `Proof:` line is a hard gate: `safety:proof-guard` holds the flip to complete and the close, and `safety:commit-gate` check 6 holds the `Fixes #N` trailer.

## Conventions

- **Portable by default.** macOS, Windows (Git Bash) and Linux all run the kit; a spelling that differs branches once, in `workflow/lib/platform.sh` and `hooks/_lib.sh` (`docs/hooks.md` § Platforms). The hooks module resolves the kit through `$.plugin.root`; the engine's stable address is `~/.claude/workkit`.
  - No shipped text (skills, agents, briefs, docs, the hook, workflow, jobs and tower READMEs) may carry a machine-specific absolute path or name the owner's own repo.
- **Generic by construction.** No owner names and no personal paths anywhere in the kit; `~/.workkit` and `.workkit/` are the only filesystem anchors.
- **One mechanism, branching by environment.** Never two parallel copies of the same job: one entry point, each step gated on what its environment can do.
- **Idempotent.** Every heal checks before acting; running twice equals running once.
- **Setup is the agent's to run.** Whenever a hook or a message says setup is needed, the agent runs `workkit setup` itself.
  - Three choices setup asks only at a terminal (joining the repo, publishing the dashboard, creating the home repo) the agent asks the owner in chat. It applies all three itself: `workkit enable`, `site.publish` in `~/.workkit/settings.json`, and the home repo with `workkit setup --home`.
  - A step only a human can finish prints the one human action for the agent to relay (approving the sign-in code in the browser, clicking the App's install on GitHub, running `claude setup-token`).
  - The sign-in waits in the foreground until the code is approved, so the agent runs `workkit setup --login` in the background and reads its output for the page and the code while it waits.
- **Comments are reminders and directions.** One to four lines saying the one thing the code cannot; a file header is one short paragraph. No issue numbers, dates or history in a comment: the why lives on the issue and in the commit. The owner's `code/lint` hook bounces a longer written run or history.
- **No em dashes, no exceptions.** Prose, comments, printed strings, tests and `CHANGELOG.md` use a colon, a comma, parentheses, a spaced hyphen or a new sentence. The CHANGELOG entry separator is a spaced hyphen.
- **The spec is the SSOT.** Rules live in `docs/project-state.md`; skills and hooks execute them and point at it rather than restating them.
- **One home per fact.** Every detail lands in its topic home (`docs/<topic>.md`, a folder's README, a `SKILL.md`) and is never restated where it is pointed at from.
