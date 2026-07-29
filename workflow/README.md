# workflow — the issue-workflow core

The agent-agnostic core of the issue workflow. It knows nothing about Claude Code, which is why it lives at the plugin's top level instead of under `hooks/` — the hooks call it, and `~/.claude/workkit` is its stable address for anything else that does.

| File | What it is |
|---|---|
| `labels.json` | Machine SSOT for the label vocabulary — every label is `group:value`, with its description and color |
| `standards.sh` | Brings a repo to the standard, idempotently: creates the labels from `labels.json` (and corrects description/color drift), installs the issue templates and the required-checks CI workflow, vendors `changelog.js` to the repo's `.github/changelog-lint.js` and adds the `changelog` job to its `checks.yml`, asks for branch protection on the test check (best effort), keeps `.workkit/` in `.gitignore` along with the basics every repo needs (`.DS_Store`, `.env` — appended only when nothing already covers them), seeds `.workkit/inbox.md` and `.workkit/session.md`, releases agent claims that went quiet (a released `status:building` issue goes back to `status:specced` in the same edit), checks that the hook layer beside it is alive, reports an open issue whose status labels are missing or doubled (and flags the run so the next session hears it again), and reports leftovers from a retired convention |
| `templates/issue-forms/` | The markdown GitHub issue templates (bug · enhancement · idea · dump) installed into a repo's `.github/ISSUE_TEMPLATE/`. Each pre-fills the issue anatomy (`## Description` then `## Spec`) and auto-applies `status:inbox` + its `type:` label |
| `templates/github-workflows/` | `checks.yml`, the CI workflow installed into a repo's `.github/workflows/` — the `test` job runs the suite on every pull request, the `changelog` job holds the `[Unreleased]` section to the entry format. Installed once; the repo's copy is its own to extend and is never overwritten, except that the `changelog` job is appended once to a workflow healed before it existed |
| `templates/inbox.md` · `templates/session.md` | The two gitignored working files seeded into a participating repo's `.workkit/`. A file that already has content is never overwritten |
| `workkit.sh` | The one command: `setup` · `update [--auto]` · `doctor` · `publish` · `enable` · `decline` · `note` — the front door to everything below |
| `lib.sh` | Sourced helpers the home-repo machinery shares: the global layer's addresses (`~/.workkit`, the tower clone in it, its config and its build output), a safe JSON edit, a slug out of a git remote, and a voice that delegates to whichever caller sourced it |
| `home.sh` | Sourced: the home repo's lifecycle — the login, the private repo, the clone into `~/.workkit/tower`, seeding the tower project into an empty one, its install, Discussions, Pages, the doctor lines |
| `discussions.sh` | Sourced: the home repo's Discussions API (GraphQL through `gh`) — enabling, resolving and caching the repo and category ids, posting a summary, reading prior summaries back |
| `publish.sh` | Builds the tower project in `~/.workkit/tower` and pushes the output to the home repo's `gh-pages` branch, with the board snapshot baked in only when `site.board` says so |
| `site-data.js` | The snapshot the published site can ship with: one sweep of the roster and the board, written only when something other than the timestamp changed |
| `wk.sh` | The capture CLI: `wk.sh note <text...>` appends one bullet to the right inbox |
| `changelog.js` | Machine SSOT for the CHANGELOG entry rules, and the CLI both guarding hooks call: `node changelog.js <file> [--added-only] [--staged] [--unreleased-only]` |
| `changelog-links.js` | Release-time backfill of each entry's commit link and contributor handle: `node changelog-links.js [--file X] [--range A..B] [--dry-run]` |

## The one command

`workkit.sh` is the front door. From zero on a new machine, the whole recipe is a clone and one line:

```sh
git clone <this repo> && cd workkit
./workflow/workkit.sh setup
```

`setup` installs the plugin from this checkout when the `claude` CLI is present and does not have it (a machine without that CLI gets a named skip, never a failure), checks that `gh` is installed and authenticated, points the engine's address at this folder, installs the 9am schedule through `jobs/install.sh`, creates the home repo and clones the tower project into `~/.workkit/tower`, says where the tower is started, offers to enable the repo the shell is standing in, and symlinks itself to `~/.local/bin/workkit`. Where that directory is not on the PATH it prints the one `export` line to add — it never edits a shell rc. Every step checks before acting, so a second `setup` reports nothing to do.

| Command | What it does |
|---|---|
| `workkit help` | the map (also what a bare `workkit` prints) |
| `workkit setup` | the wizard above — the only path that installs a schedule for the first time |
| `workkit update` | re-runs the machine-side installs: the engine address, the `~/.local/bin` symlink, and the schedule |
| `workkit update --auto` | the quiet variant the standards hook runs; prints only what it changed |
| `workkit doctor` | reports drift — plugin, gh, both links, schedule vintage, the roster count, the tower clone's state (unset · absent · clone · other, plus ahead/behind/diverged), this repo's state — with the fix command for anything out of its reach |
| `workkit publish` | builds the tower project and pushes the site to the home repo's `gh-pages` branch; the daily job runs the same script after the brief |
| `workkit enable [repo]` · `workkit decline [repo]` | `standards.sh --enable` / `--decline` under the one name |
| `workkit note <text...>` | `wk.sh note`, unchanged |

**Upkeep is automatic.** Claude Code has no plugin-install hook, so the trigger is the one this kit owns: the `workflow:standards` SessionStart hook's once-per-day run calls `workkit update --auto` (resolved beside the engine, never through the PATH or the symlink, which are exactly what may not exist yet). A checkout that moved, or a job template that changed, is corrected the next morning instead of waiting for someone to remember the installer. Two boundaries keep that safe:

- **It only ever UPDATES a schedule a human already installed** — the installed `com.workkit.claude-daily.plist` is the marker. A machine with no schedule never gets one at session start.
- **It creates no convention it did not find.** `~/.local/bin` is linked when the directory already exists; making it is a human's `setup`. The same restraint the engine's address shows toward `~/.claude`.

The drift question is answered by `jobs/install.sh --check`, which renders and compares without asking launchd anything. Most session starts never get that far — the hook's daily marker returns first — and the once-a-day run that does costs a few short shell invocations and a `plutil` lint, with no launchd call and no network. Agents themselves never issue launchd commands; their path is `workkit doctor`, which reports and fixes nothing.

## The capture CLI

`wk.sh` gets a thought out of a head and into an inbox with no session, no agent, and no network:

```sh
bash ~/.claude/workkit/wk.sh note fix the tower poller
```

The words after `note` join with spaces, so the call works unquoted, and the bullet lands in the inbox of the repo the shell is standing in — decided by a walk UP from the current directory to the first ancestor whose `.workkit/settings.json` says the repo participates. Standing outside one, there is no inbox file to write to: the note is filed as a `status:inbox` issue on the home repo instead, and where there is no clone yet — or no way to reach GitHub — it hands the note back on stderr and exits 1, rather than buffering a thought no triage run reads. A missing inbox is created from `templates/inbox.md`, so a hand-made file reads exactly like a seeded one; existing content is only ever appended to. No arguments, an unknown subcommand, or an empty note prints usage on stderr and exits 1. Triage drains the inboxes into issues; the captures made outside a project are issues already.

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
| `~/.workkit/settings.json` (`$WORKFLOW_HOME` overrides) | one developer (never committed — `~/.workkit` is a plain folder, not a repo) | `{ "version": 1, "repos": { "<absolute repo root>": "enabled" \| "declined" }, "home": "<owner>/<repo>", "homeCache": { … }, "site": { "url": …, "board": false } }` — the machine's roster, this developer's declines, the home repo, the cached GitHub node ids, and the published dashboard's options (absent reads as no URL and no board) |

Never-asked and declined are personal, not project facts (owner ruling, 2026-07-24): a teammate seeing `enabled: false` in a shared repo would read it as the project declining when it was one developer undecided. Only a real yes belongs in the repo.

**The roster.** Every heal (and every `--enable`) records the repo it is standing in under `repos` as `"enabled"` and drops any listed path that has gone away, lost its committed file, or whose committed file now says `enabled: false`. The registration takes the same `settings.json.lock` mutex a decline does — and so does every other writer of that file, the home slug and the cached GitHub node ids among them (`wk_take_settings_lock` in `lib.sh` is its single home) — so sessions opening at once in several repos all land on the roster. A `"declined"` entry is a decision and is never pruned. The list is an INDEX, not the answer — the committed per-repo file stays the SSOT of membership — and it is what the tower reads instead of walking a filesystem root, so a repo this machine has never opened is simply not on its dashboard. Registration is silent; `workkit doctor` reports the count.

**The home repo.** `"home": "<owner>/<repo>"` names the private GitHub repo whose issues hold the work that belongs to no single project — the cross-project and business queue, and the nursery for projects that do not exist yet. Unset, triage says so and leaves global entries where they are. Full doctrine: `docs/project-state.md` § The global layer.

## The home repo's lifecycle

`~/.workkit` is a plain folder, and the ONE git repo in it is `~/.workkit/tower` — the home repo's clone, and the tower dashboard as a real project. `workkit setup` is the only thing that makes it, and `home.sh` is where each step lives:

1. **The login** — `gh api user`. Without one, setup prints `gh auth login` and moves on; nothing is guessed.
2. **The repo** — one confirm line, then `gh repo create <login>/workkit --private`. A repo that already exists is the current one, never an error: a second machine finds the same home.
3. **The clone** — a plain `git clone` into `~/.workkit/tower`. Nothing is ever converted or adopted: an absent path is cloned, the right clone is a no-op, and ANYTHING else already there (a repo pointing elsewhere, a folder somebody made) stops the home steps with a warning naming what it found. A repo GitHub just created is empty and clones with a warning git prints and this step swallows — that is the ordinary first-setup case.
4. **The seed**, only into an empty clone — this checkout's `tower/app` copied in whole, minus what a working checkout accretes (`node_modules` at any depth, the lockfile, `.omega`, `dist`, `.env`); the project's own `README.md`/`AGENTS.md`/`CLAUDE.md` travel with it, because the repo they land in is a real repo. The clone is engine territory and carries nothing hand-written — no site options, no `.workkit/` of its own — so the one thing the seed adds on top of the copy is every `file:` dependency spec repointed at the ABSOLUTE path it resolved to from this checkout — recorded in the manifest's description the way omega-brand records its own. A clone another machine already seeded is left exactly as it is.
5. **The install** — `npm install` in the clone, so the daily publish has something to build with. It runs on BOTH clone paths, because a project that travelled from another machine arrives without its `node_modules`; a tree that already carries `node_modules/.bin/omega` is a skip, so re-running costs nothing. Absent tooling is an honest warning naming what did not install, never a failure.
6. **Discussions** — enabled through the GraphQL API. The three summary categories (Daily, Weekly, Monthly) are CHECKED, never created: GitHub has no `createDiscussionCategory` mutation (probed against the live schema, 2026-07-28), so a missing category gets a one-time pointer at the page that makes it, and the summaries publish in the repo's default category until it exists.
7. **Pages** — `POST repos/<slug>/pages` for branch `gh-pages`, path `/`. The branch need not exist yet; the first publish makes it. A refusal (a private repo on a plan without Pages) warns with the fix and setup carries on.
8. **The first commit** — `chore(home): seed the tower project`, pushed.

Every step is idempotent and the whole sequence is safe to re-run: a second setup finds the clone and reports rather than acting. Afterwards the heal owes the global layer nothing but the machine roster — the clone is a participating repo, healed by standing in it like any other.

**Two shapes the API forced, both proved against the live schema:**

- Discussion **categories are checked and fallen back on**, not created, because no mutation exists to create one.
- The Pages source path is `/` or `/docs` and nothing else (`"enum":["/","/docs"]`), which is why the site is served from the ROOT of its own branch rather than from a folder named for the rule.

## Publishing the dashboard

`publish.sh` pulls the clone, builds it, and pushes the OUTPUT to the home repo's `gh-pages` branch — so nothing generated is ever committed as source and the default branch stays the project.

The build runs in the APP, not at the brand root: `omega build` is a command of `@omega.js/web` and resolves only inside `apps/web` (at the root the `omega` bin dispatches to `@omega.js/manager`, which has no build at all — probed 2026-07-29). So the build is `npm --prefix ~/.workkit/tower/apps/web run build`, and it writes `apps/web/dist/`.

The push uses a temporary `git worktree`, so main's working tree is never checked out over, and force-with-lease onto `gh-pages` alone — the branch carries nothing but generated files, so a rewrite is what a rebuild IS, and the lease still refuses to overwrite a push this machine has not seen. Any SOURCE change the day left in the clone is committed and pushed to main separately, as one `chore(site): publish <date>`. The pull is `--rebase --autostash`, and a pull that cannot finish — a divergence, an offline machine, a refused auth — publishes nothing and says the clone could not catch up; the engine never forces main. The autostash's own failure is caught too: a rebase that lands while the stash it took conflicts on the way back exits 0 over a tree full of conflict markers, so the surviving stash entry is checked for, the tree is put back exactly as the run found it, and nothing is built, committed or pushed. A `~/.workkit/settings.json` that does not parse is refused the same way rather than read as an absent one — and that check comes first, since the same file names the home repo.

**The board snapshot is off by default.** GitHub Pages is PUBLIC even when the repo serving it is private, and `data/board.json` is every issue title across every repo on the roster — so baking it in is the owner's published-board call and nobody else's. `~/.workkit/settings.json`'s `site.board` is the whole switch: only `true` writes the snapshot, and flipping it back to `false` removes the one already published. `site.url` set writes the CNAME into the published branch.

The build is LOCAL and never a GitHub Action: the app consumes `@omega.js/*` by `file:` spec from a sibling omega checkout, which no CI runner has. On a machine without that checkout `npm install` still exits 0 and leaves dangling symlinks under `node_modules/@omega.js` (probed 2026-07-28), so the tooling check is the presence of `~/.workkit/tower/node_modules/.bin/omega` — an install's success proves nothing. Every reason not to publish (no home clone, no tooling, a clone that could not catch up, a conflicting autostash, an unparseable settings file, nothing changed) is a named skip with exit 0; only a build or copy that actually failed exits non-zero.

`workkit publish` runs it on demand, a human's `workkit update` runs it too, and `jobs/claude-daily.sh` runs it after the morning brief — never before, and never in `update --auto`: a session start has no business spending minutes on an app build.

## Participation — the tri-state

| Repo state | `standards.sh` does |
|---|---|
| committed `enabled: true`, or no `enabled` key at all | heal |
| committed `enabled: false` | nothing, silently |
| no committed file, no record | print one line offering to enable — and write **nothing** into the repo |
| no committed file, recorded `declined` | nothing, silently |
| the tower clone at `~/.workkit/tower` | nothing — it is engine territory: never offered, never healed, never on the roster, and `--enable` refuses it |

Both answers are explicit commands, never something a hook decides:

```sh
bash ~/.claude/workkit/standards.sh --enable [repo]    # write the committed opt-in, then heal
bash ~/.claude/workkit/standards.sh --decline [repo]   # record it in the USER file; never offered again
bash ~/.claude/workkit/standards.sh --state [repo]     # enabled | disabled | declined | undecided | home | nogit
bash ~/.claude/workkit/standards.sh --announce [repo]  # the offer line, for a hook to relay
bash ~/.claude/workkit/standards.sh --engine-link       # maintain the engine's address, nothing else
```

`--decline` writes only the `repos` key: every other key in the user file, and its value, survives untouched. Both files are created lazily — nothing exists until there is a decision to record.

## How it is reached

The hooks resolve this folder from their own location, so they work the moment the plugin is installed. Everything else — the spec, the skills, anything scripting the standard by hand — reaches it at `~/.claude/workkit`, a symlink this script maintains itself: a real heal points the address at the folder it is running from, provided that folder is a git checkout whose origin names the workkit repo. A probe writes nothing, and a copy that is not the machine's engine is left silently alone. `--engine-link` is that step on its own, which is what `workkit setup|update` calls. The hook takes a `WORKFLOW_DIR` override and the address step a `WORKFLOW_CLAUDE_HOME` one; the tests use both.

Run it by hand against any repo:

```sh
bash ~/.claude/workkit/standards.sh [repo-root]
```

Only the label step, the claim sweep, and the label report need `jq`, `gh`, and a reachable remote; the gitignore, working-file, and forms heals are pure bash and always run. The gitignore heal checks its result with `git check-ignore` rather than looking for its own text — if some other pattern still hides `.workkit/settings.json` (the directory form `.workkit/` does exactly that, and no negation can undo it), the run names that line and reports the repo as needing attention instead of claiming success.

## Where this is going

This folder is the seed of a future installable kit — the workflow defined once, installed per agent and per developer, in repos beyond the owner's own. Tracking: issue #2. Keep it self-contained: nothing here may depend on `~/.claude`, on Claude Code, or on anything else in this repo.

The spec it implements: [`../docs/project-state.md`](../docs/project-state.md).
