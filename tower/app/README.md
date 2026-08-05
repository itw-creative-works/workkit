# The tower app

The tower's UI, built on the OMEGA framework rather than on a hand-written
shell. The sidebar, the topbar, the rail collapse, the mobile drawer, the
routing, the dark mode and the whole classy stylesheet are OMEGA's; what lives
here is six pages, a nav file, and the JavaScript that draws the data.

The data comes from the tower API — the plain Node server in `tower/api/`, on
**8693**. This app never reads a repository or runs `gh`; it fetches JSON.

## Running it

```sh
cd tower/app
npm install          # its OWN npm root — see below
cd apps/web && npx omega dev    # serving https://localhost:4300
```

The API is started separately, from the repo root with `npm run tower`, and both
have to be up for the pages to carry data: with the API down every page still
draws, saying which feed did not answer.

Port 4300 keeps the OMEGA family clear of each other: playground 4000,
dailybuild 4100, omega-brand 4200, tower 4300.

## Why this is its own npm root

npm workspaces do not nest. `tower/app` declares `workspaces: ["apps/*"]` for
its one web app, so it cannot also be a member of workkit's root
`package.json` — it gets its own `npm install`, and workkit's root install
never reaches it.

## The local era, and the flip to registry versions

Every `@omega.js/*` dependency is a **relative `file:` spec** into the sibling
Omega checkout, because OMEGA is not published yet:

| package.json | dependency | spec |
|---|---|---|
| `tower/app/package.json` | `@omega.js/manager` | `file:../../../../Omega/omega/packages/manager` |
| `tower/app/apps/web/package.json` | `@omega.js/web` | `file:../../../../../../Omega/omega/packages/web` |

Both resolve against `~/Developer/Repositories`, where workkit and Omega are
siblings. The cost is accepted deliberately: **building the tower UI requires
the Omega checkout** until OMEGA publishes.

**When OMEGA publishes**, replace both `file:` specs with registry ranges
(`^1.0.0` or whatever the first published major is), run `npm install`, and
delete this section's premise — nothing else in this app changes, because
nothing here imports through a path.

## The shape of it

```
tower/app/
├── package.json                 # brand root: workspaces + @omega.js/manager
├── config/omega.json5           # brand.id, brand.name, theme, port 4300
└── apps/web/
    ├── package.json             # @omega.js/web
    ├── config/omega.json5       # targets only
    └── src/
        ├── pages/*.md           # six pages: one layout line, one mount div
        ├── _layouts/tower/page.html      # turns the admin auth gate off
        ├── _includes/backend/sections/   # sidebar.json + topbar.json (the nav)
        └── assets/
            ├── css/main.scss    # nearly empty — the theme does the work
            └── js/
                ├── pages/*.js   # one module per page, bound by URL
                └── libs/tower/  # api, format, modal, the page runtime
```

A few things worth knowing before changing it:

- **A page's JS is bound by its URL**, not by an import: `/board` loads
  `assets/js/pages/board.js`, and `/` loads `pages/index.js`.
- **Consumer page frontmatter is machinery-limited.** The engine strips any key
  outside `{meta, schema, theme, client, append, sitemap}` from a page under
  `src/pages/` and warns. The auth opt-out (`client.auth.config.policy:
  "disabled"` — the blob was named `web_manager` before the framework renamed
  it, which is what issue #98 fixed) lives in `src/_layouts/tower/page.html` so
  the six pages share one home.
- **The nav is `_includes/backend/sections/sidebar.json`**, which replaces the
  framework's file wholesale. It is the `backend` spelling rather than `admin`
  because the shell layout picks the admin pair only for URLs containing
  `/admin`, and the tower's pages sit at clean top-level URLs.
- **The project switch is the framework's SELECTOR module, filled at runtime**
  — the dropdown the base shell draws above the nav, turned on by the
  `selector` block in that same sidebar JSON and filled by `libs/tower/
  sidebar.js`, which `libs/tower/page.js` writes into the menu and wires. The
  roster is fetched at runtime and the sidebar JSON is baked at build time, so
  the one item in that block is a placeholder that makes Liquid ship the `ul`;
  the entries are markup from the `repos` feed like everything else, and the
  same page JS patches the button's label and rewrites the nav's own links to
  carry `?repo=`.
- **Charts, refreshing in place and markdown are the FRAMEWORK's.** The chart
  helpers come from `__main_assets__/js/libs/charts.js` (Chart.js is a
  dependency of `@omega.js/web`, dynamically imported into its own chunk — the
  tower declares no charting dependency); `loading`, `swap` and the feed poller
  behind the page runtime come from `@omega.js/client/modules/live-page`; the
  issue dialog's body is drawn with `omega.utilities().renderMarkdown`, handed
  to `mountIssueModal` by `main.js` so `libs/tower/modal.js` stays pure string
  functions the suite runs under Node.
- **The API origin is written once**, in `assets/js/libs/tower/api.js`, and is
  overridable per page load with `?api=http://host:port`.
