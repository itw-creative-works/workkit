# The jobs

Scheduled work the kit runs on this machine. Two jobs, a day apart and pointing opposite ways: the **9am daily brief** reads the same payload the tower's Brief page draws and hands it to Claude for a plain-language digest, arriving as a desktop notification; the **3am nightly summary** reflects on the day that just ended and writes it up in HQ.

They live here rather than in a machine's own configuration because both are kit knowledge — the roster, the board, the health, and `buildBrief` are all in this repo, and each job is one more reader of them.

## Install

```sh
bash jobs/install.sh
```

Renders both plists for THIS checkout into `~/Library/LaunchAgents/` and loads them. Idempotent: a second run with an unchanged plist confirms that agent is loaded and does nothing else, and one agent changing never churns the other. Re-run it after moving the checkout — the plists carry absolute paths, because launchd expands nothing.

## The pieces

| File | What |
|---|---|
| `brief-payload.js` | the morning payload, on stdout: the digest instruction, then the brief as JSON, then the upstream news. Pure gather — no Claude, no notification |
| `cc-news.js` | every upstream Claude Code CHANGELOG entry since the last brief, organized by topic, and the small mark file that remembers where it counted from |
| `claude-daily.sh` | the morning runner: sends the payload headless, appends the exchange to `~/Library/Logs/claude-daily.log`, notifies |
| `nightly-payload.js` | the night's payload: the reflection instruction, then the day's transcript INDEX and commits as JSON. Pure gather |
| `claude-nightly.sh` | the night runner: sends the payload, writes the returned summary into HQ, rolls the week up on a Sunday and the month on the 1st, logs to `~/Library/Logs/claude-nightly.log`, notifies |
| `com.workkit.claude-daily.plist` | the schedule — 9:00 AM daily, `{{WORKKIT_DIR}}` and `{{HOME}}` rendered at install |
| `com.workkit.claude-nightly.plist` | the same, at 3:00 AM |
| `install.sh` | render, compare, and only on change copy and reload — per agent |

## The payload

`brief-payload.js` composes `/api/brief` without the tower: the roster walk, the board sweep, per-repo health, then `buildBrief` — the same modules under `tower/api/lib/`, so the morning notification and the Brief page cannot tell different stories. It needs no running server, which is the point: nothing has to be started for nine o'clock to work.

A sweep that failed prints as a failure (`ok: false` and its reason) and the digest says so. "Nothing is waiting on you" and "gh could not answer" are opposite facts.

## The upstream news

Claude Code releases most days and its CHANGELOG is the only announcement, so `cc-news.js` reads that file — the raw one on the default branch, no token and no rate limit — and appends a `--- CC NEWS ---` block after the payload carrying every entry since the last brief, grouped by topic (the kit's own surfaces — hooks, agents, skills, plugins, settings, MCP, the statusline — then `other`). The job never judges which entries matter; the digest model does, with the board in view: a feature the kit could use, a change that breaks something it built, an improvement worth adopting. Finding out weeks late that a hook no longer matches the tool it hooks is the failure it exists to prevent.

Where it counted from is one file the module owns, `~/.workkit/cc-news.json`, and it advances only once the payload has printed — a morning that died repeats its news rather than losing it. A first run records the latest version and reports nothing: with no mark the honest "since" is the whole history, which would bury the brief. Every failure is silent (no network, a non-200, a body that is not a changelog): no block, the mark untouched, the brief still prints. `WORKKIT_CC_CHANGELOG` overrides the source — a seam for the suite, which points it at a file on disk.

## The runner

`claude-daily.sh [message]` is a generic headless runner — an argument replaces the payload, which is how you test a prompt without waiting for tomorrow. It is hardened for launchd, where the environment is bare and the job is its own TCC identity:

- **PATH is set by the script.** launchd provides almost none; node comes from `~/.nvm/default-bin`, which survives Node upgrades.
- **The cwd is an empty scratch directory** under `~/Library/Caches/claude-daily`. launchd starts a job at `/`, and Claude Code's startup scan from there trips macOS privacy prompts. An empty directory gives it nothing to scan.
- **The send is capped**: haiku, effort low, `--safe-mode`, no tools, no session persistence, and a hard budget of $0.25.
- **The notification is detached.** Notifly does not return until it is dismissed, and the job must never wait on a human. Its message is the response's first line, which is why the instruction fixes that line as `HEADLINE:`.

`claude-daily.sh --now` (or `npm run brief`) runs the whole thing on demand — the same payload, the same send, the same log file and notification — so the brief can be tested without waiting for tomorrow. Its log block is stamped `(manual)`, and it sets `WORKKIT_BRIEF_MANUAL` so the upstream-news mark stays where it is: a run at noon must not swallow the news the 9am job has yet to report.

`NOTIFLY` overrides the notifier's path — a seam for the suite, so running the tests never puts a notification on screen.

## The nightly summary

At 3:00 AM `claude-nightly.sh` writes up the day that just ended, into `<HQ>/summaries/daily/YYYY-MM-DD.md` — HQ being `~/Developer/Repositories/Ian-Wiedenman/hq` unless `WORKKIT_HQ` says otherwise. HQ is a plain directory to this job: it writes a file and runs no git.

`nightly-payload.js` gathers the day's two records without reading either. The transcripts are an INDEX — every `.jsonl` under `~/.claude/projects/` that moved in the last 24 hours, newest first, with its size and mtime, and no contents; a day of sessions is far past any budget, so the send carries `Read,Grep,Glob` and `--add-dir` and the model samples them itself, skipping anything over 10 MB and stopping when its reading budget feels spent. The other half is what landed: `git log --since="24 hours ago"` across the same roster the morning brief walks. `WORKKIT_CLAUDE_PROJECTS` overrides the transcripts root — a seam for the suite.

The response IS the document: four sections (`## Went well`, `## Went poorly`, `## Improvements`, `## Facts learned`), written to disk by the script rather than by the session, which is why the send can read everything and write nothing. **Observational only** — each improvement is phrased as a candidate issue and nothing is filed; triage stays the one writer.

Two guards on what gets written. A day with no sessions and no commits is a **quiet day**: nothing is sent, nothing is filed, nothing interrupts you, and the log says so. A date that **already has a summary** skips the send before anything is composed — the document someone may have already read is never replaced behind their back. `claude-nightly.sh --now` (or `npm run nightly`) is the exception and the manual trigger: same pipeline, log block stamped `(manual)`, and it does replace today's draft. The notification is the summary's first line that is neither blank nor a heading, or the date it filed when the document has no prose line at all. A send that succeeded but could not be written to HQ is reported like any other failure — the send is already paid for by then.

Rollups ride on the same run, from the summaries already on disk — small enough to inline, so those sends carry no tools at all. A **Sunday** rolls the last seven daily files into `summaries/weekly/YYYY-Www.md`; the **1st of the month** rolls every ISO week the previous month touched into `summaries/monthly/YYYY-MM.md`. Missing inputs skip the rollup with a log line, never an error. Neither guard above stops them: a week closes on its Sunday or not at all, since the next Sunday computes a different ISO week, so a quiet Sunday still rolls up whatever days did happen. `WORKKIT_NIGHTLY_DATE` overrides the date the whole run hangs off — the seam that lets the suite be a Sunday.

## Tests

`tests/jobs/` runs all six against fixtures: a scratch Repositories root for the payloads, a fixture CHANGELOG and a scratch `~/.workkit` for the news, a fixture projects tree with fixture mtimes for the transcript index, a fake `claude` and notifier plus a scratch `HOME` and `WORKKIT_HQ` for the runners, and a recording `launchctl` for the installer. Nothing in the suite reaches the network, files an issue, loads an agent, writes into the real HQ, or writes outside its temp directory.
