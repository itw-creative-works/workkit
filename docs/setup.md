# Setting up workkit

How workkit gets onto a machine and into a repo. The short path is in the [README](../README.md); this page is every step behind it. The engine's own reference, with each step's edge cases, is [`workflow/README.md`](../workflow/README.md).

## What setup does

`./workflow/workkit.sh setup`, run from a clone of this repo, goes through these steps in order, under five titles. Each step checks before it acts, so a second run only fixes what is missing.

**This machine**

1. **The plugin.** Installs workkit into Claude Code from this checkout. A machine without the `claude` CLI gets a named skip, never a failure.
2. **GitHub.** Checks that `gh` is installed and signed in.
3. **The engine's address.** Points `~/.claude/workkit` at this checkout's `workflow/` folder (see [The engine's address](#the-engines-address)).
4. **The `workkit` command.** Links it into `~/.local/bin`. When that folder is not on your PATH, setup prints the `export` line to add; it never edits a shell rc file.
5. **npm's script shell.** Points npm's `script-shell` setting at the kit's wrapper. From then on a root `npm test` records the tree it proved, lints any new CHANGELOG entry before the suite starts, keeps running if the call that started it is cut, and logs to `.workkit/suite.log`. A value someone else set is warned about and left alone. On Windows, setup first builds the kit's script shell with the compiler every Windows ships.
6. **The 9am schedule.** Loads the daily-brief schedule through `jobs/install.sh`. This is macOS only (launchd); everywhere else the brief runs in the cloud.
7. **The dashboard.** Says how to start it: `workkit tower`.

**Home repo**

8. **The repo.** Creates your private home repo, `<login>/workkit`, after one confirm, and clones it into `~/.workkit/tower` (see [The home repo](#the-home-repo)).
9. **The cloud brief.** Copies the brief's GitHub Actions workflow, and the code it runs, into that clone.

**Cloud brief secrets**

10. **The brief's two secrets.** Sets them on the home repo, never on this one: this repo is the plugin everybody installs. The Claude token is minted only if you say yes at the prompt. The GitHub token is set from the `gh` login your machine already has.

**Dashboard site**

11. **Publishing.** Asks once whether to publish the dashboard to GitHub Pages. A fresh yes also asks for a custom domain, then publishes the site and hands your `gh` login token to its Settings page.

**This repo**

12. **Joining.** Offers to turn workkit on for the repo you are standing in.

Afterwards, `workkit doctor` reports what is set up and what has drifted, and `workkit help` is the map of every command.

## The plugin alone

If you want only the hooks, agents and skills, install the plugin straight from GitHub, with no clone:

```sh
claude plugin marketplace add ITW-Creative-Works/workkit
claude plugin install workkit@workkit
```

Or from a checkout you already have:

```sh
claude plugin marketplace add <path-to-checkout>
claude plugin install workkit@workkit
```

The `workkit` command, the schedule and the home repo still come from setup, and until it has run, every session asks you to run it.

Plugins load when a session starts, so a new (or restarted) session is what puts an install or an update into effect.

## The engine's address

The engine is the plain shell and Node code in `workflow/`. Its stable address is `~/.claude/workkit`, a link to this checkout's `workflow/` folder.

- The daily heal installs the link itself the first time a session runs it in a repo that has workkit turned on. It does so only from a real checkout, so a test copy never takes the machine's address.
- A machine whose repos have not joined yet gets the same link from `workkit setup` or `workkit update`.
- The skills, and anything scripting the standard directly, reach the engine there. The hooks find it from their own location, so they never wait on the link.

## Keeping current

Once a day per repo, the session-start heal runs `workkit update --auto`. It re-renders the 9am schedule when the checkout moved or the job template changed.

- It only ever updates a schedule you already installed; a machine with none never gets one this way.
- It never creates a folder your machine does not already have.

## The home repo

Setup creates one private repo, `<login>/workkit`, and clones it into `~/.workkit/tower`. It holds the work that belongs to no single project:

- **Its issues** are the cross-project queue, and the nursery for projects that do not exist yet. A capture made outside every project lands there directly. Every triage run, from any repo, drains them, and proposes turning a cluster of related captures into a real repo; nothing is created without your word.
- **Its Discussions** are where the daily summaries and the morning brief are published.
- **Its `gh-pages` branch** is the dashboard, built on your machine and served by GitHub Pages, so you can read the board from a phone. The published site holds no data: it talks to GitHub live, with a token you paste into that browser once, and can read, move and file issues just as the local dashboard does.

The clone is the dashboard as a real site project, seeded from this kit's `tower/app`. It belongs to the engine: it carries nothing hand-written, not even a `.workkit/` folder of its own. Nothing generated is committed as source, and the engine never force-pushes its main branch. `workkit doctor` reports where the clone stands.

`~/.workkit` itself is a plain folder holding what only this machine knows, split by who writes it:

- `settings.json` is yours to edit: the site options (which repo the site publishes from, whether it publishes at all, and any custom domain). Setup asks the publish question once and never again.
- `.repos.json` is the engine's list of repos on this machine, plus the ones you declined.
- `.cache.json` is throwaway state, and `jobs/` is the daily job's state.

The full rules for this global layer: [`project-state.md`](project-state.md) § The global layer.

## Opting a repo in

Participation is deliberate. Nothing is written into a repo until someone says yes.

- `workkit enable <repo>` writes that repo's committed `.workkit/settings.json` yes, then brings it to the standard.
- `workkit decline <repo>` records your personal no in `~/.workkit/.repos.json`, outside the repo.
- A repo that has answered neither hears one offer per session and is never written to.

The commands underneath are `workflow/standards.sh --enable` and `--decline`.

## Layout

```
.claude-plugin/   plugin.json + marketplace.json (this repo is its own marketplace)
hooks/            hooks.json + the hook groups, resolved via ${CLAUDE_PLUGIN_ROOT}
agents/           the crew (namespaced workkit:<name>)
briefs/           the role brief templates, one per crew job (the manager fills the slots)
skills/           the nine workflow skills (namespaced workkit:<name>)
workflow/         the agent-agnostic engine
tower/            the dashboard: api/ (the JSON API) + app/ (the OMEGA dashboard)
jobs/             the 9am job: summaries, brief, publish: payload builders, runners, launchd schedule
scripts/          four scripts: the review and triage markers, red-proof (the verifier's red run), review-covers (the ship's review tier)
docs/             project-state.md (the spec) · agents.md (the crew contract) · hooks.md (what each hook does) · setup.md (this page) · cloud.md (remote provisioning) · history-purge.md (the rewrite runbook) · assets/ (the README's hero and mark)
tests/            npm test
```
