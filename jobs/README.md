# The jobs

Scheduled work the kit runs on this machine. One job today: the 9am daily brief, which reads the same payload the tower's Brief page draws and hands it to Claude for a plain-language digest, arriving as a desktop notification.

It lives here rather than in a machine's own configuration because the brief is kit knowledge — the roster, the board, the health, and `buildBrief` are all in this repo, and the job is one more reader of them.

## Install

```sh
bash jobs/install.sh
```

Renders `com.workkit.claude-daily.plist` for THIS checkout into `~/Library/LaunchAgents/` and loads it. Idempotent: a second run with an unchanged plist confirms the agent is loaded and does nothing else. Re-run it after moving the checkout — the plist carries absolute paths, because launchd expands nothing.

## The pieces

| File | What |
|---|---|
| `brief-payload.js` | the payload, on stdout: the digest instruction, then the brief as JSON, then the upstream news. Pure gather — no Claude, no notification |
| `cc-news.js` | every upstream Claude Code CHANGELOG entry since the last brief, organized by topic, and the small mark file that remembers where it counted from |
| `claude-daily.sh` | the runner: sends the payload headless, appends the exchange to `~/Library/Logs/claude-daily.log`, notifies |
| `com.workkit.claude-daily.plist` | the schedule — 9:00 AM daily, `{{WORKKIT_DIR}}` and `{{HOME}}` rendered at install |
| `install.sh` | render, compare, and only on change copy and reload |

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

## Tests

`tests/jobs/` runs all four against fixtures: a scratch Repositories root for the payload, a fixture CHANGELOG and a scratch `~/.workkit` for the news, a fake `claude` and notifier for the runner, and a scratch `HOME` with a recording `launchctl` for the installer. Nothing in the suite reaches the network, files an issue, loads an agent, or writes outside its temp directory.
