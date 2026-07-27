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
| `brief-payload.js` | the payload, on stdout: the digest instruction, then the brief as JSON. Pure gather — no Claude, no notification, no writes |
| `claude-daily.sh` | the runner: sends the payload headless, appends the exchange to `~/Library/Logs/claude-daily.log`, notifies |
| `com.workkit.claude-daily.plist` | the schedule — 9:00 AM daily, `{{WORKKIT_DIR}}` and `{{HOME}}` rendered at install |
| `install.sh` | render, compare, and only on change copy and reload |

## The payload

`brief-payload.js` composes `/api/brief` without the tower: the roster walk, the board sweep, per-repo health, then `buildBrief` — the same modules under `tower/api/lib/`, so the morning notification and the Brief page cannot tell different stories. It needs no running server, which is the point: nothing has to be started for nine o'clock to work.

A sweep that failed prints as a failure (`ok: false` and its reason) and the digest says so. "Nothing is waiting on you" and "gh could not answer" are opposite facts.

## The runner

`claude-daily.sh [message]` is a generic headless runner — an argument replaces the payload, which is how you test a prompt without waiting for tomorrow. It is hardened for launchd, where the environment is bare and the job is its own TCC identity:

- **PATH is set by the script.** launchd provides almost none; node comes from `~/.nvm/default-bin`, which survives Node upgrades.
- **The cwd is an empty scratch directory** under `~/Library/Caches/claude-daily`. launchd starts a job at `/`, and Claude Code's startup scan from there trips macOS privacy prompts. An empty directory gives it nothing to scan.
- **The send is capped**: haiku, effort low, `--safe-mode`, no tools, no session persistence, and a hard budget of $0.25.
- **The notification is detached.** Notifly does not return until it is dismissed, and the job must never wait on a human. Its message is the response's first line, which is why the instruction fixes that line as `HEADLINE:`.

`NOTIFLY` overrides the notifier's path — a seam for the suite, so running the tests never puts a notification on screen.

## Tests

`tests/jobs/` runs all three against fixtures: a scratch Repositories root for the payload, a fake `claude` and notifier for the runner, and a scratch `HOME` with a recording `launchctl` for the installer. Nothing in the suite reaches the network, files an issue, loads an agent, or writes outside its temp directory.
