# The tower

The workkit dashboard: one plain-Node server, one page, zero runtime dependencies. It watches everything the workflow system already knows — the cross-repo issue board, the live Claude sessions, per-repo health — and carries one write path, an intake box that files a `status:inbox` issue. A view, never a second store: remove the tower and nothing is lost.

## Run

```sh
npm run tower          # http://127.0.0.1:8693
```

| Knob | Default | Meaning |
|---|---|---|
| `TOWER_PORT` | `8693` (TOWER on a phone keypad) | listen port |
| `TOWER_BIND` | `127.0.0.1` | bind address — keep it loopback; front it with Tailscale for the phone |
| `TOWER_ALLOW_HOST` | (empty) | comma-separated extra hostnames the Host/Origin gate admits — put the tailnet name here |
| `TOWER_ROOT` | `~/Developer/Repositories` | where roster discovery walks |
| `KEEP_AWAKE_IDLE_MINUTES` | `45` | when a quiet session counts as idle, matching the keep-awake hook |

### Phone access

Nothing listens beyond loopback. Put Tailscale in front and allow its hostname:

```sh
TOWER_ALLOW_HOST=<mac-name>.<tailnet>.ts.net npm run tower
tailscale serve --bg http://127.0.0.1:8693
```

## The panes

1. **Board** — every open issue across the opted-in repos, columns by `status:` label, blocked issues surfaced in a strip with their question pending. Badges: `agent:ok` (the runway), `priority:high`, the assignee when claimed. Cards link to GitHub; the tower never edits an issue.
2. **Crew** — live Claude sessions from the keep-awake markers: repo, chat name, working / idle / stale, model and effort from the statusline cache (VS Code sessions have no cache and show a dash).
3. **Health** — per repo: open counts by status, unpushed commits, uncommitted files, unreleased CHANGELOG entries, last tag.
4. **Intake** — repo select, title, optional body, one button. Files with `status:inbox` + `type:idea`; triage does the rest.

## Endpoints

| Route | What |
|---|---|
| `GET /` | the page (`public/index.html`, one file) |
| `GET /api/repos` | roster discovery — opted-in repos minus personal declines (cache 60s, `?fresh=1` bypasses) |
| `GET /api/board` | the GraphQL sweep, normalized to the label vocabulary (cache 60s, `?fresh=1` bypasses) |
| `GET /api/sessions` | live sessions from the keep-awake markers (cache 5s) |
| `GET /api/health` | git health per roster repo (cache 5s) |
| `POST /api/intake` | `{ repo, title, body? }` → `gh issue create`; repo must be in the roster |

Failures are soft and never cached: a lapsed `gh` login returns `{ ok: false, reason: "gh not authenticated" }` and the next read retries. One unresolvable repo does not blank the board — its entry carries the error and the rest render.

## Layout

```
tower/
├── server.js         # createServer(opts) + the main block
├── lib/
│   ├── repos.js      # roster discovery (.workkit/settings.json opt-ins)
│   ├── board.js      # one gh api graphql sweep → normalized issues
│   ├── sessions.js   # keep-awake markers + transcripts + statusline cache
│   └── health.js     # unpushed / uncommitted / unreleased / last tag
└── public/
    └── index.html    # the whole UI — inline CSS + vanilla JS, no build step
```

Every lib takes an `opts` object for path and exec injection; the suites under `tests/tower/` run the whole server against fixtures, fully offline.
