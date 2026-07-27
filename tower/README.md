# The tower

The workkit dashboard: mission control over everything the workflow system already knows — the cross-repo issue board, the live Claude crew and what it costs, per-repo health, and the daily brief. It carries one write path, an intake dialog that files a `status:inbox` issue. A view, never a second store: remove the tower and nothing is lost.

It is two processes. `tower/api/` is a plain-Node JSON API with zero dependencies, and `tower/app/` is the dashboard, an OMEGA app that reads it. They are split because the framework owns the chrome — the shell, the sidebar, the routing, dark mode — and hand-writing a second copy of all that was the thing v2 stopped doing.

## Run

Both halves, in two terminals:

```sh
npm run tower                                  # the API on http://127.0.0.1:8693
cd tower/app/apps/web && npx omega dev         # the dashboard on https://localhost:4300
```

The API answers on its own and is useful without the dashboard: `/api/brief` is built for the 9am job to read, though that job still reads the retired markdown until it is switched over. The dashboard needs the API; with it down, every pane says so in a line and the page still draws.

| Knob | Default | Meaning |
|---|---|---|
| `TOWER_PORT` | `8693` (TOWER on a phone keypad) | listen port |
| `TOWER_BIND` | `127.0.0.1` | bind address — keep it loopback; front it with Tailscale for the phone |
| `TOWER_ALLOW_HOST` | (empty) | comma-separated extra hostnames the Host and Origin gate admits — put the tailnet name here |
| `TOWER_ROOT` | `~/Developer/Repositories` | where roster discovery walks |
| `KEEP_AWAKE_IDLE_MINUTES` | `45` | when a quiet session counts as idle, matching the keep-awake hook |

The dashboard finds the API at `http://127.0.0.1:8693`. Two overrides, neither needing a rebuild: `?api=http://host:port` in the URL, which points one link at another machine's tower, and `window.TOWER_API` from the console.

### Phone access

Nothing listens beyond loopback. Put Tailscale in front and allow its hostname:

```sh
TOWER_ALLOW_HOST=<mac-name>.<tailnet>.ts.net npm run tower
tailscale serve --bg http://127.0.0.1:8693
```

## Who may reach it

The bind keeps other machines out. It cannot keep other PAGES out — any site can resolve a name it owns to 127.0.0.1 and reach a localhost listener — so the Host header is checked against an allowlist on every request, and a request carrying an Origin must carry one from that same allowlist.

CORS falls out of that one list. An allowed origin is echoed back in `Access-Control-Allow-Origin`, never `*`, with `Vary: Origin`; the intake POST's preflight is answered with the methods, the headers and a ten-minute max-age. The dashboard reaches the API exactly because `localhost` is already a name the tower answers to. A page this tower does not answer to gets a 403 for the whole surface — no header, and no data either.

## The pages

The app is an OMEGA brand root whose one app is the dashboard. The framework supplies the shell; the tower supplies the nav as a JSON file, one page per view, and a page module per page that draws from the API.

| Page | What |
|---|---|
| **Overview** | the control room: a statgrid row (open, blocked, in flight, live sessions, unpushed, unreleased), what is waiting on you, the live crew compact, health at a glance, and the queue by status |
| **Board** | the full issue board — columns by `status:`, filters for type, priority, assignee and `agent:ok`, all repos or one |
| **Crew** | the running agents as an org chart: each session at the root with its subagents beneath it by class, every node carrying its model and its token spend |
| **Usage** | where the tokens went — by model, by agent class, over thirty days, cache reads against fresh, and a cost derived from the token counts |
| **Health** | per-repo unpushed, uncommitted, unreleased entries and last tag, with the release-lag view |
| **Brief** | the daily brief: the headline, the counts, what is waiting on you, what is ready to start, what is in flight, and the work sitting on the table |

The repo selection is global, held in `?repo=owner/name`, and every page whose data divides by repo respects it. Usage is the exception: token spend is machine-wide, and splitting it by repository would invent a number nothing measures.

**Intake** is not a page: it is an action on the topbar, reachable from all of them. Repo select, title, optional body, one button; it files with `status:inbox` and `type:idea`, and triage does the rest.

## Endpoints

| Route | What |
|---|---|
| `GET /api/repos` | roster discovery — opted-in repos minus personal declines (cache 60s, `?fresh=1` bypasses) |
| `GET /api/board` | the GraphQL sweep, normalized to the label vocabulary (cache 60s, `?fresh=1` bypasses) |
| `GET /api/sessions` | live sessions from the keep-awake markers (cache 5s) |
| `GET /api/health` | git health per roster repo (cache 5s) |
| `GET /api/telemetry` | token accounting and subagent attribution, with `byModel`, `byClass` and thirty days of history (cache 5s) |
| `GET /api/telemetry/<id>` | one session's row of that same answer |
| `GET /api/brief` | the daily brief, assembled from the board and health above |
| `POST /api/intake` | `{ repo, title, body? }` filed through `gh issue create`; the repo must be on the roster |

Anything outside `/api/*` is a 404. The dashboard is the OMEGA app, not this process.

Failures are soft and never cached: a lapsed `gh` login returns `{ ok: false, reason: … }` and the next read retries. One unresolvable repo does not blank the board — its entry carries the error and the rest render.

## Telemetry, and why it is careful

Token counts come from the transcripts Claude Code already writes. Three facts shape the code:

- **Transcripts reach gigabytes.** Reading one whole throws. Each file is streamed in chunks and its totals cached by size and mtime, so a second call reads only the bytes appended since the first; a file that shrank re-reads from zero.
- **Usage lines duplicate.** One API response is written as several lines, one per content block, each repeating the same usage — and a resumed session replays its history. Counts are deduplicated by message id; raw summing overstates a busy session by a large multiple. The measurement behind that claim lives in the module header, next to the code it justifies.
- **A subagent's class is not in its own file.** `agent-<id>.jsonl` sits beside `agent-<id>.meta.json`, whose `toolUseId` is the parent's tool_use id, and that tool_use names the class. `meta.agentType` carries the same value and is the fallback when the parent line has been compacted away.

Cost is derived from a pricing table in the library, hand-entered from published rates and commented as a snapshot. An unpriced model reports its tokens with a null cost, never a zero — a partial total would render as a real number.

## Layout

```
tower/
├── api/
│   ├── server.js       # createServer(opts) + the main block: routing, caching, the gates
│   └── lib/
│       ├── repos.js    # roster discovery (.workkit/settings.json opt-ins)
│       ├── board.js    # one gh api graphql sweep, normalized
│       ├── sessions.js # keep-awake markers + transcripts + statusline cache
│       ├── health.js   # unpushed / uncommitted / unreleased / last tag
│       ├── telemetry.js# token accounting and subagent attribution
│       └── brief.js    # the daily brief — one payload for the page and, once switched, the 9am job
└── app/                # the OMEGA app — its own npm root (workspaces do not nest)
    └── apps/web/src/
        ├── pages/                      # one markdown page per view
        ├── _layouts/tower/page.html    # the layout: auth off, the intake dialog
        ├── _includes/backend/sections/ # sidebar.json and topbar.json — the nav is data
        └── assets/js/
            ├── main.js                 # the one bundle every page loads — mounts the intake dialog
            ├── pages/                  # one module per page, bound by URL
            └── libs/tower/             # api, page, format, charts, intake
```

Every lib takes an `opts` object for path and exec injection; the suites under `tests/tower/` run the whole server against fixtures, fully offline.

## The dependency posture

`@omega.js/*` is consumed by relative `file:` specs into the sibling Omega checkout, matching the `omega-brand` precedent. They flip to registry ranges when OMEGA publishes, which happens before workkit does. Until then the dashboard cannot build without that checkout on disk. The API has no such dependency and never will.
