# Setting up workkit

How workkit gets onto a machine and into a repo. The short path is in the [README](../README.md); this page is every step behind it. The engine's own reference, with each step's edge cases, is [`workflow/README.md`](../workflow/README.md).

## Install

Install the plugin from GitHub; no clone is needed:

```sh
claude plugin marketplace add ITW-Creative-Works/workkit
claude plugin install workkit@workkit
```

That brings the hooks, agents and skills. The `workkit` command, the schedule and the home repo come from setup. Until setup has run, every session asks you to run it and names the command: `bash <the engine in the plugin cache>/workkit.sh setup`, its path spelled out for your machine.

Setup runs from the plugin cache as it does from a clone: the engine's address (`~/.claude/workkit`) takes the cached copy, and the 9am job runs through that address, so a plugin update that repoints it keeps the schedule current with no reinstall.

To work on workkit itself, install from a clone instead. Setup installs the plugin from that clone, and a clone outranks the plugin cache:

```sh
git clone https://github.com/ITW-Creative-Works/workkit.git
cd workkit
./workflow/workkit.sh setup
```

A checkout you already have registers the same way as GitHub does:

```sh
claude plugin marketplace add <path-to-checkout>
claude plugin install workkit@workkit
```

Plugins load when a session starts, so a new (or restarted) session is what puts an install or an update into effect.

## What setup does

`./workflow/workkit.sh setup`, run from the plugin cache or from a clone of this repo (see [Install](#install)), goes through these steps in order, under six titles. Each step checks before it acts, so a second run only fixes what is missing.

You rarely run it yourself: when a hook or a message says setup is needed, your agent runs it for you, and hands you the one thing only you can do. There are three: approving the sign-in code in your browser, clicking the App's install on GitHub, and running `claude setup-token`. For the sign-in, your agent starts `workkit setup --login`, reads the page and the code off its output while it waits, and hands them to you.

Setup also has three choices it asks only at a terminal: whether to turn workkit on for this repo, whether to publish the dashboard, and whether to create your home repo. Your agent asks you each one in chat instead. It applies all three itself: `workkit enable` for the repo, `site.publish` in `~/.workkit/settings.json` for the dashboard, and `workkit setup --home` for the home repo.

**This machine**

1. **The plugin.** Installs workkit into Claude Code from the copy setup runs from, unless it is already installed. A machine without the `claude` CLI gets a named skip, never a failure.
2. **GitHub.** Checks that `gh` is installed and signed in.
3. **The engine's address.** Points `~/.claude/workkit` at the `workflow/` folder of the copy setup runs from (see [The engine's address](#the-engines-address)).
4. **The `workkit` command.** Links it into `~/.local/bin`, and the `gh` shim beside it (see [The bot identity](#the-bot-identity)). When that folder is not on your PATH, setup prints the `export` line to add; it never edits a shell rc file.
5. **npm's script shell.** Points npm's `script-shell` setting at the kit's wrapper. From then on a root `npm test` records the tree it proved, lints any new CHANGELOG entry before the suite starts, keeps running if the call that started it is cut, and logs to `.workkit/suite.log`. The kit's own wrapper reached through a linked folder reads as current. A value someone else set is warned about and left alone. The setting is made only when the wrapper exists behind the engine's address; with that link missing, setup prints a named skip and `script-shell` stays unset. On Windows, setup first builds the kit's script shell with the compiler every Windows ships.
6. **The 9am schedule.** Loads the daily-brief schedule through `jobs/install.sh`. This is macOS only (launchd); everywhere else the brief runs in the cloud.
7. **The dashboard.** Says how to start it: `workkit tower`, the local one of the [three ways to see your board](#three-ways-to-see-your-board).

**Home repo**

8. **The repo.** Creates your private home repo, `<login>/workkit`, after one confirm, and clones it into `~/.workkit/tower` (see [The home repo](#the-home-repo)). Without a terminal it creates nothing and names `workkit setup --home`, which runs the Home repo steps alone and asks nothing, with or without a terminal.
9. **The cloud brief.** Copies the brief's GitHub Actions workflow, and the code it runs, into that clone.

**Cloud brief secrets**

10. **The brief's two secrets.** Sets them on the home repo, never on this one: this repo is the plugin everybody installs. The Claude token is minted only if you say yes at the prompt. The GitHub token is set from the `gh` login your machine already has.

**Identity**

11. **The bot identity.** Says whether this machine is signed in to workkit, the one sign-in that lets the agent's issue bookkeeping post as `workkit-agent[bot]`. Not signed in at a keyboard, it asks whether to sign in now (Enter is yes), opens GitHub's device page in your browser and prints the code to enter there, then finishes the sign-in itself once you approve it. A no, or no keyboard, prints a warning naming `workkit setup --login`, which runs this step alone with or without a terminal, asks nothing, and signs you in again even when you already are. A machine without Node or jq gets a named skip (see [The bot identity](#the-bot-identity)).

**Dashboard site**

12. **Publishing.** Asks once whether to publish your own copy of the dashboard to GitHub Pages. A fresh yes also asks for a custom domain, then publishes the site and hands your `gh` login token to its Settings page.

**This repo**

13. **Joining.** Offers to turn workkit on for the repo you are standing in.
14. **The App's install.** Signed in, in a repo opted in to workkit (its committed `.workkit/settings.json` says enabled), it asks the token service whether `workkit-agent[bot]` is installed there. When it is not, it builds the App's install page pre-selected on the repo's owner (the bare page when the owner's id cannot be read); at a keyboard it asks whether to install it there now (Enter is yes), opens that page in your browser, and waits, asking the service again every 15 seconds: Enter checks now, `s` skips. Installed, it says so; a no, a skip, or no keyboard prints a warning naming the same page.

Afterwards, `workkit doctor` reports what is set up and what has drifted, and `workkit help` is the map of every command.

## The bot identity

The agent's issue bookkeeping (claims, parks, `Proof:` lines, labels, closes) posts as `workkit-agent[bot]`, so the record tells your acts from the agent's. Only a call that writes goes to the bot: a read (`list`, `view`, `status`, `checks`, `diff`) posts nothing and runs as you, and so do commits and pushes.

- **One App, installed once per account or org.** `workkit-agent[bot]` is a single GitHub App, registered once under ITW-Creative-Works, with three permissions: Issues write, Pull requests write and Metadata read. Each account or org installs it once from <https://github.com/apps/workkit-agent> on the repos workkit is on; the install is an owner's click on GitHub, never automatic. Setup offers the page for the repo it stands in, opened with the repo's owner already selected. The install is required: on a repo without it, the agent's bookkeeping call stops with a message naming that page, which is how any other org gets it, and nothing is posted as you instead.
- **Sign in once per machine.** Setup, or `workkit setup --login`, runs GitHub's device flow: it prints `Open <page> and enter the code <code>`, opens that page in your browser when it finds a browser opener, you approve the code there, and it prints `Signed in as @<you>`. The sign-in is kept in `~/.workkit/identity/login.json`, readable only by you, and replaces any sign-in already there; there is no sign-out command, so to sign out, remove `~/.workkit/identity/login.json`. A bookkeeping call at a terminal with no sign-in signs you in on the spot and carries on; away from a terminal it stops and names `workkit setup --login`.
- **The key stays off your machine.** The App's private key is held by the hosted token service at `https://workkit.itwcreativeworks.com/token` and never reaches yours. The service checks that the App is installed on the repo and that your sign-in can write to it, then hands back the bot's one-hour token for that repo.
- **Setup and `workkit doctor`.** Setup asks to sign you in at a keyboard and names `workkit setup --login` on a no or anywhere else; in a repo opted in to workkit it also offers the App's install page when the App is missing there. Doctor says `signed in as @<you>` or `not signed in; run workkit setup --login`, and, inside a repo that is on this machine's roster, whether `workkit-agent[bot]` is installed on it, with the install page when it is not.
- **For the App's owner.** The App's settings keep Device Flow on and "Expire user authorization tokens" off, since a sign-in has no way to refresh itself.

How the shim, the tokens and the cache work: [`workflow/README.md`](../workflow/README.md#the-bot-identity).

## The engine's address

The engine is the plain shell and Node code in `workflow/`. Its stable address is `~/.claude/workkit`, a link to the engine's `workflow/` folder, in a clone or in the plugin cache.

- The daily heal installs the link itself the first time a session runs it in a repo that has workkit turned on. It does so only from a real engine (a clone of workkit or the plugin's cached copy), so a test copy never takes the machine's address, and a clone keeps it over the cache.
- A machine whose repos have not joined yet gets the same link from `workkit setup` or `workkit update`.
- The skills, and anything scripting the standard directly, reach the engine there. The hooks find it from their own location, so they never wait on the link.

## Keeping current

Once a day per repo, the session-start heal runs `workkit update --auto`. It re-renders the 9am schedule when the job template changed; the job runs through the engine's address, so a moved kit or a plugin update needs nothing.

- It only ever updates a schedule you already installed; a machine with none never gets one this way.
- It never creates a folder your machine does not already have.

## The home repo

Setup creates one private repo, `<login>/workkit`, and clones it into `~/.workkit/tower`. It holds the work that belongs to no single project:

- **Its issues** are the cross-project queue, and the nursery for projects that do not exist yet. A capture made outside every project lands there directly. Every triage run, from any repo, drains them, and proposes turning a cluster of related captures into a real repo; nothing is created without your word.
- **Its Discussions** are where the daily summaries and the morning brief are published.
- **Its `gh-pages` branch** is the dashboard, built on your machine and served by GitHub Pages, so you can read the board from a phone. The published site holds no data: it talks to GitHub live, with a token you paste into that browser once, and can read, move and file issues just as the local dashboard does.

The clone is the dashboard as a real site project, seeded from this kit's `tower/app`. It belongs to the engine: it carries nothing hand-written, not even a `.workkit/` folder of its own. Nothing generated is committed as source, and the engine never force-pushes its main branch. `workkit doctor` reports where the clone stands.

`~/.workkit` itself is a plain folder holding what only this machine knows, split by who writes it:

- `settings.json` is yours to edit: the site options (which repo the site publishes from, whether it publishes at all, and any custom domain) and the bot identity's `identity.tokenUrl`, the token service's address, the hosted one when absent. Setup asks the publish question once and never again.
- `.repos.json` is the engine's list of repos on this machine, plus the ones you declined.
- `.cache.json` is throwaway state, and `jobs/` is the daily job's state.

The full rules for this global layer: [`project-state.md`](project-state.md) § The global layer.

## Three ways to see your board

The dashboard comes in three tiers. Each reads the same issues on GitHub, so you can use any of them and switch any time.

- **The central copy, out of the box.** Open <https://itw-creative-works.github.io/workkit/>, the kit's own GitHub Pages site for now, so the address may move. Paste a GitHub token once on its Settings page, which lists the permissions the token needs. The token stays in that browser. [`tower/README.md`](../tower/README.md#the-three-modes) has the detail on tokens. The site holds no data and reads GitHub live; it finds your home repo, `<login>/workkit`, from the token, so it needs no copy of your own. It is rebuilt on every workkit release.
- **The local tower.** `workkit tower` serves the dashboard on this machine through your `gh` login, so it asks for no token. It is the only tier that shows the running agents, token spend and repo health, since those live on the machine.
- **Your own published copy.** `workkit publish` puts the dashboard on your home repo's GitHub Pages, for a custom domain or full control over what is served. Setup asks once whether to publish (step 12). [The home repo](#the-home-repo) says how the copy is built and what it holds.

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
