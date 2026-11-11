# The jobs

- Scheduled work the kit runs.
- **One job, at 9am, in six steps, and one script that runs them**.
  - `jobs/morning.sh` is that script, and both schedulers invoke it.
  - The two schedulers: this machine's launchd agent, and the GitHub Actions workflow seeded onto the home repo.
- There is no laptop version and cloud version.
  - Each step asks whether the environment it woke up in has what that step needs.
  - A step that cannot run here says so by name.

| Step | What it needs | Where it runs |
|---|---|---|
| the **summaries** | this machine's session transcripts and git history | the Mac; a named skip on a runner |
| the **runner** | the kit beside this script, and the home clone | the Mac; a named skip on a runner, which IS the seeded copy |
| the **brief** | the sweep token and the roster, which live on the home repo | the **cloud**; on the Mac the step is the dispatch and nothing else |
| the **publish** | the home clone and its build tooling | the Mac; a named skip on a runner |
| the **marker** | a home that outlives the job, for a session to read the file in | the Mac; a named skip on a runner |
| the **morning.d** scripts | the owner's own `~/.workkit/morning.d` folder | the Mac; a named skip on a runner |

1. The summaries step goes first: it writes the day that just ended up and publishes it as a Discussion on the home repo.
2. Then the runner step refreshes the cloud brief's seeded copies on the home repo from this checkout.
   - It runs ahead of the dispatch that consumes them.
3. Then the brief reads the same payload the tower's Brief page draws, and hands it to Claude for a plain-language digest.
   - The digest publishes as a Discussion beside the summaries.
   - That Discussion is the durable copy, and the only place the upstream-news cursor is recorded.
4. Then the publish rebuilds the tower project in `~/.workkit/tower` and pushes the site to the home repo's `gh-pages` branch.
   - It runs after the brief has gone, so nothing about a build can delay nine o'clock.
5. Then the marker records the date of the newest brief actually on the board.
   - That is how a chat session learns that the cloud stopped posting.
6. Last, the owner's own scripts in `~/.workkit/morning.d` run, in name order.

- That order is the whole reason there is one cron and not two.
  - The morning is meant to read a record that already includes the day behind it.
- The window is a rolling 24 hours either way, so the reflection covers the same span: only its phase moves.
- It lives here rather than in a machine's own configuration because it is kit knowledge.
  - The roster, the board, the health, and `buildBrief` are all in this repo, and each step is one more reader of them.

## Install

```sh
bash jobs/install.sh
```

- Renders the plist into `~/Library/LaunchAgents/` and loads it.
- Idempotent: a second run with an unchanged plist confirms the agent is loaded and does nothing else.
- launchd expands nothing, so the plist names the job through the engine's address (`~/.claude/workkit/../jobs/morning.sh`).
  - A moved clone or a plugin update repoints that link and needs no re-run.
- **This script is also driven for you.** `workkit setup` runs it for the first install.
  - `workkit update` (which the standards hook calls once a day as `update --auto`) re-runs it when the job template changed.
  - So a changed template no longer waits for anyone to remember.
  - A moved clone needs no re-run, since the job is reached through the engine link.
- The drift question is `bash jobs/install.sh --check`.
  - It is the same render and compare, with nothing written and launchd never asked.
  - It prints one line per agent that is missing or out of date, and nothing at all when the machine matches.
- The CLI carries no second copy of what a current install looks like; that answer lives here.
- A schedule is only ever installed FRESH by a human: the automatic path updates and never introduces one.

## The pieces

| File | What |
|---|---|
| `morning.sh` | the one entry point, in both environments: the summaries, the runner reconcile, the brief (dispatched from here, composed and published on a runner), the site publish, the marker, and the owner's `morning.d` scripts, each gated by what the environment can do, one section per step. Locally it appends to `~/Library/Logs/claude-daily.log`; on a runner the Actions log is the log |
| `morning/` | the files only `morning.sh` uses: `brief-publish.sh` and the `brief/` folder, below. The cloud runner list seeds them beside it |
| `brief-dispatch.sh` | sourced where the dispatch is made: the one function that hands the day to the cloud (`gh workflow run brief.yml` on the home repo), with every guard and every named refusal. Two callers (the scheduled morning here, and `workkit brief`) and each decides what a refusal is worth |
| `morning/brief-publish.sh` | sourced on the cloud path: the one function that posts today's digest as a Discussion, check-before-post and category fallback included |
| `morning/brief/brief-payload.js` | the morning payload, on stdout: the digest instruction, then the brief as JSON, then the upstream news. Pure gather: no Claude, no notification |
| `morning/brief/cc-news.js` | every upstream Claude Code CHANGELOG entry since the last brief, organized by topic, read back off the latest published brief |
| `morning/brief/stats.js` | the `<!-- workkit-stats: … -->` line the published brief carries, the day in numbers: the open board by status, what the day closed, the inbox depth, each repo's open count. The only store the tower's history charts have; a failed sweep or an unusable stamp renders nothing, since a missing day is honest and a zero day is a cliff |
| `../workflow/templates/github-workflows/brief.yml` | what runs `morning.sh` on a runner: `workflow_dispatch` for the machine's trigger, a 17:30 UTC cron as the backup. It lives on the HOME repo, seeded there by setup; this is its source |
| `claude-nightly/nightly-payload.js` | the summaries payload: the reflection instruction, then the day's transcript INDEX and commits as JSON, or, with `--cadence weekly\|monthly`, the rollup instruction over the prior summaries handed in on stdin. Pure gather |
| `claude-nightly.sh` | the summaries step: composes the day, sends it, and posts it as a Discussion on the home repo, logging what it decided to `~/Library/Logs/claude-nightly.log` |
| `com.workkit.claude-daily.plist` | the schedule: 9:00 AM daily, `{{HOME}}` rendered at install, the job reached through the engine link |
| `install.sh` | render, compare, and only on change copy and reload |

- **`install.sh`**, the detail of its row:
  - "Loaded" means loaded from THIS plist.
    - So a label registered against some other path is re-registered rather than reported current.
  - launchd is machine-global, so a run whose `$HOME` is not the account's real home renders and copies but asks launchd nothing.
    - That run prints what it WOULD have loaded; `WORKKIT_LAUNCHD_OK=1` forces the calls.
  - `--check` is the same comparison as a report, touching neither disk nor launchd.

## Where the output goes

- **A job never writes into the checkout.** What runs here is machine state, not repo content.
  - It belongs to the machine that ran it, so a clone is never dirtied and a second checkout never disagrees with the first.
- Two homes, and no third:
  - state under `~/.workkit/jobs/` (whatever a job needs to remember);
  - logs under `~/Library/Logs/`.
- One file sits beside them rather than inside them: `~/.workkit/brief-status.json`, the marker step's output.
  - It lives with the machine's other settings because its reader is not a job at all but the `docs:session` hook.
- Nothing a job GENERATES is written anywhere.
  - A summary or a digest is a record, and records are published, never filed on a disk (the spec § The global layer).
- The payload scripts print. Their one write is `brief-payload.js`'s marks.
  - The marks are the cursor and stats lines `writeBriefMarks` puts in the scratch file `WORKKIT_BRIEF_MARK_FILE` names.
  - The runner appends them to the post.

## The payload

- `brief-payload.js` composes `/api/brief` without the tower.
  - Its parts: the roster read, the board sweep, per-repo health, then `buildBrief`.
  - These are the same modules under `tower/api/lib/`, so the morning notification and the Brief page cannot tell different stories.
- It needs no running server, which is the point: nothing has to be started for nine o'clock to work.
- **What the brief says beyond the counts**. `buildBrief` derives `nextUp` from the board it was already given.
  - Per repo, it lists the few open items this morning could actually move, in this order:
    - `status:blocked` first, because those wait on the owner;
    - then `status:complete`, which is QA passed and waits on the ship alone;
    - then `status:qa`, which waits on the owner one rung down;
    - then `status:specced`.
  - That is the same urgency order every section uses.
  - It lists three per repo at most, and a repo with nothing actionable is left out.
  - Within that order the board's dependencies have the last word.
    - An item still waiting on a blocker the sweep is carrying goes LAST in its repo's list and names which one.
    - The reason: a morning cannot move it.
- Onto that payload the composer attaches two more keys from `tower/api/lib/summaries.js`.
  - That file is the read side of the Discussions the summaries step publishes.
  - `findings` is the newest `daily: <date>` summary, every morning.
  - `week` is the newest `weekly: <date>` rollup, on MONDAYS only.
  - So there is one brief a day, richer on a Monday, rather than a second delivery.
- The attachment happens after `buildBrief` returns, in the same shape at both call sites (here and the tower's `/api/brief`).
  - That is what keeps the two payloads one payload.
- A summary that could not be read is `null` and a named `brief: no daily summary could be read from <slug>` line on stderr.
  - The line carries the read's own reason after it where there is one.
  - So a morning thinned by a spent rate limit says so, rather than reading as a night that produced nothing.
  - A machine with no home repo says nothing, having no board to have read.
- A sweep that failed prints as a failure (`ok: false` and its reason) and the digest says so.
  - "Nothing is waiting on you" and "gh could not answer" are opposite facts.

## The upstream news

- Claude Code releases most days and its CHANGELOG is the only announcement.
- So `cc-news.js` reads that file: the raw one on the default branch, no token and no rate limit.
  - It appends a `--- CC NEWS ---` block after the payload, carrying every entry since the last brief.
  - The entries are grouped by topic: the kit's own surfaces (hooks, agents, skills, plugins, settings, MCP, the statusline), then `other`.
- The job never judges which entries matter; the digest model does, with the board in view. It looks for:
  - a feature the kit could use;
  - a change that breaks something it built;
  - an improvement worth adopting.
- Finding out weeks late that a hook no longer matches the tool it hooks is the failure it exists to prevent.
- **Where it counted from lives on the board**, not on this machine.
  - Every published brief carries one machine-readable line, `<!-- cc-news: <version> -->`.
  - The next morning reads the newest `brief: ` Discussion on the home repo back to find it.
- `jobs/morning/brief/cc-news.js` owns that line's shape.
  - `writeBriefMarks` renders it into the scratch file `WORKKIT_BRIEF_MARK_FILE` names.
  - It sits beside the stats line `jobs/morning/brief/stats.js` composes.
  - The runner appends the file verbatim, so the writers and the readers cannot drift.
- A first run finds no brief and reports nothing.
  - With no cursor the honest "since" is the whole history, which would bury the brief.
  - It lets the publish carry the latest version instead.
- Every failure is silent: no block, and the brief still prints.
  - The failures: no network, a non-200, a body that is not a changelog, a `gh` that refuses.
- A board that could not be read is not an empty one: it publishes no version line either.
  - So the last brief that carried one stays the cursor, rather than re-seeding to the latest.
- When the upstream read failed but the board had a version, that version rides forward unchanged.
  - So the cursor never rewinds for want of a network.
- `WORKKIT_CC_CHANGELOG` overrides the source: a seam for the suite, which points it at a file on disk.

## The morning on this machine

- `morning.sh` does the summaries step first: it calls `claude-nightly.sh`, waits for it, and only then moves on.
  - That step keeps its own script, its own guards, and its own log.
  - Calling it is all the wiring there is, so neither half of the logic lives in two places.
- **A summaries failure is never the brief's failure**.
  - The exit status and output are logged as `[summaries exit N; the brief continues]`, and the morning carries on.
  - The reason: making sure nine o'clock says something is what the job is for.
- A hang is that failure without an exit status.
  - So the step is bounded at 15 minutes where `timeout` exists (homebrew coreutils, absent on a stock macOS).
  - Its 124 reads as any other failure.
- A machine with no `~/.claude/projects` has no day to read, and that is the step's gate.
  - It prints one named line and goes on to the next step.
- **The seeded runner is reconciled before the day goes over**.
  - The cloud composes the brief out of SEEDED COPIES of these scripts on the home repo.
  - Until now the only thing that refreshed them was `workkit setup`.
    - So a checkout that moved on kept publishing last month's brief until somebody remembered to re-run it.
    - That is how briefs went out for days carrying no stats line for the tower's history charts.
- The step is the engine's own `wk_home_seed_runner`, called from here every morning behind a `pull --rebase` of the clone.
  - The seed judges from the working copy.
  - So a clone another push left behind would seed over what the remote already carries, and commit what it can never push.
  - A pull that cannot finish skips the seed and says so.
  - A copy that moved is committed as `chore(home): refresh the cloud brief runner` and pushed.
  - One already current writes nothing, commits nothing, and says one dim line.
- It runs BEFORE the dispatch, because the cloud run the dispatch starts is what consumes it.
- It is the MACHINE's step.
  - On a runner `brief/` IS the code executing, and there is no checkout to seed it from.
- It creates, clones and enables nothing:
  - no home clone is a named line;
  - a push that did not land leaves the commit local for the next run;
  - the morning carries on either way.
- **Every seeded surface is reconciled daily**, this one last to join:
  - the tower project by the publish's sync;
  - the home repo's labels and issue forms by its heal;
  - this machine's schedule by `workkit update --auto`.
- A new seeded surface joins them at birth: a seed with no daily reconcile is a defect.

- **The brief here IS the dispatch**.
  - The scheduled brief is `gh workflow run brief.yml` on the **home repo**, the slug in `~/.workkit/settings.json`.
  - Only the scheduled brief does this; a `<message>` run and `--now` never do.
  - The reason: the home repo is where setup seeded the workflow and wrote the secrets.
- The dispatch itself lives in `brief-dispatch.sh`, sourced where it is used.
  - `workkit brief` is the same function on demand.
  - The only difference is that a refusal there is loud, because somebody asked for it just now.
- **The secrets are checked before the day is handed over:** one `gh secret list` on that same repo has to name BOTH `CLAUDE_CODE_OAUTH_TOKEN` and `WORKKIT_GITHUB_TOKEN`.
  - The reason: a dispatch succeeds the moment the workflow file is on the default branch, secrets or not.
  - A runner without the first composes nothing.
  - A runner without the second composes over a board it cannot read.
- A dispatch that lands is the whole brief.
  - The log records `brief: dispatched brief.yml on <slug>`, and nothing is composed or published here.
  - The morning's delivery is the Discussion the runner posts.
- **A dispatch that cannot be made is a briefless morning, and the log says why.**
  - There is no local fallback: the brief needs the sweep token and the roster, and both live on the home repo.
  - So every reason is named in one `brief: the day could not be handed to the cloud (<reason>); no brief this morning` line.
    - The reasons: no `gh`, no home repo, a listing that could not be read, either secret missing, a trigger that did not land.
    - The line goes in the log and on stderr, with nothing composed, sent, notified or posted.
  - The site publish still runs afterwards either way: the site is this machine's to build.
- **The marker is how a chat session hears that the brief stopped arriving**.
  - The brief is composed and published in the cloud, so its failures happen where nobody is looking.
  - A runner whose token expired posted nothing for ten mornings, and no session knew.
- A session start may reach no network at all, so the reading happens here.
  - It is one bounded `gh api graphql` for the newest `brief: `-titled Discussion on the home repo.
  - The prefix is required straight out of `tower/api/lib/history.js`, never a second literal.
  - The date off that title is written to `~/.workkit/brief-status.json`, whole and moved into place.
  - The file reads `{ "version": 1, "lastBrief": "<date>", "checkedAt": "<iso>" }`.
- The `docs:session` hook reads that file at every session start and names a brief older than one whole day.
- The marker runs after every other step but the owner's `morning.d` scripts.
  - That also gives this morning's dispatch the longest chance to have posted before the board is read.
  - A brief posted after it leaves a marker one day behind, which is the ordinary morning the hook is silent about.
- **It never writes a lie:** each of these leaves the existing marker exactly as it was and names the skip in the log:
  - no engine library beside it;
  - no `gh` or `jq`;
  - no home repo;
  - a read that did not answer;
  - a board carrying no brief.
  - The reason: a marker a day stale warns a day late, while an invented one never warns at all.

- **Your own scripts are the sixth step**.
  - To add one, put an executable `.sh` file in `~/.workkit/morning.d/` (`chmod +x` it).
  - A name prefix such as `10-` or `20-` sets the order, since the folder runs in name order.
- Each script gets its own block in `~/Library/Logs/claude-daily.log`, headed `--- <stamp> morning.d/<name> ---`.
  - Everything it prints on either stream goes under that header.
- It runs under the same 15-minute bound as the other steps, where `timeout` exists.
  - Its environment holds `LOG_FILE`, `MANUAL` (1 on a `--now` rehearsal) and `WORK_DIR`.
- A script that exits non-zero or runs past the bound gets a warning naming it.
  - The next one still runs, and the morning's own exit code never changes.
- A file that is not executable is skipped without a line, and a machine with no folder hears nothing.
- The scheduled morning and `--now` run the folder; a `<message>` run never reads it.
- A runner names the skip and reads nothing.
  - So does a checkout whose engine library is missing beside the job (`morning.d: the engine library is missing beside <dir>; skipped`).
  - The reason: the library names the folder.
- `morning.sh [message]` is otherwise a generic headless runner: an argument replaces the payload.
  - That is how you test a prompt without waiting for tomorrow.
  - It skips the summaries step and the publish for the same reason.
- It is hardened for launchd, where the environment is bare and the job is its own TCC identity:
  - **PATH is set by the script.** launchd provides almost none, so the job puts these ahead of it:
    - `~/.local/bin`;
    - an nvm default link, where the machine keeps one;
    - Homebrew's `/opt/homebrew/bin` and `/usr/local/bin` (where the nodejs.org installer puts node too).
    - A step that needs node and finds none logs `<step>: node is not on this machine's PATH: <the PATH>` and ends; the morning carries on.
    - A scheduled run only logs it; the `--now` rehearsal also prints it on stderr.
  - **The cwd is an empty scratch directory** under `~/Library/Caches/claude-daily`.
    - launchd starts a job at `/`, and Claude Code's startup scan from there trips macOS privacy prompts.
    - An empty directory gives it nothing to scan.
  - **The send is capped**: haiku, effort low, `--safe-mode`, no tools, no session persistence, and a hard budget of $0.25.
  - **The notification is detached.** Notifly does not return until it is dismissed, and the job must never wait on a human.
    - Its message is the response's first line, which is why the instruction fixes that line as `HEADLINE:`.
    - The app is looked for in `~/Applications`, then `/Applications`.
    - With neither, the log names the skip and nothing is shown.
- `morning.sh --now` (or `npm run brief`) is the REHEARSAL.
  - It is the one path that still composes and sends the brief here.
  - It uses the same payload the runner sends, the same log file, and a desktop notification.
  - So the brief can be tested without waiting for tomorrow or reading an Actions log.
  - It dispatches nothing, and its log block is stamped `(manual)`.
  - A missing node is said on stderr as well as logged.
  - It PUBLISHES NOTHING.
    - A run at noon that posted `brief: <today>` would make the nine o'clock brief find its own post already there and skip.
    - It would also advance the cursor on news that brief has yet to report.
- `NOTIFLY` overrides the notifier's path: a seam for the suite, so running the tests never puts a notification on screen.

## The brief is published

- The Discussion is the delivery.
  - The digest is published by whoever composed it, which is the runner, always.
- Once the send returns, it posts the digest response to the home repo as `brief: <date>`.
  - The response is the model's answer, never the payload it answered.
  - The title is the same convention the summaries keep.
- The category is asked for as `Brief`.
  - The name lives in `workflow/lib/discussions.sh`, where setup's check reads it too.
  - It is answered by the default-category fallback until the owner has made it, because categories cannot be created over the API.
  - The read-back filters on the TITLE for that reason, since it cannot know which category a repo landed in.
- The body's last line is the upstream version the brief covered.
  - A run that never had a version publishes no line at all.
- **Check before post.** A brief already on the board under today's title is not posted twice.
  - That is what lets the dispatch and its cron backup both fire on one morning.
- `jobs/morning/brief-publish.sh` is the one place that knows how to post it, and the cloud path is the only caller.
- **This machine publishes no brief at all:**
  - the scheduled morning composes nothing;
  - a `<message>` run is the generic headless runner;
  - `--now` is a rehearsal that must not claim the day's title.

## The brief runs in the cloud

- `brief.yml` runs `brief/jobs/morning.sh` on `ubuntu-latest`: checkout, Node LTS, `npm install -g @anthropic-ai/claude-code`, run.
  - It is the same script this machine runs; what differs is what the environment can do.
- **It runs on the HOME repo, not on this one**:
  - the plugin is distributed to everyone who installs the kit;
  - a consumer cannot set secrets on a repo they do not own;
  - a maintainer's credentials have no business on a distributed repo.
- `workkit setup` seeds the workflow and the code it runs into `<login>/workkit`.
  - The workflow goes at `.github/workflows/brief.yml`; everything else goes under `brief/`, with its checkout-relative paths intact.
  - This checkout stays their one source, refreshed by every morning run after it changes (`workflow/README.md` names the file list).
- It fires on `workflow_dispatch` (the machine's 9am trigger) and on a `30 17 * * *` cron.
  - The cron is after the local trigger window, so the machine gets the first shot.
  - The cron is the backup for the morning the machine was asleep.
- A concurrency group keeps the two from running at once.
  - The check-before-post makes any overlap that gets through harmless.
- The home repo is private, so those runs are BILLED against the account's Actions minutes.
  - The free allowance covers a daily brief many times over.
- **Only the brief travels.** The summaries read this machine's git history and its session transcripts.
  - The publish builds the home clone.
  - None of that exists on a runner, so both name their skip in the Actions log and stay on the Mac.
- **The cloud steps are gated on `GITHUB_ACTIONS`,** the variable Actions always sets.
  - Everything the cloud path writes goes into `~/.workkit`, and the roster it writes REPLACES what is there.
  - On a runner that folder dies with the job.
  - On a machine it is the real roster every other part of the kit reads.
  - A stray local run down that branch would leave synthetic cloud paths on the tower and in the next published slug list.
  - Off a runner that branch is never entered at all.

- **The runner has no roster,** so it builds one.
- The home slug is `GITHUB_REPOSITORY`.
  - The workflow lives on the home repo, so the repo the run belongs to IS the home, and nothing has to be configured to say so.
  - It is written into a synthetic `~/.workkit/settings.json` when there is not one already.
  - An existing file wins, and neither present refuses the run.
- The repos to sweep come from the one place this machine already wrote them: `data/repos.json` on the home repo's DEFAULT branch.
  - It is the same slug list the published dashboard reads.
  - It is private, because repo names are private when the repos are, and the read was always authenticated anyway.
- WHICH branch that is gets ASKED FOR (`gh api repos/<home> -q .default_branch`, falling back to `main`).
  - The reason: the writer pushes whatever branch the clone is on.
  - A hardcoded `main` is a 404, and a silently home-only board, on any repo whose default is named otherwise.
  - The published dashboard is told the same thing by `data/home.json`, which a runner has no site to read.
- For each slug the script makes the minimum `discoverRepos` actually consumes, and registers it in a synthetic `~/.workkit/.repos.json`.
  - That minimum is a directory carrying a committed `.workkit/settings.json`, and a git repo whose origin is that slug.
- Nothing else is faked.
  - There is no working tree, so health reads zeroes and a cloud brief carries no `ON THE TABLE` warnings.
- When the list cannot be fetched, the fallback is the **home repo alone**, whose issues are the cross-project queue.
  - The list cannot be fetched when no `workkit publish` has ever run on the machine, or the read itself failed.
  - An empty roster would let the digest say "nothing is waiting on you" about a board it never looked at.
- Publishing being OFF is no longer one of those reasons.
  - The roster is refreshed by every publish run whether or not a site is built.
- **Failures are loud here, deliberately.**
  - On the Mac every reason a step could not run is a logged line and exit 0.
    - The reason: launchd is nobody's screen, and the morning must not end on a red job.
  - In the cloud the Actions log IS the delivery (a runner has no desktop to notify).
    - So a payload that could not be composed, a send that failed, or a post that did not land exits non-zero and shows as a red run.
  - A brief already on the board is not a failure: it is the ordinary overlap, and it exits 0.
  - Each refusal names its own cause.
    - A missing `jq` is reported as a missing tool, not as a settings file that names no home repo.
    - An empty read would otherwise look like a settings file that names no home repo.
- **The digest never reaches the Actions log.**
  - It summarizes issues across private repos, and an Actions log belongs to a repo that could be made public one day.
  - The log gets proof of life instead: the response's first line and its byte count.
  - A send that failed is logged as its exit status and what the CLI said on stderr.
    - It is never logged as the payload it was handed or the half-answer it stopped on.
  - The Discussion is the delivery; the log is only the record that it happened.
- **What it needs, and `workkit setup` wires it**. Two secrets, on the HOME repo.
  - That is the repo the workflow was seeded onto, and the one the daily dispatch gates on:

| Value | Scope it needs | How setup sets it |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | the owner's Claude subscription | absent or near a year old → a `[y/N]` offer to run `claude setup-token` |
| `WORKKIT_GITHUB_TOKEN` | Issues read on every repo the published roster names; on the home repo, Contents read for that roster and **Discussions read** for the news cursor (the post itself is the built-in token's job, so this one needs no write anywhere) | absent → zero-click from `gh auth token`, no prompt |

- **`CLAUDE_CODE_OAUTH_TOKEN`**, the detail of its row:
  - The offer comes when the secret is absent, or last set more than ~11 months ago (the token lives about a year).
  - A yes mints it and pipes it straight into `gh secret set`.
  - The browser approval is a human click.
    - So without a terminal (or without the `script` utility the mint's pty needs) setup prints the two commands instead.
- A token value only ever moves through a pipe on its way to `gh secret set`'s stdin.
  - For the Claude mint, it also moves through the mint's own owner-only capture file, gone before the step returns.
  - It is never passed as an argument, echoed, or logged.
- `workkit doctor` re-checks both and warns on a value that is missing or past eleven months.
- The daily `workkit update --auto` warns and never mints.
- A machine with no home repo yet hears a named skip rather than a missing secret.
- **The `gh auth token` tradeoff.** No API mints a scoped PAT, so the zero-click path pushes the CLI's own login.
  - That login typically carries full `repo` scope, far more than the brief needs.
  - The owner accepted that for the automation it buys.
- The least-privilege alternative is a hand-made fine-grained PAT with exactly the scopes in the table.
  - Those are Issues read on each swept repo, plus Contents read and Discussions read on the home repo.
  - Set it with the same command setup uses, `gh secret set WORKKIT_GITHUB_TOKEN --repo <login>/workkit`.
  - Setup finds it present and leaves it alone from then on.
- The name may CONTAIN `GITHUB_`: GitHub refuses only names that START with it.
- **Two tokens, two jobs**. The Discussion is posted on the repo the run belongs to.
  - So the workflow's own built-in `GITHUB_TOKEN` is all it needs.
  - The `permissions:` block grants `discussions: write`, and the runner exports that token for the post alone.
- `WORKKIT_GITHUB_TOKEN` is the only credential that leaves the home repo.
  - It is the one `gh` authenticates with everywhere else.
- **That token sweeps the board**, so its reach decides how much of the board there is.
  - The runner asks for the issues of every slug in the home repo's `data/repos.json` with it.
  - A repo it cannot read comes back as a per-repo error rather than an empty one.
  - The composer prints `brief: <n> repos unreadable: <slugs>` on stderr.
  - That is the line in the Actions log that says the scope is short.
- The zero-click `gh auth token` path satisfies this by construction, since it carries the CLI's own login.
- A hand-made fine-grained PAT must SELECT those repos and grant Issues: Read on them.
  - That is on top of Contents read and Discussions read on the home repo.
- **The news cursor is read with this token too**: `cc-news.js` looks the last brief Discussion back up to find its "since".
  - That read happens during the composition, before the post swaps in the built-in token.
  - So a PAT without Discussions: Read on the home repo composes a silently news-less brief.
- Nothing is ever written into the workflow file or the log: the workflow names its secrets and never echoes them.

## The summaries step

- `claude-nightly.sh` writes the day that just ended up and PUBLISHES it.
  - It publishes a Discussion on the home repo named by `site.repo` in `~/.workkit/settings.json`, over the API.
  - So a machine with no clone still publishes.
  - It is never a file: generated records are never files, not on a machine, not in a repo.
- The daily summary goes in the `Daily` category.
- A weekly rollup goes on a Sunday, a monthly on the 1st.
- Each of the three is titled `<cadence>: <date>`.
- A rollup's inputs are the summaries ALREADY PUBLISHED, read back through the API.
  - It never reads the transcripts again, which the days already read.
- `workflow/lib/discussions.sh` is the one place that speaks that API. It:
  - resolves the repository and category node ids;
  - caches them in `~/.workkit/.cache.json` under `homeCache` (refreshed on a miss);
  - posts, and lists.
- **Categories cannot be created over the API.** There is no `createDiscussionCategory` mutation (probed against the live schema).
  - So `workkit setup` opens the page that makes them and polls until they are there.
  - Where it has no terminal, it prints the pointer.
  - Until they exist the summary publishes in the repo's default category, saying so in the log every time.
- **Two guards come before the composition.**
  - A cadence whose post for today is already on the repo is not posted twice.
    - The titles are fixed, so an exact title match answers it in one call.
    - So a job that re-fired writes one summary, not two.
  - A QUIET day is logged and skipped.
    - Quiet means no transcripts and no commits in the window, which is the payload's own `quiet` field.
    - A summary composed from nothing would be invention.
    - Publishing it would put invention in the archive the rollups read.
- `--now` (`npm run nightly`) BYPASSES both guards.
  - The reason: a person running it by hand has already decided they want a post.
  - It also stamps its log block `(manual)`.
- The send carries the three read tools and `--add-dir` on the transcripts root the payload indexed.
  - The reflection reads the day itself, so the grant and the index have to name the same root.
- It runs from an empty scratch directory with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, for the same TCC reason the brief does.
- Its stderr goes to the log; only its stdout is ever the published body.
- Every line either job writes wears the kit's one shape: a glyph for what happened, and the `task:` it belongs to.
  - The contract is `workflow/README.md` § Output.
  - A log block keeps its own `--- <date> <time> ---` header above the line.
  - The reason: a log file outlives the day the line's clock can name.
- Every reason not to publish is one timestamped block in `~/Library/Logs/claude-nightly.log`, and exit 0. The reasons:
  - `summaries: no home repo configured; skipped`;
  - a payload that could not be composed;
  - a Claude that answered with nothing;
  - an API that refused.
- A summary that cannot be posted is never written to disk instead.
- `WORKFLOW_HOME` overrides where it reads the settings file: the seam the suite uses.
- `nightly-payload.js` is the composer. It holds:
  - the reflection instruction;
  - the day's transcript INDEX: every `.jsonl` under `~/.claude/projects/` that moved in the last 24 hours, newest first, with size and mtime and no contents;
  - `git log --since="24 hours ago"` across the roster.
- `--cadence weekly|monthly` swaps in the rollup instruction and reads the prior summaries from stdin.
  - So the module stays a pure composer, and the API call stays with the step that holds the credentials.
- `WORKKIT_CLAUDE_PROJECTS` overrides the transcripts root: a seam for the suite.

## The publish step

- After the brief has gone, `morning.sh` runs `workflow/publish.sh --quiet`.
  - The tower project in `~/.workkit/tower` is rebuilt.
  - Its output is pushed to the home repo's `gh-pages` branch, where GitHub Pages serves it.
- It runs after the brief and only for the morning (a `morning.sh <message>` run publishes nothing).
- It is bounded by the same 15-minute `timeout`.
- Its every reason not to publish is a silent skip: no home repo, no build tooling, a diverged clone, nothing changed.
- A failure is logged as `[publish exit N; the brief was already sent]` and changes nothing about the morning.
- The mechanics are the engine's: `workflow/README.md` § Publishing the dashboard.

## Tests

- `test/jobs/` runs all seven against fixtures:
  - a scratch `~/.workkit` carrying a fixture roster for the payloads;
  - a fixture CHANGELOG and a fixture board of published briefs for the news;
  - a fixture projects tree with fixture mtimes for the transcript index;
  - a fake `claude` and notifier plus a scratch `HOME` and `WORKFLOW_HOME` for the entry point;
  - a `gh` answering the Discussions API with canned JSON, and for the cloud the contents API with a base64 slug list;
  - a recording `launchctl` for the installer.
- The entry point's suites are the two ENVIRONMENTS of the one script.
  - `morning-local` runs with `GITHUB_ACTIONS` stripped, and `morning-cloud` with it set.
  - The local one hands those same seams to the summaries step it calls.
- Nothing in the suite reaches the network, files an issue, loads an agent, or writes outside its temp directory.
