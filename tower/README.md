# The tower

The workkit dashboard: mission control over everything the workflow system already knows — the cross-repo issue board, the live Claude crew and what it costs, per-repo health, and the daily brief. It carries two deliberate write paths: the intake dialog, which files a `status:inbox` issue, and the Board's drag, which moves an issue between the status columns. A view, never a second store: remove the tower and nothing is lost.

It is two processes. `tower/api/` is a plain-Node JSON API with zero dependencies, and `tower/app/` is the dashboard, an OMEGA app that reads it. They are split because the framework owns the chrome — the shell, the sidebar, the routing, dark mode — and hand-writing a second copy of all that was the thing v2 stopped doing.

## Run

Both halves, in two terminals:

```sh
npm run tower                                  # the API on http://127.0.0.1:8693
cd tower/app/apps/web && npx omega dev         # the dashboard on https://localhost:4300
```

The API answers on its own and is useful without the dashboard. The 9am job does not read it over HTTP — `jobs/brief-payload.js` composes the same payload from the same libs, so nothing has to be running at nine in the morning. The dashboard needs the API; with it down, every pane says so in a line and the page still draws.

| Knob | Default | Meaning |
|---|---|---|
| `TOWER_PORT` | `8693` (TOWER on a phone keypad) | listen port |
| `TOWER_BIND` | `127.0.0.1` | bind address — keep it loopback; front it with Tailscale for the phone |
| `TOWER_ALLOW_HOST` | (empty) | comma-separated extra hostnames the Host and Origin gate admits — put the tailnet name here |
| `KEEP_AWAKE_IDLE_MINUTES` | `45` | when a quiet session counts as idle, matching the keep-awake hook |

The dashboard finds the API at `http://127.0.0.1:8693`. Two overrides, neither needing a rebuild: `?api=http://host:port` in the URL, which points one link at another machine's tower, and `window.TOWER_API` from the console.

### The three modes

The app knows what is on the other end of it, and the answer is one of three. `omega dev` bakes `environment: development` into the page and a production build bakes `production`, and either override above points a page at a tower whatever the build says. So: **tower** — a machine's API, everything the dashboard has ever done, including its two write paths; **github** — a published copy holding a token, reading GitHub itself; **locked** — a published copy with no token, which is the prompt and nothing else. The decision is made once, in `libs/tower/api.js`, and exported as `MODE` — with `LIVE` meaning "a tower", the question of which half answers, and `WRITABLE` meaning "anything but locked", the question every write gates on.

**The token is the key, and the auth.** A published copy bakes no data at all: every issue, count and summary is a live GitHub call made by the browser (issue #81). What unlocks those calls is a fine-grained personal access token the viewer creates and types in — Issues: Read and write, Metadata: Read, Discussions: Read, on the repositories the board covers. It writes because the site MANAGES those issues rather than displaying them: a card is dragged between columns and the dialog files one, exactly as on the machine. It is stored in that browser's localStorage and nowhere else: not in the repo, not in the build, not in a URL, and it is sent to `api.github.com` and to nothing else. Without one the site shows a prompt saying what to make and linking where to make it; the Token button in each page's chrome forgets it again, which is also how one is replaced. A token GitHub refuses — expired, or not covering these repositories — puts that same prompt back with the refusal as its reason, because the prompt is the only place a token is typed. A viewer with no token sees no data, which is what makes the token the whole auth layer — and a real login can replace it later, since the page only ever needs the string handed over.

**What works off-machine, and what does not.** Overview, Board and Brief read GitHub through `libs/tower/github.js`, which answers in the same shapes the API serves — `/api/repos` from the baked slug list, `/api/board` from the same GraphQL sweep written byte for byte the same as the tower's, `/api/brief` from that sweep plus the summaries published as Discussions on the home repo. Crew, Usage and Health read this machine — its processes, transcripts and working copies — so a published copy says exactly that instead of drawing an empty page, and so do the Overview's crew and health panels. It WRITES the same way: the Board's drag and the intake dialog reach GitHub with the same token, through the same two paths the tower has — a move is the issue's labels read and written back with the old `status:` off and the new one on (one PATCH, so it is never unlabelled nor twice-labelled), and an intake is `POST /repos/:slug/issues` carrying `status:inbox` and `type:idea`. Both carry the endpoint's own refusals, made before anything leaves the browser — a blank title, an over-long body or a repo the site does not sweep for the intake; a number that is not a positive integer, a repo that is not a slug, a status the vocabulary does not define or a move to where the issue already is for the move — and the move refuses one more the endpoint cannot meet: a read that answered without the issue's labels is no base for a whole-set PATCH, so nothing is written. They speak REST where the reads speak GraphQL, because a mutation addresses a label by node id and REST speaks label names. A token that can read but not write is told so in those words, in place of the move it refused; a token that cannot see the repository at all is told THAT instead, since the two legs of a move fail for different reasons. Only a LOCKED copy writes nothing, and it says the one thing that fixes it: add a token.

A published copy is otherwise unchanged: every page keeps its mount, its sidebar and its topbar, and a page pointed at a tower with `?api=` runs fully live against it.

**Where a published copy comes from.** This app is also the SEED of the home repo: `workkit setup` copies it into `~/.workkit/tower`, where it becomes a project in its own right, and `workflow/publish.sh` builds THAT clone and pushes the output to the home repo's `gh-pages` branch, which GitHub Pages serves from the branch root (issues #27, #77) — the daily job after the morning brief, or `workkit publish` on demand. So nothing built is ever committed as source. The build runs in `apps/web` rather than at the brand root, because `omega build` is a command of `@omega.js/web` and the root's `omega` bin is the manager's (probed 2026-07-29). The build is LOCAL, never CI: the app consumes `@omega.js/*` by `file:` spec from a sibling omega checkout that no runner has, and on a machine without it `npm install` exits 0 while leaving nothing that can build, so the publish checks for the `omega` binary and skips cleanly rather than trusting an install.

Alongside the pages it writes exactly one file: `data/repos.json`, the `owner/name` slugs the site sweeps plus `home`, the repo its summaries are read from (`workflow/site-repos.js`, from the same roster the tower and the brief read). Names, and nothing else — no titles, no labels, no counts — because Pages is public even when the repo serving it is private, and the data itself is fetched by the viewer's own token in the viewer's own browser. The file carries no timestamp, so an unchanged roster produces no commit. Whether anything publishes at all is `site.publish`, default off.

### Phone access

Nothing listens beyond loopback. Put Tailscale in front and allow its hostname:

```sh
TOWER_ALLOW_HOST=<mac-name>.<tailnet>.ts.net npm run tower
tailscale serve --bg http://127.0.0.1:8693
```

## Who may reach it

The bind keeps other machines out. It cannot keep other PAGES out — any site can resolve a name it owns to 127.0.0.1 and reach a localhost listener — so the Host header is checked against an allowlist on every request, and a request carrying an Origin must carry one from that same allowlist.

CORS falls out of that one list. An allowed origin is echoed back in `Access-Control-Allow-Origin`, never `*`, with `Vary: Origin`; the preflight the page's POSTs trigger is answered with the methods, the headers and a ten-minute max-age — one answer covering both write paths, because a preflight is about the method and the headers rather than the path. The dashboard reaches the API exactly because `localhost` is already a name the tower answers to. A page this tower does not answer to gets a 403 for the whole surface — no header, and no data either.

## The pages

The app is an OMEGA brand root whose one app is the dashboard. The framework supplies the shell; the tower supplies the nav as a JSON file, one page per view, and a page module per page that draws from the API.

| Page | What |
|---|---|
| **Overview** | the control room: a statgrid row (open, blocked, in flight, live sessions, unpushed, unreleased), what is waiting on you, the live crew compact, health at a glance worst-first, and the queue by status as a doughnut. Each list stops at five with a line to the page that holds the rest |
| **Board** | the full issue board — columns by `status:`, filters for type, priority, assignee and `agent:ok`, all repos or one. Every card is one size, its title clamped to two lines; the whole title is in the dialog it opens. A card is DRAGGED between the five status columns and the drop really relabels the issue: it moves at once, and a write that fails puts it back and says why. The "No status" column takes no drop — a move removes one label and adds another, and an issue triage has not reached carries neither |
| **Crew** | the running agents as an org chart, one tree per session under its repo: the session at the root titled `repo/chat`, a trunk down to its WORKING subagents, and a moving line into every one of them — each flowing the way it actually runs, left or right of the trunk. Every card wears its role as an icon at the top; a subagent's card leads with its CLASS and demotes its agent id to the line beneath; every node carries its class and model as coloured badges plus its token spend. The ones that have finished are behind one page-global switch, off by default. Narrow screens turn the same tree on its side — one spine down the left, an elbow into each card |
| **Usage** | where the tokens went — by model, by agent class, over thirty days, cache reads against fresh, and a cost derived from the token counts. A session's cache column is a pill rather than a number: green for tokens read from the cache, red for a session that read none and paid full price for its whole context, and a plain dash for one that has spent nothing at all — it has not missed the cache, it has not asked it anything |
| **Health** | per-repo unpushed, uncommitted, unreleased entries and last tag, with the release-lag view |
| **Brief** | the daily brief: the headline, the counts, what is waiting on you, what is ready to start, what is in flight, and the work sitting on the table |

The repo selection is global, held in `?repo=owner/name`, and every page whose data divides by repo respects it. Usage is the exception: token spend is machine-wide, and splitting it by repository would invent a number nothing measures.

**Intake** is not a page: it is an action on the topbar, reachable from all of them. Repo select, title, optional body, one button; it files with `status:inbox` and `type:idea`, and triage does the rest.

**Clicking an issue** — on the Board, the Overview, the Brief or the Health page — opens it in a dialog on the page you are on: number, repo, status and chips, the body rendered, who holds it, when it was filed and last touched, and how many comments are waiting. Nothing navigates to github.com by itself. The box-with-arrow button does, in a new tab, and it is on the dialog and on each issue while it is hovered or focused. The body is rendered by the framework's markdown renderer, which escapes first and never passes markup through, because an issue body is text from an API and may say anything.

**An agent's activity is one glyph.** Wherever an agent is drawn — the Crew chart, the Overview's crew table — a spinning green circle says its transcript moved within the last twenty seconds, the same circle still and faint says it moved within the last minute, and nothing at all says it has been quiet longer than that. Both thresholds and all the arithmetic are the page's, so an indicator ages from green to gray to gone between reads; the API's own 45-minute liveness window is far too coarse to say whether something is happening right now. The Crew page and the Overview put how long since it last moved beside the glyph, and how long it has been running on hover; on the Board a `specced` or `building` issue with an assignee carries the still version, which says only that someone holds it. One helper draws all of them: `libs/tower/agent.js`, which also owns the claim gate and the role icons.

**Clicking a crew card** opens that agent's dialog: the tool it last reached for and when, its model, effort, token counters and cost, how long it has been running and when it was spawned, and the path to its transcript. Fields the payload does not carry are left out rather than drawn as dashes. Keyboard-reachable, like every issue card.

**Models and crew classes carry one colour.** A model id and an agent class are drawn as coloured badges wherever they appear — the Crew cards, the Overview's crew table, the Usage table — and the Usage charts draw each bar in that same colour, so a row in a chart and a badge in the table below it are recognizably the same thing. Which name falls in which tone is `libs/tower/format.js`; the colours are the framework's categorical ramp (`.omega-tone-1..6` on `.omega-badge-tone`), so dark mode follows. Anything clickable — every issue card and row — warms and lifts under the pointer and settles again on press, which is the framework's `.omega-interactive`.

**Refreshes are in place.** A section that has never answered shows a spinner naming the read; the chrome shows one while a refresh is in flight; and a poll that changed nothing writes nothing, so the page keeps its focus, its scroll and its open panels. A refresh that fails leaves the last good answer on screen and marks the feed unavailable rather than replacing a full board with an error line.

## Endpoints

| Route | What |
|---|---|
| `GET /api/repos` | the roster — the repos this machine has registered in `~/.workkit/.repos.json` that still carry their committed opt-in, plus the home clone at `~/.workkit/tower`, which carries no opt-in of its own and is recognized by path; the settings location is a library option, not an environment knob (cache 60s, `?fresh=1` bypasses) |
| `GET /api/board` | the GraphQL sweep, normalized to the label vocabulary, each issue carrying the body, dates and comment count the issue dialog reads — bodies over 4,000 characters are cut and flagged `bodyTruncated` (cache 60s, `?fresh=1` bypasses) |
| `GET /api/sessions` | live sessions from the keep-awake markers, each carrying its transcript path and the two file times a page ages — `lastActivity` and `aliveSince`, ms epochs (cache 5s) |
| `GET /api/health` | git health per roster repo (cache 5s) |
| `GET /api/telemetry` | token accounting and subagent attribution, with `byModel`, `byClass` and thirty days of history; every row also says its last tool call and where its transcript is (cache 5s) |
| `GET /api/telemetry/<id>` | one session's row of that same answer |
| `GET /api/brief` | the daily brief, assembled from the board and health above |
| `POST /api/intake` | `{ repo, title, body? }` filed through `gh issue create`; the repo must be on the roster |
| `POST /api/issues/status` | `{ repo, number, from, to }` relabelled through `gh issue edit --remove-label --add-label`, one call so the issue never carries two statuses. Everything is judged before `gh` is reached: a positive integer, a slug shaped like one AND on the roster, and two different statuses from the label vocabulary — anything else is a 400 |

Anything outside `/api/*` is a 404. The dashboard is the OMEGA app, not this process.

Failures are soft and never cached: a lapsed `gh` login returns `{ ok: false, reason: … }` and the next read retries. One unresolvable repo does not blank the board — its entry carries the error and the rest render.

## Telemetry, and why it is careful

Token counts come from the transcripts Claude Code already writes. Three facts shape the code:

- **Transcripts reach gigabytes.** Reading one whole throws. Each file is streamed in chunks and its totals cached by size and mtime, so a second call reads only the bytes appended since the first; a file that shrank re-reads from zero.
- **Usage lines duplicate.** One API response is written as several lines, one per content block, each repeating the same usage — and a resumed session replays its history. Counts are deduplicated by message id; raw summing overstates a busy session by a large multiple. The measurement behind that claim lives in the module header, next to the code it justifies.
- **A finished subagent goes quiet and stays quiet.** Its transcript is never touched again, so recency is the liveness signal: each row is stamped `working` or `done` against the same idle window `sessions.js` derives a session's state from, one constant serving both tiers. The read cache is pruned to the transcripts each pass named, so a session that ended is forgotten rather than held for the life of the process.
- **A subagent's class is not in its own file.** `agent-<id>.jsonl` sits beside `agent-<id>.meta.json`, whose `toolUseId` is the parent's tool_use id, and that tool_use names the class. `meta.agentType` carries the same value and is the fallback when the parent line has been compacted away.

Cost is derived from a pricing table in the library, hand-entered from published rates and commented as a snapshot. An unpriced model reports its tokens with a null cost, never a zero — a partial total would render as a real number.

## Layout

```
tower/
├── api/
│   ├── server.js       # createServer(opts) + the main block: routing, caching, the gates
│   └── lib/
│       ├── repos.js    # the roster from ~/.workkit/.repos.json, plus the home clone
│       ├── board.js    # one gh api graphql sweep, normalized
│       ├── sessions.js # keep-awake markers + transcripts + statusline cache
│       ├── health.js   # unpushed / uncommitted / unreleased / last tag
│       ├── telemetry.js# token accounting and subagent attribution
│       └── brief.js    # the daily brief — one payload for the page and the 9am job (jobs/)
└── app/                # the OMEGA app — its own npm root (workspaces do not nest)
    └── apps/web/src/
        ├── pages/                      # one markdown page per view
        ├── _layouts/tower/page.html    # the layout: auth off, the issue, agent and intake dialogs
        ├── _includes/backend/sections/ # sidebar.json and topbar.json — the nav is data
        └── assets/js/
            ├── main.js                 # the one bundle every page loads — mounts the three dialogs
            ├── pages/                  # one module per page, bound by URL
            └── libs/tower/             # api, github, token, page, chrome, state, format, crew, agent, modal, intake
```

Every lib takes an `opts` object for path and exec injection; the suites under `tests/tower/` run the whole server against fixtures, fully offline.

## The dependency posture

`@omega.js/*` is consumed by relative `file:` specs into the sibling Omega checkout, matching the `omega-brand` precedent. They flip to registry ranges when OMEGA publishes, which happens before workkit does. Until then the dashboard cannot build without that checkout on disk. The API has no such dependency and never will.

## FontAwesome Pro

The app ships against the free tier and every icon it draws today is a free `fa-solid` glyph. Pro is supplied, never vendored — the framework's icon chain (`[env dir, pro npm, free]`, documented in the omega monorepo's `docs/shared/icons.md`) picks it up with zero code changes here. Either route works: set `OMEGA_FONTAWESOME_ROOT` in `tower/app/.env` (see `.env.example`) to a Pro SVG download, or authenticate the `@fortawesome` scope machine-globally and add `@fortawesome/fontawesome-pro` to `tower/app/package.json`. Once supplied, Pro styles (`fa-light`, `fa-sharp`, …) simply start resolving.
