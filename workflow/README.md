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
| `lib.sh` | Sourced helpers the home-repo machinery shares: where `~/.workkit` is, a safe JSON edit, a slug out of a git remote, and a voice that delegates to whichever caller sourced it |
| `home.sh` | Sourced: the home repo's lifecycle — the login, the private repo, converting `~/.workkit` into its clone in place, the schema files, Discussions, Pages, the project list, the doctor lines |
| `discussions.sh` | Sourced: the home repo's Discussions API (GraphQL through `gh`) — enabling, resolving and caching the repo and category ids, posting a summary, reading prior summaries back |
| `publish.sh` | Builds the tower's app from this checkout and publishes it from the home repo's `docs/`, with the board snapshot baked in only when `site.board` says so |
| `site-data.js` | The snapshot the published site can ship with: one sweep of the roster and the board, written only when something other than the timestamp changed |
| `templates/home/` | The home repo's two committed files — `workkit.json` (the fixed schema) and the `.gitignore` that keeps the machine-local layer out of it |
| `wk.sh` | The capture CLI: `wk.sh note <text...>` appends one bullet to the right inbox |
| `changelog.js` | Machine SSOT for the CHANGELOG entry rules, and the CLI both guarding hooks call: `node changelog.js <file> [--added-only] [--staged] [--unreleased-only]` |
| `changelog-links.js` | Release-time backfill of each entry's commit link and contributor handle: `node changelog-links.js [--file X] [--range A..B] [--dry-run]` |

## The one command

`workkit.sh` is the front door. From zero on a new machine, the whole recipe is a clone and one line:

```sh
git clone <this repo> && cd workkit
./workflow/workkit.sh setup
```

`setup` installs the plugin from this checkout when the `claude` CLI is present and does not have it (a machine without that CLI gets a named skip, never a failure), checks that `gh` is installed and authenticated, points the engine's address at this folder, installs the 9am schedule through `jobs/install.sh`, creates the home repo and makes `~/.workkit` its clone, says where the tower is started, offers to enable the repo the shell is standing in, and symlinks itself to `~/.local/bin/workkit`. Where that directory is not on the PATH it prints the one `export` line to add — it never edits a shell rc. Every step checks before acting, so a second `setup` reports nothing to do.

| Command | What it does |
|---|---|
| `workkit help` | the map (also what a bare `workkit` prints) |
| `workkit setup` | the wizard above — the only path that installs a schedule for the first time |
| `workkit update` | re-runs the machine-side installs: the engine address, the `~/.local/bin` symlink, and the schedule |
| `workkit update --auto` | the quiet variant the standards hook runs; prints only what it changed |
| `workkit doctor` | reports drift — plugin, gh, both links, schedule vintage, the roster count, the home clone's state (missing · not a clone · another remote · ahead/behind/diverged), this repo's state — with the fix command for anything out of its reach |
| `workkit publish` | builds the dashboard and publishes it from the home repo; the daily job runs the same script after the brief |
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
| `~/.workkit/settings.json` (`$WORKFLOW_HOME` overrides) | one developer (never committed — gitignored inside the home clone) | `{ "version": 1, "repos": { "<absolute repo root>": "enabled" \| "declined" }, "home": "<owner>/<repo>", "homeCache": { … } }` — the machine's roster, this developer's declines, the home repo, and the cached GitHub node ids |
| `~/.workkit/workkit.json` | every machine (committed to the home repo) | `{ "version": 1, "projects": { "<owner>/<repo>": { "name": … } }, "site": { "url": … }, "preferences": {} }` — membership by SLUG, so it travels; the roster's paths do not |

Never-asked and declined are personal, not project facts (owner ruling, 2026-07-24): a teammate seeing `enabled: false` in a shared repo would read it as the project declining when it was one developer undecided. Only a real yes belongs in the repo.

**The roster.** Every heal (and every `--enable`) records the repo it is standing in under `repos` as `"enabled"` and drops any listed path that has gone away, lost its committed file, or whose committed file now says `enabled: false`. The registration takes the same `settings.json.lock` mutex a decline does — and so does every other writer of that file, the home slug and the cached GitHub node ids among them (`wk_take_settings_lock` in `lib.sh` is its single home) — so sessions opening at once in several repos all land on the roster. A `"declined"` entry is a decision and is never pruned. The list is an INDEX, not the answer — the committed per-repo file stays the SSOT of membership — and it is what the tower reads instead of walking a filesystem root, so a repo this machine has never opened is simply not on its dashboard. Registration is silent; `workkit doctor` reports the count.

**The home repo.** `"home": "<owner>/<repo>"` names the private GitHub repo whose issues hold the work that belongs to no single project — the cross-project and business queue, and the nursery for projects that do not exist yet. Unset, triage says so and leaves global entries in the inbox. Full doctrine: `docs/project-state.md` § The global layer.

## The home repo's lifecycle

`~/.workkit` is a folder AND the home repo's clone. `workkit setup` is the only thing that makes it one, and `home.sh` is where each step lives:

1. **The login** — `gh api user`. Without one, setup prints `gh auth login` and moves on; nothing is guessed.
2. **The repo** — one confirm line, then `gh repo create <login>/workkit --private`. A repo that already exists is the current one, never an error: a second machine finds the same home.
3. **The folder, converted IN PLACE** — an empty folder is cloned; a folder that predates the repo gets `git init`, the remote, and a first commit of the schema files ONLY, so the machine-local files are untracked by construction (the `.gitignore` is written before the first `git add`); a folder that is already the clone is a no-op; and a folder pointing at a DIFFERENT remote stops the home steps with a warning — someone else's repo is never adopted. A remote that already has history is joined, not overwritten.
4. **The schema files** — `workkit.json` (`{ version, projects, site, preferences }`) and the home `.gitignore`, each written once and never overwritten.
5. **Discussions** — enabled through the GraphQL API. The three summary categories (Daily, Weekly, Monthly) are CHECKED, never created: GitHub has no `createDiscussionCategory` mutation (probed against the live schema, 2026-07-28), so a missing category gets a one-time pointer at the page that makes it, and the summaries publish in the repo's default category until it exists.
6. **Pages** — `POST repos/<slug>/pages` for branch `main`, path `/docs`. A refusal (a private repo on a plan without Pages) warns with the fix and setup carries on.

Every step is idempotent and the whole sequence is safe to re-run. Afterwards the heal keeps `workkit.json`'s `projects` current — the repo's slug where the roster writes its path — and never commits or pushes it; the daily publish does that.

**Two deviations from the issue's Spec, both forced by what the API actually offers:**

- The built site lives at **`docs/`**, not `site/`. The Pages API's `source.path` takes exactly two values, `/` and `/docs` (`"enum":["/","/docs"]`), so no other subdirectory can be served from a branch.
- Discussion **categories are checked and fallen back on**, not created, because no mutation exists to create one.

## Publishing the dashboard

`publish.sh` builds `tower/app` from THIS checkout, mirrors the output into `~/.workkit/docs/`, writes the CNAME from `workkit.json`'s `site.url`, and commits and pushes it as one `chore(site): publish <date>`.

**The board snapshot is off by default.** GitHub Pages is PUBLIC even when the repo serving it is private, and `docs/data/board.json` is every issue title across every repo on the roster — so baking it in is the owner's published-board call and nobody else's. `workkit.json`'s `site.board` is the whole switch: only `true` writes the snapshot, and flipping it back to `false` removes the one already published.

The build is LOCAL and never a GitHub Action: the app consumes `@omega.js/*` by `file:` spec from a sibling omega checkout, which no CI runner has. On a machine without that checkout `npm install` still exits 0 and leaves dangling symlinks under `node_modules/@omega.js` (probed 2026-07-28), so the tooling check is the presence of `tower/app/node_modules/.bin/omega` — an install's success proves nothing. Every reason not to publish (no home clone, no tooling, nothing changed) is a named skip with exit 0; only a build or copy that actually failed exits non-zero.

`workkit publish` runs it on demand, a human's `workkit update` runs it too, and `jobs/claude-daily.sh` runs it after the morning brief — never before, and never in `update --auto`: a session start has no business spending minutes on an app build.

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

The hooks resolve this folder from their own location, so they work the moment the plugin is installed. Everything else — the spec, the skills, anything scripting the standard by hand — reaches it at `~/.claude/workkit`, a symlink this script maintains itself: every run points the address at the folder it is running from. The hook takes a `WORKFLOW_DIR` override and the address step a `WORKFLOW_CLAUDE_HOME` one; the tests use both.

Run it by hand against any repo:

```sh
bash ~/.claude/workkit/standards.sh [repo-root]
```

Only the label step, the claim sweep, and the label report need `jq`, `gh`, and a reachable remote; the gitignore, working-file, and forms heals are pure bash and always run. The gitignore heal checks its result with `git check-ignore` rather than looking for its own text — if some other pattern still hides `.workkit/settings.json` (the directory form `.workkit/` does exactly that, and no negation can undo it), the run names that line and reports the repo as needing attention instead of claiming success.

## Where this is going

This folder is the seed of a future installable kit — the workflow defined once, installed per agent and per developer, in repos beyond the owner's own. Tracking: issue #2. Keep it self-contained: nothing here may depend on `~/.claude`, on Claude Code, or on anything else in this repo.

The spec it implements: [`../docs/project-state.md`](../docs/project-state.md).
