# Setting up workkit

- How workkit gets onto a machine and into a repo.
- The short path is in the [README](../README.md); this page is every step behind it.
- The engine's own reference, with each step's edge cases, is [`workflow/README.md`](../workflow/README.md).

## Install

- Install the plugin from GitHub; no clone is needed:

```sh
claude plugin marketplace add ITW-Creative-Works/workkit
claude plugin install workkit@workkit
```

- That brings the hooks, agents and skills.
- The `workkit` command, the schedule and the home repo come from setup.
- Until setup has run, every session asks you to run it and names the command.
  - The command is `bash <the engine in the plugin cache>/workkit.sh setup`, its path spelled out for your machine.
- Setup runs from the plugin cache as it does from a clone.
  - The engine's address (`~/.claude/workkit`) takes the cached copy, and the 9am job runs through that address.
  - So a plugin update that repoints it keeps the schedule current with no reinstall.
- To work on workkit itself, install from a clone instead.
  - Setup installs the plugin from that clone, and a clone outranks the plugin cache:

```sh
git clone https://github.com/ITW-Creative-Works/workkit.git
cd workkit
./workflow/workkit.sh setup
```

- A checkout you already have registers the same way as GitHub does:

```sh
claude plugin marketplace add <path-to-checkout>
claude plugin install workkit@workkit
```

- Plugins load when a session starts.
  - So a new (or restarted) session is what puts an install or an update into effect.

## What setup does

- `./workflow/workkit.sh setup` runs from the plugin cache or from a clone of this repo (see [Install](#install)).
  - It goes through these steps in order, under six titles.
  - Each step checks before it acts, so a second run only fixes what is missing.
- You rarely run it yourself.
  - When a hook or a message says setup is needed, your agent runs it for you.
  - It hands you the one thing only you can do.
- There are three things only you can do:
  - approving the sign-in code in your browser;
  - clicking the App's install on GitHub (`workkit setup --bot` opens that page);
  - running `claude setup-token`.
- For the sign-in, your agent starts `workkit setup --login`.
  - It reads the page and the code off its output while it waits, and hands them to you.
- Setup also has three choices it asks only at a terminal:
  - whether to turn workkit on for this repo;
  - whether to publish the dashboard;
  - whether to create your home repo.
- Your agent asks you each one in chat instead. It applies all three itself:
  - `workkit enable` for the repo;
  - `site.publish` in `~/.workkit/settings.json` for the dashboard;
  - `workkit setup --home` for the home repo.
- **This machine**

  1. **The plugin.** Installs workkit into Claude Code from the copy setup runs from, unless it is already installed.
     - A machine without the `claude` CLI gets a named skip, never a failure.
  2. **GitHub.** Checks that `gh` is installed and signed in.
  3. **The engine's address.** Points `~/.claude/workkit` at the `workflow/` folder of the copy setup runs from (see [The engine's address](#the-engines-address)).
  4. **The `workkit` command.** Links it into `~/.local/bin`, and the `gh` shim beside it (see [The bot identity](#the-bot-identity)).
     - When that folder is not on your PATH, setup prints the `export` line to add; it never edits a shell rc file.
  5. **npm's script shell.** Points npm's `script-shell` setting at the kit's wrapper.
     - From then on a root `npm test` records the tree it proved.
     - It lints any new CHANGELOG entry before the suite starts.
     - It keeps running if the call that started it is cut, and logs to `.workkit/suite.log`.
     - The kit's own wrapper reached through a linked folder reads as current.
     - A value someone else set is warned about and left alone.
     - The setting is made only when the wrapper exists behind the engine's address.
     - With that link missing, setup prints a named skip and `script-shell` stays unset.
     - On Windows, setup first builds the kit's script shell with the compiler every Windows ships.
  6. **The allow rules.** Adds the kit's allow rules (`ALLOW_RULES` in `workflow/workkit/allow.sh`) to `permissions.allow` in `~/.claude/settings.json`.
     - This is so auto mode does not block the commands a ship or a review runs.
     - Every `workkit ship` command is listed but `deploy`, so a deploy outside a ship prompts.
     - A retired rule the kit once kept (`Bash(workkit ship:*)`, which let a deploy through) is taken out, and doctor names one still there.
     - Only the missing rules are added, after the ones already there, and every other key stays as it is.
     - A file that holds them all and no retired one is not written.
     - A settings file that is a link is written at its target.
     - A missing one is created holding only the rules.
     - One that is not valid JSON is left alone and warned about by a human's run and by doctor, never by the daily run.
     - `workkit update` and the daily `update --auto` keep the rules too (the daily run creates no `~/.claude`).
     - `workkit doctor` names each one that is missing.
  7. **The 9am schedule.** Loads the daily-brief schedule through `jobs/install.sh`.
     - This is macOS only (launchd); everywhere else the brief runs in the cloud.
  8. **The dashboard.** Says how to start it: `workkit tower`, the local one of the [three ways to see your board](#three-ways-to-see-your-board).
- **Home repo**

  9. **The repo.** Creates your private home repo, `<login>/workkit`, after one confirm, and clones it into `~/.workkit/tower` (see [The home repo](#the-home-repo)).
     - Without a terminal it creates nothing and names `workkit setup --home`.
     - `workkit setup --home` runs the Home repo steps alone and asks nothing, with or without a terminal.
  10. **The cloud brief.** Copies the brief's GitHub Actions workflow, and the code it runs, into that clone.
- **Cloud brief secrets**

  11. **The brief's two secrets.** Sets them on the home repo, never on this one: this repo is the plugin everybody installs.
      - The Claude token is minted only if you say yes at the prompt.
      - The GitHub token is set from the `gh` login your machine already has.
- **Identity**

  12. **The bot identity.** Says whether this machine is signed in to workkit.
      - That is the one sign-in that lets the agent's issue bookkeeping post as `workkit-agent[bot]`.
      - Not signed in at a keyboard, it asks whether to sign in now (Enter is yes).
      - It opens GitHub's device page in your browser and prints the code to enter there.
      - Then it finishes the sign-in itself once you approve it.
      - A no, or no keyboard, prints a warning naming `workkit setup --login`.
      - `workkit setup --login` runs this step alone with or without a terminal, and asks nothing.
      - It signs you in again even when you already are.
      - A machine without Node or jq gets a named skip (see [The bot identity](#the-bot-identity)).
- **Dashboard site**

  13. **Publishing.** Asks once whether to publish your own copy of the dashboard to GitHub Pages.
      - A fresh yes also asks for a custom domain.
      - Then it publishes the site and hands your `gh` login token to its Settings page.
- **This repo**

  14. **Joining.** Offers to turn workkit on for the repo you are standing in.
  15. **The App's install.** Signed in, in a repo opted in to workkit (its committed `.workkit/settings.json` says enabled), it asks the token service whether `workkit-agent[bot]` is installed there.
      - When it is not, it builds the App's install page pre-selected on the repo's owner.
      - The owner is read through GitHub's repo endpoint before the service is asked.
      - So an owner renamed since the clone was made is asked for and named by its new login.
      - When GitHub cannot say who the owner is, it warns `owner id unreadable from GitHub, retry` and opens nothing.
      - At a keyboard it asks whether to install it there now (Enter is yes), and opens that page in your browser.
      - Then it waits, asking the service again every 15 seconds: Enter checks now, `s` skips.
      - Installed, it says so; a no, a skip, or no keyboard prints a warning naming the same page.
      - `workkit setup --bot` runs this step alone, in any repo with a GitHub origin, opted in or not.
      - It exits 1 unless the App ends installed.
- **In a cloud session** (claude.ai/code, where `CLAUDE_CODE_REMOTE` is `true`), run `workkit setup --cloud` instead.
  - It checks the gh login as setup and doctor do everywhere.
  - It makes the engine's address, the `workkit` command and the `gh` shim (creating `~/.local/bin`).
  - It points npm's `script-shell` at the kit, and adds the kit's allow rules to `~/.claude/settings.json`.
  - The bot does not act there: the session's GitHub proxy signs every request as your account.
    - So the `gh` shim serves the kit's issue, label, auth, pr and release verbs through REST as you ([gh in a session](cloud.md#gh-in-a-session)).
    - Nothing signs in.
  - Every other step prints one not-applicable line: the plugin, the schedule, the tower, the home repo, the cloud brief's secrets, the sign-in, publishing, joining, the App's install.
  - It asks nothing and opens nothing.
  - `standards.sh --command-link` makes the command link alone, for a bootstrap that runs no setup at all.
  - A cloud bootstrap that does run setup calls `workkit setup --cloud`, which makes the link itself.
  - In the cloud, `workkit doctor` likewise shows the schedule, the home repo, its runner, the secrets and the sign-in as not applicable.
    - It counts none of them.
- Afterwards, `workkit doctor` reports what is set up and what has drifted.
- `workkit help` is the map of every command.

## The bot identity

- The agent's issue bookkeeping (claims, parks, `Proof:` lines, labels, closes) posts as `workkit-agent[bot]`.
  - So the record tells your acts from the agent's.
- Only a call that writes goes to the bot.
  - A read (`list`, `view`, `status`, `checks`, `diff`) posts nothing and runs as you, and so do commits and pushes.
- **One App, installed once per account or org.** `workkit-agent[bot]` is a single GitHub App, registered once under ITW-Creative-Works.
  - It has three permissions: Issues write, Pull requests write and Metadata read.
  - Each account or org installs it once from <https://github.com/apps/workkit-agent> on the repos workkit is on.
  - The install is an owner's click on GitHub, never automatic.
  - Setup offers the page for the repo it stands in, opened with the repo's owner already selected.
  - The install is required. On a repo without it, the agent's bookkeeping call stops with a message naming the owner and that page.
    - On the next line the message says `or run: workkit setup --bot`, which is how any other org gets it.
    - When GitHub cannot give the owner's id, the message names the owner as sent and says `owner id unreadable from GitHub, retry`, with no page and no hint line.
    - Nothing is posted as you instead.
- **Sign in once per machine.** Setup, or `workkit setup --login`, runs GitHub's device flow:
  - it prints `Open <page> and enter the code <code>`;
  - it opens that page in your browser when it finds a browser opener;
  - you approve the code there, and it prints `Signed in as @<you>`.
  - The sign-in is kept in `~/.workkit/identity/login.json`, readable only by you, and replaces any sign-in already there.
  - There is no sign-out command, so to sign out, remove `~/.workkit/identity/login.json`.
  - A bookkeeping call at a terminal with no sign-in signs you in on the spot and carries on.
  - Away from a terminal it stops and names `workkit setup --login`.
- **The key stays off your machine.** The App's private key is held by the hosted token service at `https://workkit.itwcreativeworks.com/token` and never reaches yours.
  - The service checks that the App is installed on the repo and that your sign-in can write to it.
  - Then it hands back the bot's one-hour token for that repo.
- **Setup and `workkit doctor`.** Setup asks to sign you in at a keyboard, and names `workkit setup --login` on a no or anywhere else.
  - In a repo opted in to workkit, setup also offers the App's install page when the App is missing there.
    - The page is pre-selected on the owner as GitHub names it now (read through the repo endpoint, which follows a rename).
  - `workkit setup --bot` offers it in any repo.
  - No page is ever offered without the owner selected.
  - Doctor says `signed in as @<you>` or `not signed in; run workkit setup --login`.
  - Inside a repo that is on this machine's roster, doctor also says whether `workkit-agent[bot]` is installed on it.
    - When it is not, doctor gives the install page and `workkit setup --bot`.
  - In a cloud session, where the bot does not act, both print one line in their place: `identity: not applicable in a cloud session; the session's GitHub proxy signs every call as the account`.
- **For the App's owner.** The App's settings keep Device Flow on and "Expire user authorization tokens" off.
  - The reason: a sign-in has no way to refresh itself.
- How the shim, the tokens and the cache work: [`workflow/README.md`](../workflow/README.md#the-bot-identity).

## The engine's address

- The engine is the plain shell and Node code in `workflow/`.
- Its stable address is `~/.claude/workkit`, a link to the engine's `workflow/` folder, in a clone or in the plugin cache.

- The daily heal installs the link itself the first time a session runs it in a repo that has workkit turned on. It does so only from a real engine (a clone of workkit or the plugin's cached copy), so a test copy never takes the machine's address, and a clone keeps it over the cache.
- A machine whose repos have not joined yet gets the same link from `workkit setup` or `workkit update`.
- The skills, and anything scripting the standard directly, reach the engine there. The hooks find it from their own location, so they never wait on the link.

## Keeping current

- Once a day per repo, the session-start heal runs `workkit update --auto`.
- It re-renders the 9am schedule when the job template changed.
  - The job runs through the engine's address, so a moved kit or a plugin update needs nothing.
- It only ever updates a schedule you already installed; a machine with none never gets one this way.
- It never creates a folder your machine does not already have.

## The home repo

- Setup creates one private repo, `<login>/workkit`, and clones it into `~/.workkit/tower`.
- It holds the work that belongs to no single project:
  - **Its issues** are the cross-project queue, and the nursery for projects that do not exist yet.
    - A capture made outside every project lands there directly.
    - Every triage run, from any repo, drains them.
    - It proposes turning a cluster of related captures into a real repo; nothing is created without your word.
  - **Its Discussions** are where the daily summaries and the morning brief are published.
  - **Its `gh-pages` branch** is the dashboard, built on your machine and served by GitHub Pages, so you can read the board from a phone.
    - The published site holds no data: it talks to GitHub live, with a token you paste into that browser once.
    - It can read, move and file issues just as the local dashboard does.
- The clone is the dashboard as a real site project, seeded from this kit's `tower/app`.
  - It belongs to the engine: it carries nothing hand-written, not even a `.workkit/` folder of its own.
  - Nothing generated is committed as source, and the engine never force-pushes its main branch.
  - `workkit doctor` reports where the clone stands.
- `~/.workkit` itself is a plain folder holding what only this machine knows, split by who writes it:
  - `settings.json` is yours to edit. It holds:
    - the site options: which repo the site publishes from, whether it publishes at all, any custom domain, and your own sidebar link groups ([`workflow/README.md`](../workflow/README.md#the-two-settings-files) § The two settings files);
    - the bot identity's `identity.tokenUrl`, the token service's address, the hosted one when absent;
    - `findings.file`, whether an agent files its findings as issues instead of saying them in chat (off when absent; a repo's own `.workkit/settings.json` can override it);
    - `docs.bullets`, whether a markdown write must keep the doc shape (off when absent; a repo's own `.workkit/settings.json` can override it);
    - `docs.paths`, which markdown that check judges (the kit default when absent, [`hooks.md`](hooks.md) § `docs:board-guard`; a repo's own `.workkit/settings.json` can override it).
    - It starts holding no setting: an absent key reads the kit's default from `defaults/settings.json`.
    - Setup asks the publish question once and never again.
  - `.repos.json` is the engine's list of repos on this machine, plus the ones you declined.
  - `.cache.json` is throwaway state, and `jobs/` is the daily job's state.
  - `morning.d/` is yours too: every executable `*.sh` in it is the 9am job's sixth step, run in name order ([`jobs/README.md`](../jobs/README.md#the-morning-on-this-machine)).
- The full rules for this global layer: [`project-state.md`](project-state.md) § The global layer.

## Three ways to see your board

- The dashboard comes in three tiers.
  - Each reads the same issues on GitHub, so you can use any of them and switch any time.
- **The central copy, out of the box.** Open <https://itw-creative-works.github.io/workkit/>.
  - It is the kit's own GitHub Pages site for now, so the address may move.
  - Paste a GitHub token once on its Settings page, which lists the permissions the token needs.
  - The token stays in that browser. [`tower/README.md`](../tower/README.md#the-three-modes) has the detail on tokens.
  - The site holds no data and reads GitHub live.
  - It finds your home repo, `<login>/workkit`, from the token, so it needs no copy of your own.
  - It is rebuilt on every workkit release.
- **The local tower.** `workkit tower` serves the dashboard on this machine through your `gh` login, so it asks for no token.
  - It is the only tier that shows the running agents, token spend and repo health, since those live on the machine.
- **Your own published copy.** `workkit publish` puts the dashboard on your home repo's GitHub Pages.
  - It is for a custom domain or full control over what is served.
  - Setup asks once whether to publish (step 13).
  - [The home repo](#the-home-repo) says how the copy is built and what it holds.

## Opting a repo in

- Participation is deliberate. Nothing is written into a repo until someone says yes.
- `workkit enable <repo>` writes that repo's committed `.workkit/settings.json` yes, `{ "enabled": true }`, then brings it to the standard.
  - That line is the only yes: a repo with no settings file, an empty one, or one with no `enabled` key is off.
  - A `true` in `~/.workkit/settings.json` turns no repo on.
- `workkit decline <repo>` records your personal no in `~/.workkit/.repos.json`, outside the repo.
- A repo that has answered neither hears one offer per session and is never written to.
- Every other setting has its default in the kit's `defaults/settings.json`.
  - Your `~/.workkit/settings.json` overrides a default for every repo on the machine.
  - A repo's own `.workkit/settings.json` overrides both, key by key ([`project-state.md`](project-state.md) § The model).
- The commands underneath are `workflow/standards.sh --enable` and `--decline`.

## Layout

```
.claude-plugin/   plugin.json + marketplace.json (this repo is its own marketplace)
hooks/            hooks.json + the hooks module (register.js, mods/) + the shell library the scripts source
agents/           the crew (namespaced workkit:<name>)
briefs/           the role brief templates, one per crew job (the manager fills the slots)
skills/           the nine workflow skills (namespaced workkit:<name>)
workflow/         the agent-agnostic engine, and the scripts behind its verbs (workkit review covers is the ship's review tier)
tower/            the dashboard: api/ (the JSON API) + app/ (the OMEGA dashboard)
jobs/             the 9am job: summaries, brief, publish: payload builders, runners, launchd schedule
docs/             project-state.md (the spec) · agents.md (the crew contract) · hooks.md (what each hook does) · setup.md (this page) · cloud.md (remote provisioning) · history-purge.md (the rewrite runbook) · assets/ (the README's hero and mark)
test/             npm test
```
