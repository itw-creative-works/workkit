# workflow — the issue-workflow core

The agent-agnostic core of the issue workflow. It knows nothing about Claude Code, which is why it lives at the plugin's top level instead of under `hooks/` — the hooks call it, and `~/.claude/workkit` is its stable address for anything else that does.

| File | What it is |
|---|---|
| `labels.json` | Machine SSOT for the label vocabulary — every label is `group:value`, with its description and color |
| `standards.sh` | Brings a repo to the standard, idempotently: creates the labels from `labels.json` (and corrects description/color drift), installs the issue templates and the required-checks CI workflow, vendors `changelog.js` to the repo's `.github/changelog-lint.js` and adds the `changelog` job to its `checks.yml`, asks for branch protection on the test check (best effort), keeps `.workkit/` in `.gitignore` along with the basics every repo needs (`.DS_Store`, `.env` — appended only when nothing already covers them), seeds `.workkit/inbox.md` and `.workkit/session.md`, releases agent claims that went quiet (a released `status:building` issue goes back to `status:specced` in the same edit) and flips the other direction too — an open `status:specced` issue with an assignee is a claim on an authorized spec, so it moves to `status:building` with a comment (issue #62) — checks that the hook layer beside it is alive, reports an open issue whose status labels are missing or doubled (and flags the run so the next session hears it again), and reports leftovers from a retired convention |
| `templates/issue-forms/` | The markdown GitHub issue templates (bug · enhancement · idea · dump) installed into a repo's `.github/ISSUE_TEMPLATE/`. Each pre-fills the issue anatomy (`## Description` then `## Spec`) and auto-applies `status:inbox` + its `type:` label |
| `templates/github-workflows/` | Two workflows, installed into two different places. `brief.yml` is the cloud morning brief, seeded onto the HOME repo by `home.sh` (issue #91) and nowhere else. `checks.yml` is the CI workflow installed into a repo's `.github/workflows/` — the `test` job runs the suite on every pull request, the `changelog` job holds the `[Unreleased]` section to the entry format. Installed once; the repo's copy is its own to extend and is never overwritten, except that the `changelog` job is appended once to a workflow healed before it existed |
| `templates/inbox.md` · `templates/session.md` | The two gitignored working files seeded into a participating repo's `.workkit/`. A file that already has content is never overwritten |
| `workkit.sh` | The one command: `setup` · `update [--auto]` · `doctor` · `publish` · `brief [--local]` · `tower` · `enable` · `decline` · `note` — the front door to everything below |
| `lib.sh` | Sourced helpers the home-repo machinery shares: the global layer's addresses (`~/.workkit`, the tower clone in it, its config and its build output), a safe JSON edit, a slug out of a git remote, the terminal palette every command styles from, and a voice that delegates to whichever caller sourced it |
| `home.sh` | Sourced: the home repo's lifecycle — the login, the private repo, the clone into `~/.workkit/tower`, seeding the tower project into an empty one, its install, Discussions, Pages, the clone's own heal, the doctor lines |
| `discussions.sh` | Sourced: the home repo's Discussions API (GraphQL through `gh`) — enabling, resolving and caching the repo and category ids, posting a summary or a brief, reading prior posts back |
| `publish.sh` | Heals the home repo (its labels and issue forms) and refreshes the roster on its default branch — both above the switch — then builds the tower project in `~/.workkit/tower` and pushes the output to the home repo's `gh-pages` branch — the build and the push only when `site.publish` says so, and a switch turned off takes the published site down |
| `site-repos.js` | The roster the published site sweeps: the list of `owner/name` slugs, from the same roster the tower and the brief read, plus the home repo under `home` — written to the home repo's default branch, never beside the public pages, and a roster it cannot read raises rather than writing the empty list a machine with nothing registered would |
| `wk.sh` | The capture CLI: `wk.sh note <text...>` appends one bullet to the right inbox |
| `changelog.js` | Machine SSOT for the CHANGELOG entry rules, and the CLI both guarding hooks call: `node changelog.js <file> [--added-only] [--staged] [--unreleased-only]` |
| `changelog-links.js` | Release-time backfill of each entry's commit link and contributor handle: `node changelog-links.js [--file X] [--range A..B] [--dry-run]` |

## The one command

`workkit.sh` is the front door. From zero on a new machine, the whole recipe is a clone and one line:

```sh
git clone <this repo> && cd workkit
./workflow/workkit.sh setup
```

`setup` installs the plugin from this checkout when the `claude` CLI is present and does not have it (a machine without that CLI gets a named skip, never a failure), checks that `gh` is installed and authenticated, points the engine's address at this folder, installs the 9am schedule through `jobs/install.sh`, creates the home repo and clones the tower project into `~/.workkit/tower`, wires the cloud brief's secrets onto the home repo — where that brief runs and where it is delivered — says where the tower is started, offers to enable the repo the shell is standing in, and symlinks itself to `~/.local/bin/workkit`. Where that directory is not on the PATH it prints the one `export` line to add — it never edits a shell rc. Every step checks before acting, so a second `setup` reports nothing to do.

`setup` and `doctor` say all of that in titled sections — **This machine** (plugin, gh, the two addresses, the schedule) · **Home repo** · **Cloud brief secrets** · **Dashboard site** (setup only) · **This repo** — one blank line apart, in the order the steps run. Color is a terminal's affordance and nothing else's: `lib.sh`'s `wk_color_on` is the one gate `setup`, `doctor`, `update`, and `publish` ask, and it says no to a pipe, to `NO_COLOR`, and to a `dumb` TERM, so a log file keeps the plain glyph lines (`WORKKIT_COLOR=1`/`0` overrides the tty question either way; `standards.sh` still carries its own ungated palette — the standards hook strips those escapes from what it captures). `update --auto` prints neither the titles nor the blank lines — a session-start injection stays terse.

| Command | What it does |
|---|---|
| `workkit help` | the map (also what a bare `workkit` prints) |
| `workkit setup` | the wizard above — the only path that installs a schedule for the first time |
| `workkit update` | re-runs the machine-side installs: the engine address, the `~/.local/bin` symlink, and the schedule |
| `workkit update --auto` | the quiet variant the standards hook runs; prints only what it changed, plus one warning line for a cloud secret that is missing or stale |
| `workkit doctor` | reports drift — plugin, gh, both links, schedule vintage, the roster count, the tower clone's state (unset · absent · clone · other, plus ahead/behind/diverged), whether the cloud brief's seeded runner still matches this checkout, the cloud brief's secrets, this repo's state — with the fix command for anything out of its reach |
| `workkit publish` | builds the tower project and pushes the site to the home repo's `gh-pages` branch; the daily job runs the same script after the brief |
| `workkit brief` | today's brief, asked for now: the same `gh workflow run brief.yml` dispatch the 9am schedule makes, through the same one function (`jobs/brief-dispatch.sh`) and the same secret guards. A human is standing here, so a refusal names its reason and exits 1 rather than being logged and carried past, and a dispatch that lands prints where to watch the run |
| `workkit brief --local` | the rehearsal instead — `jobs/morning.sh --now`, the full local morning with the brief composed and sent from this machine and never posted to the home repo. The other steps still run where they can: the summaries can post their Discussion, and the site publish fires when it is switched on |
| `workkit enable [repo]` · `workkit decline [repo]` | `standards.sh --enable` / `--decline` under the one name |
| `workkit tower` | runs the tower here — the JSON API (8693) and the dashboard (4300) together; replaces any previous instance on those ports, and one interrupt ends both |
| `workkit note <text...>` | `wk.sh note`, unchanged |

**Upkeep is automatic.** Claude Code has no plugin-install hook, so the trigger is the one this kit owns: the `workflow:standards` SessionStart hook's once-per-day run calls `workkit update --auto` (resolved beside the engine, never through the PATH or the symlink, which are exactly what may not exist yet). A checkout that moved, or a job template that changed, is corrected the next morning instead of waiting for someone to remember the installer. Two boundaries keep that safe:

- **It only ever UPDATES a schedule a human already installed** — the installed `com.workkit.claude-daily.plist` is the marker. A machine with no schedule never gets one at session start.
- **It creates no convention it did not find.** `~/.local/bin` is linked when the directory already exists; making it is a human's `setup`. The same restraint the engine's address shows toward `~/.claude`.

**Setup is pestered for, never performed.** The same hook checks one thing above every gate it has — `~/.local/bin/workkit`, the command `setup` installs. While that is missing (absent, dangling, or not executable), EVERY session, in a participating repo or no repo at all, is told to have the user run `bash <engine>/workkit.sh setup` before other work; there is no daily cache, because a machine without setup has no schedule, no home repo, and no command. The pester stops the moment setup has run, and it never runs anything itself.

The drift question is answered by `jobs/install.sh --check`, which renders and compares without asking launchd anything. Most session starts never get that far — the hook's daily marker returns first — and the once-a-day run that does costs a few short shell invocations and a `plutil` lint, with no launchd call and no network. Agents themselves never issue launchd commands; their path is `workkit doctor`, which reports and fixes nothing.

## The capture CLI

`wk.sh` gets a thought out of a head and into an inbox with no session, no agent, and no network:

```sh
bash ~/.claude/workkit/wk.sh note fix the tower poller
```

The words after `note` join with spaces, so the call works unquoted, and the bullet lands in the inbox of the repo the shell is standing in — decided by a walk UP from the current directory to the first ancestor whose `.workkit/settings.json` says the repo participates. Standing outside one, there is no inbox file to write to: the note is filed as a `status:inbox` issue on the home repo instead, and where there is no clone yet — or no way to reach GitHub — it hands the note back on stderr and exits 1, rather than buffering a thought no triage run reads. A missing inbox is created from `templates/inbox.md`, so a hand-made file reads exactly like a seeded one; existing content is only ever appended to. No arguments, an unknown subcommand, or an empty note prints usage on stderr and exits 1. Triage drains the inboxes into issues; the captures made outside a project are issues already, and triage's HQ pass drains those from any repo (#100).

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
| `~/.workkit/settings.json` (`$WORKFLOW_HOME` overrides) | one developer, BY HAND | `{ "version": 1, "site": { "repo": "<owner>/<repo>", "publish": null, "url": null } }` — the site options and nothing else: the home repo the site publishes from, the all-or-nothing publish switch, and the custom domain (an absent key reads as off and as no URL). `publish` seeds NULL, the unanswered state — `true`/`false` are answers, and an interactive `workkit setup` asks for one once there is a home repo to publish from; `url` is asked for only in the same breath as a FRESH yes, and is a hand edit ever after |
| `~/.workkit/.repos.json` | the engine | `{ "version": 1, "repos": { "<absolute repo root>": "enabled" \| "declined" } }` — the machine's roster and this developer's declines |
| `~/.workkit/.cache.json` | the engine, disposably | `{ "homeCache": { … } }` — the cached GitHub node ids, and nothing else since the upstream-news cursor moved onto the board (issue #86). Safe to delete: every reader rebuilds what it does not find |

The three are split by WHO WRITES THEM (issue #80). Anything a human types is in `settings.json`; anything the engine records is in a dot-named file beside it, which is how a reader knows at a glance that editing it is pointless. `settings.json` has one machine-written key — `site.repo`, which `workkit setup` records once — and nothing else in it is ever written by a run.

Never-asked and declined are personal, not project facts (owner ruling, 2026-07-24): a teammate seeing `enabled: false` in a shared repo would read it as the project declining when it was one developer undecided. Only a real yes belongs in the repo.

**The roster.** Every heal (and every `--enable`) records the repo it is standing in under `repos` in `.repos.json` as `"enabled"` and drops any listed path that has gone away, lost its committed file, or whose committed file now says `enabled: false`. The registration takes the same `~/.workkit/.state.lock` mutex a decline does — and so does every other writer of the machine's files, the home slug and the cached GitHub node ids among them (`wk_take_state_lock` in `lib.sh` is its single home) — so sessions opening at once in several repos all land on the roster. A `"declined"` entry is a decision and is never pruned. The list is an INDEX, not the answer — the committed per-repo file stays the SSOT of membership — and it is what the tower reads instead of walking a filesystem root, so a repo this machine has never opened is simply not on its dashboard. Registration is silent; `workkit doctor` reports the count.

**The home repo.** `site.repo` names the private GitHub repo whose issues hold the work that belongs to no single project — the cross-project and business queue, and the nursery for projects that do not exist yet. Unset, triage says so and leaves global entries where they are. Full doctrine: `docs/project-state.md` § The global layer.

## The home repo's lifecycle

`~/.workkit` is a plain folder, and the ONE git repo in it is `~/.workkit/tower` — the home repo's clone, and the tower dashboard as a real project. `workkit setup` is the only thing that makes it, and `home.sh` is where each step lives:

1. **The login** — `gh api user`. Without one, setup prints `gh auth login` and moves on; nothing is guessed.
2. **The repo** — one confirm line, then `gh repo create <login>/workkit --private`. A repo that already exists is the current one, never an error: a second machine finds the same home.
3. **The clone** — a plain `git clone` into `~/.workkit/tower`. Nothing is ever converted or adopted: an absent path is cloned, the right clone is a no-op, and ANYTHING else already there (a repo pointing elsewhere, a folder somebody made) stops the home steps with a warning naming what it found. A repo GitHub just created is empty and clones with a warning git prints and this step swallows — that is the ordinary first-setup case.
4. **The seed**, only into an empty clone — this checkout's `tower/app` copied in whole, minus what a working checkout accretes (`node_modules` at any depth, the lockfile, `.omega`, `dist`, `.env`); the project's own `README.md`/`AGENTS.md`/`CLAUDE.md` travel with it, because the repo they land in is a real repo. The clone is engine territory and carries nothing hand-written — no site options, no `.workkit/` of its own — so the one thing the seed adds on top of the copy is every `file:` dependency spec repointed at the ABSOLUTE path it resolved to from this checkout — recorded in the manifest's description the way omega-brand records its own. A clone another machine already seeded is left exactly as it is.
5. **The cloud brief's runner** (issue #91) — the workflow and the code it runs, copied in on EVERY setup rather than only into an empty clone. `.github/workflows/brief.yml` comes from `templates/github-workflows/brief.yml`; the rest lands under `brief/` with its checkout-relative subpaths intact (`brief/jobs/`, `brief/workflow/`, `brief/tower/api/lib/`), so every relative address inside those scripts resolves in the clone exactly as it does here. The list is `WK_HOME_RUNNER_FILES` in `home.sh` — the require closure of `brief-payload.js` plus what `morning.sh` sources — and it is copied by CONTENT: a file already identical is not rewritten, so a second setup writes nothing, and a checkout that moved on is healed and pushed as its own `chore(home): refresh the cloud brief runner` commit. The seed also SUBTRACTS (issue #117): `brief/` is engine territory, so a file under it the list no longer names — what a rename like #107's left behind — is removed, folders it empties with it, and the removal counts as a change so it rides that same commit. **The daily morning writes it too** (issue #143): `jobs/morning.sh` calls this same function ahead of its dispatch, so a `git pull` of this checkout reaches the cloud the next morning rather than waiting for somebody to re-run setup — it is a reconcile like the tower project's sync and the clone's heal, and like them it creates and clones nothing, naming a skip where there is no clone. `workkit doctor` is what still reports drift the last morning could not heal, comparing the same list file by file and naming `workkit setup` as the fix — it never writes or pushes, and an unreadable clone or checkout is a named skip. The workflow lives here because the plugin repo is distributed to everyone who installs the kit, and a consumer cannot set secrets on a repo they do not own.
6. **The install** — `npm install` in the clone, so the daily publish has something to build with. It runs on BOTH clone paths, because a project that travelled from another machine arrives without its `node_modules`; a tree that already carries `node_modules/.bin/omega` is a skip, so re-running costs nothing. Absent tooling is an honest warning naming what did not install, never a failure.
7. **Discussions** — enabled through the GraphQL API. The three summary categories (Daily, Weekly, Monthly) are CHECKED, never created: GitHub has no `createDiscussionCategory` mutation (probed against the live schema, 2026-07-28), so a missing category gets a one-time pointer at the page that makes it, and the summaries publish in the repo's default category until it exists.
8. **Pages** — `POST repos/<slug>/pages` for branch `gh-pages`, path `/`. The branch need not exist yet; the first publish makes it. A refusal (a private repo on a plan without Pages) warns with the fix and setup carries on.
9. **The first commit** — `chore(home): seed the tower project`, pushed.
10. **The publish question** — setup built the whole publish path, so it asks the one thing left: publish the dashboard site to GitHub Pages? `[y/N]`, empty is no, and the answer is written to `site.publish` under the same state mutex every writer of that file takes. It is asked ONCE — `true` and `false` are both answers and are never asked again, and only the unanswered null (or no key at all) has a question left. No home repo, no terminal, no jq, no settings file, or a settings file that does not parse: a named skip (or warn, for the unparseable file) that leaves the switch unanswered and the file untouched, so a later interactive setup asks.
11. **The domain, on the fresh yes only** — and only while `site.url` is null: custom domain for the site? Enter for none. Empty leaves `site.url` null, which is the plain github.io address and no CNAME; anything typed is written to `site.url` under the same mutex, taken at its word — `publish.sh` already strips a scheme prefix on its way to the CNAME. It rides the fresh yes because that is the one moment nothing is serving yet; a machine that answered on an earlier run changes its domain by hand edit.
12. **The publish** — when the switch ends on, freshly answered or already true, setup runs the publish, the same call a human's `workkit update` makes. It comes after the domain question, so the first site already carries its CNAME. Off, unanswered, or a question step that skipped adds no call at all: `publish.sh`'s own gate stays the single owner of that refusal, and a re-run simply republishes, like every other step here.

13. **The clone's own heal** (issue #123) — `wk_home_heal`, the home repo brought to the same standard every participating repo is brought to, by the same code: `standards.sh --home` runs `ensure_issue_forms` and `sync_labels` against the clone and nothing else, so the home repo has the labels every queue reads and the forms that apply them — without which a capture filed from a phone lands unlabelled and invisible. Scoped to those two because the clone is engine territory: no `.workkit/`, no opt-in, no local files. The mode REFUSES any directory that is not the clone, so it can never write into a repo that never said yes. The forms are files, so they are committed and pushed as `chore(home): install the issue templates` — but only when the forms themselves changed, which makes the second run write nothing, commit nothing and push nothing; the labels are a remote write and leave the tree alone. No clone, a missing heal, or a push that did not land is a named warning and exit 0.

Every step is idempotent and the whole sequence is safe to re-run: a second setup finds the clone and reports rather than acting. Afterwards the heal owes the global layer nothing but the machine roster — the clone itself is never healed by a SESSION, because nobody ever opens one in it, which is why step 13 is the engine's own call and why the daily publish makes it again.

**Two shapes the API forced, both proved against the live schema:**

- Discussion **categories are checked and fallen back on**, not created, because no mutation exists to create one.
- The Pages source path is `/` or `/docs` and nothing else (`"enum":["/","/docs"]`), which is why the site is served from the ROOT of its own branch rather than from a folder named for the rule.

## The cloud brief's secrets

The morning brief runs on a GitHub Actions runner, from the workflow step 5 seeded onto the **home repo** — so the two secrets it needs live there too, on the slug in `~/.workkit/settings.json`, which is also the slug the daily job's dispatch gates on. Not on this checkout's own repo: the plugin is distributed to everyone who installs the kit, and a consumer cannot set secrets on a repo they do not own (issue #91). Setting them by hand was the last manual step of a from-zero install, so `setup` wires them (issue #88):

| Value | What setup does |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | absent, or last set more than ~11 months ago (the token lives about a year) → a `[y/N]` offer to run `claude setup-token`. A yes mints it and pipes it straight into `gh secret set`. Without a terminal the two commands are printed instead — the mint is a browser approval and cannot be automated |
| `WORKKIT_GITHUB_TOKEN` | absent → set zero-click from `gh auth token`, no prompt (owner ruling 2026-07-30: maximum automation, and that login's broad reach is accepted). Present → left alone. It is the CROSS-REPO one, for the board sweep; the Discussion is posted with the workflow's built-in `GITHUB_TOKEN` and needs no secret. A name may contain `GITHUB_` — only a name that starts with it is refused |

**A token value only ever moves through a pipe.** It is held in one local on the way from the command that produced it to `gh secret set`'s stdin, and is never written to a file, passed as an argument, echoed, or logged.

Reading comes first and decides everything: no `gh`, no `jq`, an incomplete checkout, no home repo yet, or a `gh secret list` that did not come back as a JSON array is a NAMED SKIP, never a missing value — a repo that could not be read must never send someone to mint a token that is already there, and must never be written to either. The listing is bounded (`timeout`/`gtimeout` when the machine has one, a bash watchdog when it does not, `WORKKIT_GH_TIMEOUT` seconds, default 10), because the daily `update --auto` runs them at session start and a captive portal answers the handshake and never the request; a bound that fires reads as an unreadable listing. Writes are not bounded — every one of them is on a path a human is sitting in front of. `workkit doctor` reports one line per value (set and fresh, missing, or stale, each with the command that fixes it) and counts both toward its attention total; the daily `workkit update --auto` never prompts and never mints — at most one warning line per value.

## Publishing the dashboard

`publish.sh` pulls the clone, refreshes it from this checkout's `tower/app`, mints its brand assets, builds it, and pushes the OUTPUT to the home repo's `gh-pages` branch — so nothing generated is ever committed as source and the default branch stays the project.

**The clone catches up before it is built** (issue #129). The seed is a ONE-TIME write — a clone that already carries the project is another machine's work and is never re-seeded — so every tower improvement made after the home repo was created used to stop at the checkout, and what Pages served was the app as it looked on seed day. The sync is the catch-up, by CONTENT the way the cloud brief's runner is seeded: a file whose bytes already match is not written, so a second run changes nothing and there is nothing to commit, and the manifests are compared against what the seed's transform would leave (the `file:` specs repointed absolute, plus the root's note) rather than against the checkout's relative specs, which differ by construction. One list of exclusions serves the seed and the sync (`node_modules`, a lockfile, `.omega`, `.cache`, `.temp`, `dist`, `.env` — what `tower/app/.gitignore` names — plus `.git` and `.DS_Store`, which the copy owes itself). A write that fails MID-walk is its own failure: the publish stops there, committing and building nothing, since half a refresh is the broken site the mint's abort exists to prevent. It may REMOVE only inside the top-level folders the app itself defines, where it is the only writer; the clone's root is shared with the runner's `brief/`, the heal's `.github/ISSUE_TEMPLATE/` and the roster's `data/repos.json`, so a root-level file the app retired is left alone rather than risking another step's work. It sits above the source push, so the refreshed project rides to the default branch in the same commit, and above the site switch, since the clone is the cloud brief's home too. A checkout with no `tower/app` beside its engine is a named skip and the clone is built exactly as it is. A sync that wrote a MANIFEST says so on the way back (`WK_HOME_SYNC_MANIFESTS`, since the return code is already spoken for), and the publish runs `npm --prefix <clone> install` before it builds (issue #130): the refreshed `package.json` used to arrive with nothing to install it, so the first publish after a tower dependency change failed loudly on the missing module until someone installed by hand. The flag only covers the run that wrote the manifest, so the trigger's memory is npm's own stamp: a manifest newer than the clone's `node_modules/.package-lock.json` — a switch-off run's leftover, or a failed install's — asks for the install again, a page-only refresh installs nothing, and an install that FAILS aborts the run for the mint's reason.

**Then the mint, then the build.** `omega --service=assets` runs at the BRAND ROOT — the mirror image of the build, which resolves only inside the app — after a sync that changed something, on any clone that has never minted at all (every freshly seeded one, since `.omega` is among the trees the seed leaves behind), and whenever the last mint FAILED — the failure is remembered in a marker under the clone's gitignored `.omega`, because the failing sync's changes were already committed, so tomorrow's "already current" run would otherwise publish straight over it. A mint that FAILS aborts the run before the build: the sidebar and the og/twitter tags emit the minted paths unconditionally, so building on top of a failed mint publishes a public site with a broken logo, and a stale site beats that.

The build runs in the APP, not at the brand root: `omega build` is a command of `@omega.js/web` and resolves only inside `apps/web` (at the root the `omega` bin dispatches to `@omega.js/manager`, which has no build at all — probed 2026-07-29). So the build is `npm --prefix ~/.workkit/tower/apps/web run build`, and it writes `apps/web/dist/`.

The push uses a temporary `git worktree`, so main's working tree is never checked out over, and force-with-lease onto `gh-pages` alone — the branch carries nothing but generated files, so a rewrite is what a rebuild IS, and the lease still refuses to overwrite a push this machine has not seen. The pull is `--rebase --autostash`, and a pull that cannot finish — a divergence, an offline machine, a refused auth — publishes nothing and says the clone could not catch up; the engine never forces main. The autostash's own failure is caught too: a rebase that lands while the stash it took conflicts on the way back exits 0 over a tree full of conflict markers, so the surviving stash entry is checked for, the tree is put back exactly as the run found it, and nothing is built, committed or pushed. A `~/.workkit/settings.json` that does not parse is refused the same way rather than read as an absent one — and that check comes first, since the same file names the home repo. Whether the remote already carries `gh-pages` is probed with `ls-remote --exit-code`, whose three answers are kept apart: a branch, a remote that says there is none, and a remote that could not be reached at all — the last skips the publish with a warning instead of dropping the local branch on the way to a push that could never land.

**Nothing publishes until the owner says so.** `site.publish` is the whole decision and it is DEFAULT OFF — an absent key reads as off and only `true` publishes, so a machine that has not said yes builds nothing. It is all or nothing, whoever asked for the run: `workkit publish` skips exactly as the daily job does. When it is on, the engine builds and pushes and assumes Pages will serve it — whether the account's plan actually serves Pages on a private repo is the owner's problem, never the engine's (owner ruling, 2026-07-29): no plan detection, no visibility check, no warning gate.

**Off means there is no site, not just no update** (issue #113). A run that finds the switch off while the home remote still carries `gh-pages` TAKES THE SITE DOWN: the branch is deleted (and the stale local copy with it), Pages is disabled through `gh api -X DELETE repos/<home>/pages` — a 404 there is "already off", not a failure — and both removals are logged. The branch is generated content and the next yes rebuilds it from scratch, so nothing is lost. A machine that never published has nothing to remove and hears nothing at all, and an unreachable remote is never torn down on a guess.

**The roster is not part of the site** (issue #111). `data/repos.json` on the home repo's default branch feeds the CLOUD BRIEF as well as the published dashboard, so it is composed and pushed ABOVE the publish switch and above every build check — it needs node, git and the clone, and nothing that publishing needs. A machine with the switch off, or without the tooling to build, still leaves the brief a current list. A compose that FAILS is not a machine with no repos on it (issue #116): an unreadable `.repos.json` raises instead of composing the empty list, so the file already published stays exactly as it is and the run warns and carries on — a stale-but-good roster is the designed outcome, which is why it is a warn and not the exit code. Whatever else the day changed in the clone rides in the same commit — one `chore(home): refresh the repo list`, or `chore(home): sync the tower project` when the sync above is why there is a commit at all; a push that does not land is warned about and carries out as the exit code, and never costs the site a publish it can still make.

**Nothing is baked in but the home repo.** The published site reads GitHub live from the browser with the viewer's own token (issue #81), so no issue data is ever written into what Pages serves — which matters, because Pages is PUBLIC even when the repo serving it is private. The one file the publish adds beside the pages is `data/home.json`: the repo the site is served from, and the branch of it the roster is on (issue #112 — the publish pushes whatever branch the clone is on, and a reader assuming `main` 404s on a home repo that is not; a branch name says nothing more once the repo is known). The ROSTER goes to that branch as `data/repos.json` — the `owner/name` slugs to sweep, plus `home`, the repo whose Discussions carry the published summaries — because repo names are private when the repos are (issue #110); the page reads it at the branch the pointer names, the cloud brief at the one GitHub reports as the repo's default, each with a token it already holds. It has no timestamp, so an unchanged roster is a byte-identical file and no commit at all; without node on the machine it cannot be composed, and the run names both readers of the list that is now stale. `site.url` set writes the CNAME into the published branch.

The build is LOCAL and never a GitHub Action: the app consumes `@omega.js/*` by `file:` spec from a sibling omega checkout, which no CI runner has. On a machine without that checkout `npm install` still exits 0 and leaves dangling symlinks under `node_modules/@omega.js` (probed 2026-07-28), so the tooling check is the presence of `~/.workkit/tower/node_modules/.bin/omega` — an install's success proves nothing. Every reason not to publish (no home clone, no tooling, a clone that could not catch up, a conflicting autostash, an unparseable settings file, an unreachable remote, no `tower/app` to sync from, nothing changed) is a named skip with exit 0; only a mint, a build or a copy that actually failed — or the roster push above, which fails the run without stopping it — exits non-zero.

`workkit publish` runs it on demand, a human's `workkit update` runs it too, and `jobs/morning.sh` runs it after the morning brief — never before, and never in `update --auto`: a session start has no business spending minutes on an app build.

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
