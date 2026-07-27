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
                └── libs/tower/  # api, format, charts, the page runtime
```

A few things worth knowing before changing it:

- **A page's JS is bound by its URL**, not by an import: `/board` loads
  `assets/js/pages/board.js`, and `/` loads `pages/index.js`.
- **Consumer page frontmatter is meta-only.** The engine strips any key outside
  `{meta, schema, theme, append, sitemap}` from a page under `src/pages/` and
  warns. That is why the auth opt-out (`web_manager.auth.config.policy:
  "disabled"`) lives in `src/_layouts/tower/page.html` — layouts are exempt.
- **The nav is `_includes/backend/sections/sidebar.json`**, which replaces the
  framework's file wholesale. It is the `backend` spelling rather than `admin`
  because the shell layout picks the admin pair only for URLs containing
  `/admin`, and the tower's pages sit at clean top-level URLs.
- **The repo selector is page chrome, not the sidebar's `selector` block.** The
  roster is fetched at runtime; the sidebar JSON is baked at build time.
- **Charts are Chart.js, pulled in through `omega.dom().loadScript()`** — the
  framework's own dynamic-loading module. No charting dependency is declared
  here.
- **The API origin is written once**, in `assets/js/libs/tower/api.js`, and is
  overridable per page load with `?api=http://host:port`.
