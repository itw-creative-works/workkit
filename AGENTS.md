# workkit: Architecture Overview

> **This file is the ENTRY, not the book.** Every detail has one home (`docs/<topic>.md` or the folder's own README) and this file points at it. Budget: ≤250 lines and no line over 400 bytes, enforced by `docs:board-guard`.

## Identity

- workkit is the issue-pipeline workflow system packaged as a Claude Code plugin.
  - It installs into any repo's sessions and brings that repo to one standard.
  - The standard: GitHub Issues as the work-item SSOT, labels as the pipeline, a CHANGELOG entry per shipped item.
- `docs/project-state.md` is the spec it implements: the ONE normative text.
  - It is the only home of the rules the parts below enforce.
- This file is the entry to the architecture that executes them.
- `README.md` tells the same story in human voice.

## Repo structure

```
<repo>/
├── .claude-plugin/       # plugin.json + marketplace.json (this repo is its own marketplace)
├── .github/workflows/    # checks.yml (the suite on every pull request and push to main but a release-only one; the release job on a push) · ci.yml, release.yml (the reusable CI and release job every kit-owned checks.yml calls) · changelog.yml (the reusable entry check) · pages.yml (the central dashboard, on a release)
├── .github/scripts/      # release-push.sh (checks.yml's scope job and ci.yml's Scope step: whether a push is a release stamp only) · ci-node-version.sh, ci-setup.sh, ci-test.sh (ci.yml's steps: the Node version, a repo's hooks.ciSetup, the suite) · ci-release.js (release.yml's step: the releases, then the dispatch)
├── hooks/                # hooks.json (its `modules` list) + the hooks module + the shell library the scripts source, resolved via ${CLAUDE_PLUGIN_ROOT}
│   ├── register.js       # the hooks module: the twenty-two in-process hooks (nine guards run in the `gh` and `git` shims and git's hooks), the one file that touches `$`
│   ├── mods/             # each hook's logic and the reads they share, plain functions over plain data (facts.js: the Bash guards' facts; changed.js: a call's changed files; slug.js)
│   ├── _lib.sh           # the shell library's entry (sourced by workflow/{review,triage,proof}/, prove.sh, the snapshot entry and .github/scripts/release-push.sh, never a hook)
│   ├── lib/              # _lib.sh's helper groups, one file per concern: markers, paths, tree, snapshot
│   └── manager/          # resources/ladder.json (the rungs and the classes; the tiers' defaults are defaults/settings.json's)
├── agents/               # the crew: surface as workkit:<name> (roster + contract: docs/agents.md)
├── briefs/               # the role brief templates, one per crew job, the manager fills the slots: docs/agents.md § File-handoff convention
├── skills/               # the nine workflow skills: surface as workkit:<name>
├── workflow/             # the agent-agnostic engine (labels.json, standards.sh + standards/, workkit.sh + workkit/, home.sh + home/, publish.sh + publish/ (build.sh, site-repos.js), lib.sh + lib/, changelog/, ship/, review/, triage/, proof/, public/, gitshim/ (the `git` shim), templates)
├── defaults/             # settings.json: every setting with its default, the layer under ~/.workkit/settings.json and each repo's .workkit/settings.json (docs/project-state.md § The model)
├── packages/core/        # workkit-core, the npm package of the test runner and its library (`workkit test`, `workkit-core/test`) plus the kit's `workflow/lib/run.js` packed as `workkit-core/run`, a workspace member at the kit's version
├── tower/                # mission control: api/ (the JSON API + its libs) + app/ (the OMEGA dashboard)
├── jobs/                 # scheduled work: the 9am daily brief, its launchd plist, and install.sh
├── docs/                 # project-state.md (the spec) · agents.md (the crew contract) · hooks.md (the hook detail) · tests.md (the test bar and runner) · setup.md (the install walkthrough) · cloud.md (remote provisioning) · history-purge.md (the rewrite runbook)
│   └── assets/           # the README's hero and its mark in two inks, rendered by the showcase repo (ITW-Creative-Works/showcase, private)
├── test/                 # the hook/script/tower suites (npm test, which is `workkit test`, workkit-core's runner)
└── .workkit/             # settings.json is COMMITTED (this repo's own opt-in)
```

## Install

- From zero: clone, then `./workflow/workkit.sh setup`.
  - One pass, each step checked before it acts.
  - The steps in order, the plugin-only install, the home repo, opting a repo in and the layout: `docs/setup.md`.
  - Every mechanic: `workflow/README.md`.
- A SHIP re-runs it: when the shipped diff touched the setup surface, the ship runs `workkit setup` itself.
  - It runs once the work commit's CI is green.
  - So the install follows the kit rather than waiting on the owner.
  - The paths and the clause: `skills/ship/SKILL.md` Step 7.
- The engine's stable filesystem address is `~/.claude/workkit` → this repo's `workflow/`.
  - The hooks resolve the engine from their own location instead, so they never wait on it.
  - Mechanics: `workflow/README.md` § How it is reached.

## Hooks

- Twenty-two of the thirty-one run in process, in the hooks module the `modules` list of `hooks/hooks.json` names.
  - The module is `hooks/register.js`, each hook's logic in `hooks/mods/`, loaded once per session.
- Nine guards run in the `gh` shim, the `git` shim and git's hooks, below.
- Settings and the hooks log name a hook by `prefix:name`.
- A repo that has not opted in gets none of the hooks.
  - Opting in is its own `.workkit/settings.json` saying `"enabled": true`; nothing else counts.
  - The module's gate stands every one down there but the setup reminder and the restart notice (`docs/hooks.md` § Where every hook stands down).
  - The chain after a Bash call runs when the repo it began or ended in opted in, or when it left a gh journal line from one that did.
- The commit guards judge in git's own `pre-commit` and `commit-msg` hooks, the `gh` guards in the `gh` shim, and `safety:tree-guard` in the `git` shim.
  - All three judge the real tree, message and argv.
  - All three sit under one gate, `wk_session_judges` (`workflow/README.md`, the `lib/participation.sh` row).
  - The `git` shim (`workflow/gitshim/git`) is on a session's PATH alone, put first there at session start.
  - The `gh` shim's secrets scan runs on every `gh` call.
- No guard reads a command's text. `safety:capture-guard` gets one yes or no: whether the command names `.workkit/capture.md`.
  - `safety:script-write` runs after a Bash call: the five write checks on each file the call changed on disk, as notices.
- The index of all thirty-one and what each one does: `docs/hooks.md` § The hooks module.

## Agents

- Five, namespaced `workkit:<name>`: `scout` (recon), `worker` (implementation), `verifier` (blind review), `advisor` (frontier consult), `reviewer` (compliance lens).
- The first four are CAPABILITY CLASSES, their model supplied per spawn by the `manager/resolver` hook.
- Roster, classes, crew sizing, the file-handoff convention and its `briefs/` role templates, the definition rules: `docs/agents.md`.

## Skills

- Nine, namespaced `workkit:<name>`: `feature` · `interview` · `diagnose` · `review` · `triage` · `status` · `checkpoint` · `migrate` · `ship`.
- One `SKILL.md` each, which is that skill's own home: what it does, when it fires, and how it runs.

## The engine (`workflow/`)

- Agent-agnostic: shell + Node, which is why the hooks call it rather than contain it.
- It calls the `claude` CLI in one place only: the setup commands in `workflow/workkit/`.
  - Those are the plugin's install and list, and `claude setup-token`.
  - The test runner's mod half (`claude plugin test`) lives in `workkit-core`.
- `workkit.sh` is the one command and the from-zero entry point:
  - `setup [--token | --login | --bot | --home | --cloud]` · `update [--auto]` · `doctor` · `publish` · `brief [--local]` · `log [-n N] [--follow]` · `tower` · `enable` · `decline` · `heal` · `note` · `state` · `test [paths]` · `tools` · `convert [paths...]` · `prove` · `supervise -- <command>` · `watch [--end] [suite|run|<pid>]`;
  - the verbs with subcommands, each running `workflow/<verb>/<sub>.sh` or `.js`: `public intake|mirror|close` · `ship items|release|watch|cut|plan|publish|deploy` · `review covers|mark` · `triage mark` · `proof red` · `changelog lint`.
- Beside it live:
  - the label SSOT, the heal, the CHANGELOG linter in `changelog/`, the capture CLI;
  - the ship's steps in `ship/`: `items.sh`, `release.js`, `watch.sh`, `cut.js`, `plan.js`, `publish.js`, `deploy.js`, and `hooks.js`;
    - `hooks.js` holds the hooks a repo declares for the release, the publish and the deploy, which those steps run;
  - the review and triage markers and the review tier in `review/` and `triage/`, the verifier's red run in `proof/`;
  - the templates a repo receives on enable, the bot identity in `identity/` (`workflow/README.md` § The bot identity), and the home repo's whole lifecycle.
- Every file and every step: `workflow/README.md`.

## The tower (`tower/`)

- Mission control in two processes behind one command (`npm run tower`):
  - the plain-Node JSON API on port 8693 (`tower/api/`, zero dependencies);
  - the OMEGA dashboard on 4300 that reads it cross-origin (`tower/app/`).
- Seven pages (Overview, Board, Crew, Usage, Brief, Health, Settings).
  - They cover the board, the crew and its spend, the mornings, what is broken, and a published copy's token.
- A view, never a second store, one focus per page.
  - Overview surveys and points, Brief shows the mornings themselves.
  - Health shows only what is broken and sits last in the nav.
- The pages, the dependency graph, the telemetry, the two write paths, and the published copy that speaks GitHub from the browser: `tower/README.md`.

## The jobs (`jobs/`)

- ONE job, at 9am, in six steps:
  - the summaries, the runner reconcile, the brief, the publish, the stale-brief marker, the owner's `morning.d` scripts.
- ONE script runs them: `morning.sh`, the entry point both schedulers invoke.
  - The schedulers: this machine's launchd agent and the seeded `brief.yml` on a runner.
- Each step is gated by what the environment it woke up in can do.
- The brief itself runs in the CLOUD, on the home repo, since that is where the sweep token and the roster live.
- Every step, both environments, the payloads, the two tokens and the handover: `jobs/README.md`.

## Tests

- What a test must be worth and may cost (the bar), and the shape every repo's runner keeps: `docs/tests.md`.
- `npm test` is `workkit test`, the bin of the runner the kit ships as the npm package `workkit-core`.
  - The package is `packages/core/`, its library in `test/lib/` there.
  - The global `workkit test` hands its arguments to this `npm test`.
- `test/lib/harness.js` is a one-line re-export of `workkit-core/test`, which carries the whole library.
- `test/lib/serial.js` is this repo's serial list, its entries paths from the repo root.
- Every suite is Node's own shape, `describe`, `test` and `expect` from `test/lib/harness.js` (`docs/tests.md` § The shape).
- A suite or case this machine cannot answer states a `skip` value, `false` or the reason; the runner names the skip.
  - Each helper returns one: `needs()` for a command (outside a cloud session a missing one throws, failing the file), and `skipWithoutNpm`, `skipWithoutWrapper`, `skipOnWindows`, `skipOnJobPathNode`, `skipOnUsrLocalBin`, `skipWithoutNodeStub`, `skipWithoutFileLink` in `test/lib/`.
- The runner finds a suite by its name (`*.test.js`, `*.test.mjs`, `*.test.cjs`) anywhere under the repo root, never in `node_modules`, a `.` or `_` name, a nested package or a file git ignores (`docs/tests.md` § The kit's runner).
- This repo's suites live under `test/hooks/`, `test/scripts/`, `test/tower/`, `test/jobs/`, `test/docs/` and `test/mods/`.
  - The library's own suites sit at the `test/` root (`runner`, `harness`, `expect`, `log`, `spawn`, `convert`, `lexer`).
- A suite keeps to its own temp folder through `mkTmp` and touches no fixed shared path.
  - One that must is added to `SERIAL`, with the path named in a one-line comment beside its entry.
- Then the mod half: `claude plugin test` on the kit root runs the hooks module's wiring suites, `test/mods/*.test.ts`, inside the engine.
  - The runner adds its counts beside the Node suites'.
  - With no `claude` on PATH it is a named skip and the Node half still runs.
  - A named `test/mods/<name>.test.ts` after `--` runs the whole mod half, since `claude plugin test` takes a folder.
- One suite runs alone as `npm test -- test/<path>.test.js`, or as `node test/<path>.test.js` with no line added.
  - The runner takes suite paths after `--`, and exits 1 naming a path that matches no suite.
  - A case that starts a suite file with `node` passes `aloneEnv()` (`test/lib/alone-env.js`), its env without `NODE_TEST_CONTEXT`.
  - `test/lib/run-lists.js` reads a run's end (`TOTALS_LINE`, `linesOf`, `listsOf`), and `caught(fn)` (`test/lib/caught.js`) what a call threw or rejected with, or `null`.
- Every suite runs on macOS and on Windows under Git Bash, or skips whole by name on the platform it cannot answer.
- Everything that differs lives in `test/lib/platform.js`, every export the identity on macOS and Linux.
  - What differs: the shell a case spawns, a PATH it controls, the POSIX spelling a shell script sees, how a tool reaches a stub PATH.
- A world a case spawns comes from the same seam:
  - `homeEnv()` is the scratch home in every spelling a tool reads one by.
    - The spellings: HOME, USERPROFILE, `GH_CONFIG_DIR`, no ambient token, Node's compile cache off.
    - So no child of a test reads the developer's own home or reaches GitHub as them.
  - A child a case starts goes through `workflow/lib/run.js` too.
    - `test/lib/platform.js` re-exports its `spawnSync`, `spawn` and `execFileSync`.
    - `spawnBash()`, the one way a case starts the test bash, launches through it.
    - A test file still importing `child_process` sits on `test/scripts/run-home.test.js`'s list, which only shrinks.
  - `samePath(a, b, platform)` is the one compare of two spellings of a path.
    - On `win32` a Git Bash `/d/x` reads as `D:/x`, `\` folds to `/` and case is ignored.
    - Elsewhere the strings compare as they are.
  - `stubTool()` is the one writer of a PATH stub, which a shell starts by its bare name on either platform.
    - Its `<name>.exe` launcher (`test/lib/stub-launcher.cs`, built once per machine) makes the stub startable from Node on Windows where the C# compiler exists.
    - A case resting on a stub written before it skips on Windows through `skipWithoutNodeStub()` (`NO_NODE_STUB`) until it is run there once.
  - `test/lib/mods-inputs.js` is the one builder of the arguments the logic suites hand the `hooks/mods/` functions, so every suite spells a shape the same way.
    - Its exports: `mods(name)`, `textOf`, `stateFacts`, `reminderFacts`, `standardsState`, `runResult`, `sessionFacts`, `briefMarker`, `daysBefore`, `row` (`row.user`, `row.result`, `row.tool`), `ghEntry`, `MODELS`, `REMINDER_ROOT`.
  - `test/lib/mod-fixtures.mjs` is the one home of the fixtures both halves share.
    - The fixtures: `MODELS`, `SESSION_NOW`, `daysBefore`, `briefMarker`, `row`, `ghEntry`, `journalText`, `OPT_IN_SHAPES`.
    - `mod-world.ts` re-exports them whole, and `mods-inputs.js` all but `SESSION_NOW`, `journalText` and `OPT_IN_SHAPES`.
    - `git-repo.js` re-exports the opt-in shapes for the logic suites.
  - And `test/lib/mod-world.ts` is the one world beneath the hooks module for the `test/mods/*.test.ts` wiring suites.
    - `mkWorld(on)`: files, git, gh, the engine scripts, the store and the session, answered from memory.
- A scratch folder has one writer as well: `mkTmp(prefix)` in the kit's `scratch.js`, reached through `test/lib/harness.js`.
  - It resolves the path and removes every folder it made when the process exits.
- The kit's version stamp has one reader as well: `test/lib/version-stamp.js` holds `STAMP`, `readStamp(file)` and `kitVersion()`.
  - So no suite spells the stamp file or its first-line read itself.
- A world built the same way for every case has one home too: `seeded(build)` in the kit's `seed.js`, reached through `test/lib/harness.js`.
  - It builds the world once per process for each shape on first use, and removes it at exit.
  - It returns a copier that `fs.cpSync`s that shape's seed into the case's own folder, so no case is handed the seed.
- On a Windows machine `workkit setup` builds the kit's script shell (`workflow/script-shell.cs`) and points npm at it.
  - So a root `npm test` there records its tree.
- The Windows lane runs in CI: `checks.yml` runs the suite on Linux and Windows for every pull request and every push to `main`.
  - The exception is a release push: its every change is the CHANGELOG or a version stamp, by the commit gate's version-only rule.
  - `.github/scripts/release-push.sh` decides it, so a dependency change in the lockfile still runs.
  - A tag push runs nothing.
- Every participating repo's caller skips a release push by the same script.
  - It does so in `ci.yml`'s `Scope` step, ahead of its setup, install and suite.
- A push to `main` also runs the `release` job (`release.yml`, as every caller does).
  - The job makes the GitHub release of each `chore(release): <x.y.z>` commit the push brought.
  - `workkit ship cut` waits for it.
- Lanes per layer (`docs/project-state.md` § The proof):
  - Unit: a module called directly.
  - Integration: a script run whole with a stubbed `gh`.
  - End to end: no lane here (a live session is the only surface), so a park names that layer as skipped.
- A missing `Proof:` line is a hard gate.
  - `safety:proof-guard` holds the flip to complete and the close.
  - `safety:commit-gate` check 6 holds the `Fixes #N` trailer.

## Conventions

- **Portable by default.** macOS, Windows (Git Bash) and Linux all run the kit.
  - A spelling that differs branches once, in `workflow/lib/platform.sh` and `hooks/_lib.sh` (`docs/hooks.md` § Platforms).
  - The hooks module resolves the kit through `$.plugin.root`; the engine's stable address is `~/.claude/workkit`.
  - Every program the shipped Node code starts goes through `workflow/lib/run.js`, the Node twin of `platform.sh`.
    - `test/scripts/run-home.test.js` fails any other shipped `child_process` import but the published workkit-core runner's two files.
    - The rules: `workflow/README.md`, the `lib/run.js` row.
  - A path a shell line prints for a person, and every roster key, goes through `wk_native_path` in `platform.sh`, so Windows output never mixes `/d/a` and `D:/a`.
  - No shipped text (skills, agents, briefs, docs, the hook, workflow, jobs and tower READMEs) may carry a machine-specific absolute path or name the owner's own repo.
- **Generic by construction.** No owner names and no personal paths anywhere in the kit; `~/.workkit` and `.workkit/` are the only filesystem anchors.
- **One mechanism, branching by environment.** Never two parallel copies of the same job: one entry point, each step gated on what its environment can do.
- **Idempotent.** Every heal checks before acting; running twice equals running once.
- **Setup is the agent's to run.** Whenever a hook or a message says setup is needed, the agent runs `workkit setup` itself; in a cloud session, `workkit setup --cloud`.
  - Three choices setup asks only at a terminal (joining the repo, publishing the dashboard, creating the home repo) the agent asks the owner in chat.
    - It applies all three itself: `workkit enable`, `site.publish` in `~/.workkit/settings.json`, and the home repo with `workkit setup --home`.
  - A step only a human can finish prints the one human action for the agent to relay (approving the sign-in code in the browser, clicking the App's install on GitHub, running `claude setup-token`).
  - The sign-in waits in the foreground until the code is approved, so the agent runs `workkit setup --login` in the background and reads its output for the page and the code while it waits.
- **Comments are reminders and directions.** One to four lines saying the one thing the code cannot; a file header is one short paragraph.
  - No issue numbers, dates or history in a comment: the why lives on the issue and in the commit.
  - The owner's `code/lint` hook bounces a longer written run or history.
- **No em dashes, no exceptions.** Prose, comments, printed strings, tests and `CHANGELOG.md` use a colon, a comma, parentheses, a spaced hyphen or a new sentence. The CHANGELOG entry separator is a spaced hyphen.
- **The spec is the SSOT.** Rules live in `docs/project-state.md`; skills and hooks execute them and point at it rather than restating them.
- **One home per fact.** Every detail lands in its topic home (`docs/<topic>.md`, a folder's README, a `SKILL.md`) and is never restated where it is pointed at from.
