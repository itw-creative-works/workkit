# The jobs

Scheduled work the kit runs on this machine. **One job, at 9am, in three steps.** The **summaries step** goes first: it writes the day that just ended up and publishes it as a Discussion on the home repo. Then the **brief** reads the same payload the tower's Brief page draws and hands it to Claude for a plain-language digest, arriving as a desktop notification. Last, the **publish** rebuilds the tower project in `~/.workkit/tower` and pushes the site to the home repo's `gh-pages` branch — after the brief has already been sent, so nothing about a build can delay nine o'clock.

That order is the whole reason there is one cron and not two: the morning is meant to read a record that already includes the day behind it. The window is a rolling 24 hours either way, so the reflection covers the same span — only its phase moves.

It lives here rather than in a machine's own configuration because it is kit knowledge — the roster, the board, the health, and `buildBrief` are all in this repo, and each step is one more reader of them.

## Install

```sh
bash jobs/install.sh
```

Renders the plist for THIS checkout into `~/Library/LaunchAgents/` and loads it. Idempotent: a second run with an unchanged plist confirms the agent is loaded and does nothing else. Re-run it after moving the checkout — the plist carries absolute paths, because launchd expands nothing.

**This script is also driven for you.** `workkit setup` runs it for the first install, and `workkit update` (which the standards hook calls once a day as `update --auto`) re-runs it when the machine has drifted from this checkout — so a moved clone or a changed template no longer waits for anyone to remember. The drift question is `bash jobs/install.sh --check`: the same render and compare with nothing written and launchd never asked, printing one line per agent that is missing or out of date, and nothing at all when the machine matches. The CLI carries no second copy of what a current install looks like; that answer lives here. A schedule is only ever installed FRESH by a human — the automatic path updates and never introduces one.

## The pieces

| File | What |
|---|---|
| `brief-payload.js` | the morning payload, on stdout: the digest instruction, then the brief as JSON, then the upstream news. Pure gather — no Claude, no notification |
| `cc-news.js` | every upstream Claude Code CHANGELOG entry since the last brief, organized by topic, and the small mark file that remembers where it counted from |
| `claude-daily.sh` | the entry point: runs the summaries step, sends the payload headless, appends the exchange to `~/Library/Logs/claude-daily.log`, notifies, then publishes the site |
| `nightly-payload.js` | the summaries payload: the reflection instruction, then the day's transcript INDEX and commits as JSON — or, with `--cadence weekly\|monthly`, the rollup instruction over the prior summaries handed in on stdin. Pure gather |
| `claude-nightly.sh` | the summaries step: composes the day, sends it, and posts it as a Discussion on the home repo — logging what it decided to `~/Library/Logs/claude-nightly.log` |
| `com.workkit.claude-daily.plist` | the schedule — 9:00 AM daily, `{{WORKKIT_DIR}}` and `{{HOME}}` rendered at install |
| `install.sh` | render, compare, and only on change copy and reload. `--check` is the same comparison as a report, touching neither disk nor launchd |

## Where the output goes

**A job never writes into the checkout.** What runs here is machine state, not repo content: it belongs to the machine that ran it, so a clone is never dirtied and a second checkout never disagrees with the first. Two homes, and no third — state under `~/.workkit/jobs/` (the news mark today, whatever a later job needs to remember) and logs under `~/Library/Logs/`. Nothing a job GENERATES is written anywhere: a summary or a digest is a record, and records are published, never filed on a disk (the spec § The global layer). The payload scripts write nothing at all; they print.

## The payload

`brief-payload.js` composes `/api/brief` without the tower: the roster read, the board sweep, per-repo health, then `buildBrief` — the same modules under `tower/api/lib/`, so the morning notification and the Brief page cannot tell different stories. It needs no running server, which is the point: nothing has to be started for nine o'clock to work.

A sweep that failed prints as a failure (`ok: false` and its reason) and the digest says so. "Nothing is waiting on you" and "gh could not answer" are opposite facts.

## The upstream news

Claude Code releases most days and its CHANGELOG is the only announcement, so `cc-news.js` reads that file — the raw one on the default branch, no token and no rate limit — and appends a `--- CC NEWS ---` block after the payload carrying every entry since the last brief, grouped by topic (the kit's own surfaces — hooks, agents, skills, plugins, settings, MCP, the statusline — then `other`). The job never judges which entries matter; the digest model does, with the board in view: a feature the kit could use, a change that breaks something it built, an improvement worth adopting. Finding out weeks late that a hook no longer matches the tool it hooks is the failure it exists to prevent.

Where it counted from is one file the module owns, `~/.workkit/jobs/cc-news.json`, and it advances only once the payload has printed — a morning that died repeats its news rather than losing it. A first run records the latest version and reports nothing: with no mark the honest "since" is the whole history, which would bury the brief. Every failure is silent (no network, a non-200, a body that is not a changelog): no block, the mark untouched, the brief still prints. `WORKKIT_CC_CHANGELOG` overrides the source — a seam for the suite, which points it at a file on disk.

## The runner

`claude-daily.sh` is the entry point the agent runs, and it does the summaries step first: it calls `claude-nightly.sh`, waits for it, and only then composes the brief. That step keeps its own script, its own guards, and its own log — calling it is all the wiring there is, so neither half of the logic lives in two places. **A summaries failure is never the brief's failure**: the exit status and output are logged as `[summaries exit N — the brief continues]` and the morning carries on, because making sure nine o'clock says something is what the job is for. A hang is that failure without an exit status, so the step is bounded at 15 minutes where `timeout` exists (homebrew coreutils, absent on a stock macOS) — its 124 reads as any other failure.

`claude-daily.sh [message]` is otherwise a generic headless runner — an argument replaces the payload, which is how you test a prompt without waiting for tomorrow, and it skips the summaries step for the same reason. It is hardened for launchd, where the environment is bare and the job is its own TCC identity:

- **PATH is set by the script.** launchd provides almost none; node comes from `~/.nvm/default-bin`, which survives Node upgrades.
- **The cwd is an empty scratch directory** under `~/Library/Caches/claude-daily`. launchd starts a job at `/`, and Claude Code's startup scan from there trips macOS privacy prompts. An empty directory gives it nothing to scan.
- **The send is capped**: haiku, effort low, `--safe-mode`, no tools, no session persistence, and a hard budget of $0.25.
- **The notification is detached.** Notifly does not return until it is dismissed, and the job must never wait on a human. Its message is the response's first line, which is why the instruction fixes that line as `HEADLINE:`.

`claude-daily.sh --now` (or `npm run brief`) runs the whole thing on demand — the same payload, the same send, the same log file and notification — so the brief can be tested without waiting for tomorrow. Its log block is stamped `(manual)`, and it sets `WORKKIT_BRIEF_MANUAL` so the upstream-news mark stays where it is: a run at noon must not swallow the news the 9am job has yet to report.

`NOTIFLY` overrides the notifier's path — a seam for the suite, so running the tests never puts a notification on screen.

## The summaries step

`claude-nightly.sh` writes the day that just ended up and PUBLISHES it: a Discussion on the home repo named in `~/.workkit/settings.json` — over the API, so a machine with no clone still publishes — never a file (owner ruling, 2026-07-28: generated records are never files — not on a machine, not in a repo). The daily summary goes in the `Daily` category, a weekly rollup on a Sunday, a monthly on the 1st, each titled `<cadence>: <date>`.

A rollup's inputs are the summaries ALREADY PUBLISHED, read back through the API — never the transcripts again, which the days already read. `workflow/discussions.sh` is the one place that speaks that API: it resolves the repository and category node ids, caches them in the machine-local settings (refreshed on a miss), posts, and lists.

**Categories cannot be created over the API.** There is no `createDiscussionCategory` mutation — probed against the live schema — so `workkit setup` prints a one-time pointer at the page that makes them, and until they exist the summary publishes in the repo's default category, saying so in the log every time.

**Two guards come before the composition.** A cadence whose post for today is already on the repo (the titles are fixed, so an exact title match answers it in one call) is not posted twice — a job that re-fired writes one summary, not two. And a QUIET day — no transcripts and no commits in the window, which is the payload's own `quiet` field — is logged and skipped: a summary composed from nothing would be invention, and publishing it would put invention in the archive the rollups read. `--now` (`npm run nightly`) BYPASSES both, because a person running it by hand has already decided they want a post; it also stamps its log block `(manual)`.

The send carries the three read tools and `--add-dir` on the transcripts root the payload indexed — the reflection reads the day itself, so the grant and the index have to name the same root — and it runs from an empty scratch directory with `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, for the same TCC reason the brief does. Its stderr goes to the log; only its stdout is ever the published body.

Every reason not to publish is one timestamped block in `~/Library/Logs/claude-nightly.log` and exit 0: `summaries: no home repo configured — skipped`, a payload that could not be composed, a Claude that answered with nothing, an API that refused. A summary that cannot be posted is never written to disk instead. `WORKFLOW_HOME` overrides where it reads the settings file — the seam the suite uses.

`nightly-payload.js` is the composer: the reflection instruction, the day's transcript INDEX (every `.jsonl` under `~/.claude/projects/` that moved in the last 24 hours, newest first, with size and mtime and no contents) and `git log --since="24 hours ago"` across the roster. `--cadence weekly|monthly` swaps in the rollup instruction and reads the prior summaries from stdin, so the module stays a pure composer and the API call stays with the step that holds the credentials. `WORKKIT_CLAUDE_PROJECTS` overrides the transcripts root — a seam for the suite.

## The publish step

After the brief is sent, `claude-daily.sh` runs `workflow/publish.sh --quiet`: the tower project in `~/.workkit/tower` is rebuilt and its output pushed to the home repo's `gh-pages` branch, where GitHub Pages serves it. It runs LAST and only for the brief (a `claude-daily.sh <message>` run publishes nothing), it is bounded by the same 15-minute `timeout`, and its every reason not to publish — no home repo, no build tooling, a diverged clone, nothing changed — is a silent skip. A failure is logged as `[publish exit N — the brief was already sent]` and changes nothing about the morning. The mechanics are the engine's: `workflow/README.md` § Publishing the dashboard.

## Tests

`tests/jobs/` runs all six against fixtures: a scratch `~/.workkit` carrying a fixture roster for the payloads, a fixture CHANGELOG for the news, a fixture projects tree with fixture mtimes for the transcript index, a fake `claude` and notifier plus a scratch `HOME` and `WORKFLOW_HOME` for the runners — the entry point's suite hands those same seams to the summaries step it calls — a `gh` answering the Discussions API with canned JSON, and a recording `launchctl` for the installer. Nothing in the suite reaches the network, files an issue, loads an agent, or writes outside its temp directory.
