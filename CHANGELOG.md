# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry is one short paragraph starting with its issue link; the depth lives in the commit it links to. Format rules: `docs/project-state.md` → "CHANGELOG entries".

## [Unreleased]

### Changed

- [#84](../../issues/84) — An interactive `workkit setup` asks whether to publish the dashboard to GitHub Pages and records the answer, so going live no longer means knowing to hand-edit a file; `site.publish` seeds as null, the unanswered state, and `true` or `false` is never asked again.

## [0.15.0] - 2026-07-29

### Changed

- [#81](../../issues/81) [`676d1e0`](../../commit/676d1e0) Thanks [@ianwieds]! — The published site bakes no data and works like the local one: a GitHub token in the browser unlocks Overview, Board and Brief off-machine, reads them and moves and files issues too; Crew, Usage and Health are local only. `site.board`, the board snapshot and `workflow/site-data.js` are gone.

## [0.14.0] - 2026-07-29

### Changed

- [#80](../../issues/80) [`737c8c4`](../../commit/737c8c4) Thanks [@ianwieds]! — The machine's `~/.workkit` splits by who writes each file: `settings.json` is hand-edited and holds one nested `site` key (`repo`, the new all-or-nothing `publish` switch, `url`), `.repos.json` carries the roster and the declines, and `.cache.json` carries the GitHub node ids and the upstream-news cursor.

## [0.13.1] - 2026-07-29

### Fixed

- [#73](../../issues/73) [`6fc484d`](../../commit/6fc484d) Thanks [@ianwieds]! — The daily job makes its own log directory, so a home without `~/Library/Logs` no longer fails the run at its first append.
- [#75](../../issues/75) [`6fc484d`](../../commit/6fc484d) Thanks [@ianwieds]! — Only a real heal from a real workkit checkout writes the engine's address at `~/.claude/workkit`: a `--state` probe and a fixture copy leave the machine's own address alone, and `workkit setup|update` asks for that step by name with `standards.sh --engine-link`.
- [#78](../../issues/78) [`6fc484d`](../../commit/6fc484d) Thanks [@ianwieds]! — Setup's dependency install verifies its outcome and runs once more when the workspace bins are still unlinked, which is what npm's own linking needs on a fresh tower clone.

### Changed

- [#74](../../issues/74) [`6fc484d`](../../commit/6fc484d) Thanks [@ianwieds]! — The issue-guard scrub covers the GraphQL door: a `gh api graphql` call carrying a discussion or issue mutation gets the same env-value and token-shape scan, body file included, while queries stay unblocked.

## [0.13.0] - 2026-07-29

### Changed

- [#79](../../issues/79) [`ff72baa`](../../commit/ff72baa) Thanks [@ianwieds]! — The site options (`site.url`, `site.board`) moved to `~/.workkit/settings.json`, and the tower clone carries no `.workkit/` at all: it is engine territory, never hand-edited, so a capture made outside every project is filed straight onto the home repo as a `status:inbox` issue and the board discovers the clone by path.

## [0.12.0] - 2026-07-29

### Changed

- [#77](../../issues/77) [`a7e5828`](../../commit/a7e5828) Thanks [@ianwieds]! — `~/.workkit` is a plain folder again, and the one git repo in the global layer is `~/.workkit/tower` — the home repo, seeded from this kit's `tower/app` as a real site project. Its `config/workkit.json` holds the site options, its inbox takes user-level captures, and the dashboard publishes to `gh-pages`.

## [0.11.0] - 2026-07-28

### Changed

- [#40](../../issues/40) [`502886f`](../../commit/502886f) Thanks [@ianwieds]! — The global layer is `~/.workkit` and one optional home repo: the engine keeps a self-maintaining roster the tower reads instead of walking a filesystem root, and the summaries step's local file path is gone — a generated record never lives as a file.
- [#27](../../issues/27) [`502886f`](../../commit/502886f) Thanks [@ianwieds]! — The home repo is real: `workkit setup` creates the private `<login>/workkit` and converts `~/.workkit` into its clone in place, summaries publish as Discussions instead of skipping, the opted-in repos travel between machines as slugs in `workkit.json`, and the dashboard is built locally and served from the repo by GitHub Pages.

### Removed

- [#76](../../issues/76) [`502886f`](../../commit/502886f) Thanks [@ianwieds]! — The one-time migrations are out of the everyday runners: the label `migrations` map, the `.workflow/` → `.workkit/` rename, the old engine-link removal, the retirement of the 3am agent, and the news-mark move. A rename is applied once at rename time, not carried forward by standing code.

## [0.10.0] - 2026-07-28

### Added

- [#71](../../issues/71) [`a1fac9c`](../../commit/a1fac9c) Thanks [@ianwieds]! — One `workkit` command for onboarding, setup, and upkeep, with the standards hook's daily run keeping the machine's own installs current.

## [0.9.0] - 2026-07-28

### Changed

- [#68](../../issues/68) [`eab668c`](../../commit/eab668c) Thanks [@ianwieds]! — One daily cron instead of two: the 9am job now writes the nightly summaries first and then composes the brief, so the morning reads a record that already includes the day behind it; a summaries failure is logged and the brief still goes, and `jobs/install.sh` retires the old 3am agent.
- [#67](../../issues/67) [`eab668c`](../../commit/eab668c) Thanks [@ianwieds]! — Job state now lives under one directory, `~/.workkit/jobs/`, so the upstream-news mark no longer sits loose beside `settings.json`; a mark at the old path moves itself on the next run.

### Fixed

- [#59](../../issues/59) [`eab668c`](../../commit/eab668c) Thanks [@ianwieds]! — The `safety:issue-guard` hook now loads `.env` values from the repo root as well as the session's cwd, so a session in a subdirectory still matches them, and `safety:inbox-guard` now gates a Grep pointed at `.workkit/inbox.md`, leaving repo-wide searches open.
- [#63](../../issues/63) [`eab668c`](../../commit/eab668c) Thanks [@ianwieds]! — The `safety:vendor-guard` hook now treats `dist/` and `build/` as output only when they sit directly under a package root (the repo root or a directory holding a `package.json`), so a committed source tree like `src/test/suites/build/` is editable again while a package's real output still bounces.

## [0.8.0] - 2026-07-28

### Added

- [#58](../../issues/58) [`61867ee`](../../commit/61867ee) Thanks [@ianwieds]! — The `safety:commit-language` hook now also reads the subject line: it bounces a subject that is not Conventional Commits (`<type>(<scope>): <subject>`, lowercase start, 72 characters) or that carries a version number outside the `chore(release)` commit, with merge, revert and fixup subjects exempt.

### Fixed

- [#61](../../issues/61) [`61867ee`](../../commit/61867ee) Thanks [@ianwieds]! — The daily heal's stale-claim sweep now also moves a released issue from `status:building` back to `status:specced`, so an abandoned claim stops reading as in-flight work, and the tower Overview's "In flight" number counts a claim the way the brief does — an assignee or the `agent:working` label.

## [0.7.0] - 2026-07-28

### Added

- [#60](../../issues/60) [`b037acf`](../../commit/b037acf) Thanks [@ianwieds]! — A fifth pipeline state, `status:building`, marks in-flight work from build start to ship close; the tower board gains a Building column, and a missing or doubled status label now flags the daily heal instead of warning once a day.

## [0.6.0] - 2026-07-28

### Added

- [#39](../../issues/39) [`9e57693`](../../commit/9e57693) Thanks [@ianwieds]! — A 3am nightly job writes up the day that just ended: Claude samples the last 24 hours of session transcripts and commits, and its summary is filed in HQ as `summaries/daily/YYYY-MM-DD.md`, with a weekly rollup on Sundays and a monthly on the 1st.

## [0.5.0] - 2026-07-28

### Added

- [#13](../../issues/13) [`35bc848`](../../commit/35bc848) Thanks [@ianwieds]! — `wk.sh note "the thought"` captures a note from any shell in one line: the engine's new CLI walks up from the current directory and appends the bullet to the participating repo's `.workkit/inbox.md`, or to `~/.workkit/inbox.md` outside one, creating a missing inbox from the template.
- [#57](../../issues/57) [`35bc848`](../../commit/35bc848) Thanks [@ianwieds]! — Every repo is assumed public, so issue and PR text carries no secrets: the spec says it and the new `safety:issue-guard` hook blocks a `gh issue`/`gh pr` write whose outbound text holds a local `.env` value or a token-shaped string, naming the key or the kind and never the match.
- [#3](../../issues/3) [`35bc848`](../../commit/35bc848) Thanks [@ianwieds]! — The daily heal keeps a repo's `.gitignore` carrying the two entries every repo needs, `.DS_Store` and `.env`, appending only the ones nothing already covers.
- [#4](../../issues/4) [`35bc848`](../../commit/35bc848) Thanks [@ianwieds]! — `.workkit/inbox.md` is the owner's scratchpad: the new `safety:inbox-guard` hook blocks reading its contents outside a triage run, which the `workkit:triage` skill opens with a marker, while counting and appending stay free.
- [#51](../../issues/51) [`35bc848`](../../commit/35bc848) Thanks [@ianwieds]! — The tower app documents its FontAwesome Pro supply: the omega icon chain already resolves Pro once it is provided, so a new `tower/app/.env.example` carries the `OMEGA_FONTAWESOME_ROOT` line and the tower README names both supply routes.

## [0.4.0] - 2026-07-28

### Added

- [#46](../../issues/46) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — An agent's activity is one wordless glyph on the Crew and Overview pages: spinning green while its transcript moves, still and faint for the rest of the minute, gone once quieter than that, with how fresh it is beside it. A claimed `specced` Board card carries the still glyph too.
- [#50](../../issues/50) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — Clicking a crew card opens a dialog for that agent: its last tool call and when, model, effort, spend, uptime and transcript path. `/api/sessions` and `/api/telemetry` now carry the timestamps, the last tool call and the transcript paths it reads.
- [#56](../../issues/56) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — `.workkit/session.md` is read back at every session start by the new `docs:session` hook, so a compacted or restarted agent picks up its own task queue; past ~40 content lines it says the file is a queue, not a journal. The template and the manager instruction say the same.
- [#54](../../issues/54) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — `npm run brief` (`jobs/claude-daily.sh --now`) runs the daily brief on demand through the same pipeline, log file and notification, stamped `(manual)` and leaving the upstream-news mark for the 9am job.
- [#48](../../issues/48) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — A Board card is dragged between the status columns and the drop really relabels the issue, through a new validated `POST /api/issues/status` that removes the old label and adds the new one in one `gh issue edit`. The card moves at once and goes back if the write fails.

### Changed

- [#47](../../issues/47) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — The Crew page reads as a chart: each connector flows the way it runs from parent to child, each tree is headed by its repo, every card wears its role as an icon, and the finished subagents moved to one page-global switch, off by default.
- [#52](../../issues/52) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — Issue anatomy gains the introduction rule: the first mention of an outside project or repo, in a body or a comment, carries a link and a one-line description of what it is. The triage and feature skills point at it.
- [#26](../../issues/26) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — The tower dashboard knows whether it has a tower to read: a published build with no `?api=` or `window.TOWER_API` override arms no feeds and makes no requests, drawing one muted line in place of its data, and the intake dialog opens inert carrying the same sentence.

### Fixed

- [#42](../../issues/42) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — Two tower nits: an issue list keeps its list semantics, the button role moved off the `<li>` onto an inner element, and the chrome is drawn in two pieces so a poll refreshes the stamp without rebuilding the repo `<select>` — a dropdown open mid-poll stays open.
- [#49](../../issues/49) [`c10a0c6`](../../commit/c10a0c6) Thanks [@ianwieds]! — Three tower nits: a session's cache column reads green for a cache read and red for a miss, the Board's clear-filter button is always there instead of appearing with the first filter, and a Board column's title sits clear of the rule under it.

## [0.3.0] - 2026-07-27

### Added

- [#18](../../issues/18) [`8990452`](../../commit/8990452) Thanks [@ianwieds]! — Two warn-only manager hooks: `manager:spawn-guard` flags a crew spawn carrying a hand-passed model and an advisor spawn from a frontier session; `manager:close-guard` flags a frontier session that did the bulk editing itself and worker output that ended the turn unreviewed. Neither blocks.
- [#37](../../issues/37) [`8990452`](../../commit/8990452) Thanks [@ianwieds]! — The 9am brief carries upstream Claude Code news: `jobs/cc-news.js` reads the raw CHANGELOG and appends every entry newer than the last brief as a topic-grouped `CC NEWS` block; the digest judges what could break or improve the kit. A network failure skips silently.

### Changed

- [#45](../../issues/45) [`85ac0cb`](../../commit/85ac0cb) Thanks [@ianwieds]! — The tower drops its local copies of four pieces OMEGA now ships: the markdown renderer and the refresh-in-place primitives come from `@omega.js/client`, the chart helpers from the web core layer, and the tone badges, the interactive affordance and the crew org chart's connectors from the framework's stylesheets.

## [0.2.0] - 2026-07-27

### Added

- [#36](../../issues/36) [`816ef81`](../../commit/816ef81) Thanks [@ianwieds]! — The 9am daily brief arrives as `jobs/`: `brief-payload.js` composes the tower's brief without the tower, `claude-daily.sh` sends it headless and notifies with the headline, and `install.sh` loads the LaunchAgent for this checkout.
- [#24](../../issues/24) [`2c3e6d4`](../../commit/2c3e6d4) Thanks [@ianwieds]! — A unit suite over the tower dashboard's browser JavaScript: `tests/tower/app.test.js` imports the pure libs under Node and covers the repo-selection narrowing, the formatting edges, and the crew tree.
- [#20](../../issues/20) [`6f84b77`](../../commit/6f84b77) Thanks [@ianwieds]! — Tower v2, mission control: the API splits to `tower/api/` and serves JSON only, the dashboard becomes an OMEGA app on 4300 with six pages, and new telemetry and brief endpoints add token accounting, subagent attribution, and the daily brief. CORS on the existing allowlist lets the two halves talk.
- [#17](../../issues/17) [`0783c2a`](../../commit/0783c2a) Thanks [@ianwieds]! — The tower: a one-page dashboard serving the cross-repo issue board, live Claude sessions, per-repo health tiles, and an intake box that files an inbox issue.
- (no issue) — Extracted from the dotfiles: the hook groups, class agents, workflow skills, and the engine (dotfiles issue #23).

### Changed

- [#44](../../issues/44) [`c1042c5`](../../commit/c1042c5) Thanks [@ianwieds]! — The tower app is a full OMEGA-style project: the manage cycle runs to convergence at `tower/app`, generating the agent-docs chain and its run state, with deploy-facing surfaces deliberately absent for an embedded localhost dashboard.
- [#16](../../issues/16) [`b2e3702`](../../commit/b2e3702) Thanks [@ianwieds]! — The three tellings collapse to one: `docs/project-state.md` is the only normative text, AGENTS.md keeps architecture and points at the spec, and the README keeps the human summary and its charts. A rule change now touches one file.
- [#35](../../issues/35) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — Models and crew classes are drawn as coloured badges everywhere they appear, and the Usage charts use the same colours; every clickable issue card warms and lifts under the pointer and settles on press.
- [#34](../../issues/34) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — The Overview's lists stop at five with a line to the page holding the rest, health is ranked worst-first, the queue by status is a doughnut, and the panel links carry no underline.
- [#33](../../issues/33) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — Every board card is one size: the title clamps to two lines, the repo line truncates, and the chips stay on one row. The whole of all three is in the dialog the card opens.
- [#30](../../issues/30) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — A Crew root card is titled `repo/chat` and a subagent card leads with its class, demoting the agent id to the muted line under it.
- [#31](../../issues/31) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — Clicking an issue anywhere on the tower opens it in a dialog — status, chips, the body rendered, holder, dates and comment count — instead of leaving for GitHub. The box-with-arrow button is the only thing that does, in a new tab.
- [#32](../../issues/32) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — Tower pages refresh in place: a first paint shows a spinner naming the read, a poll that changed nothing writes nothing, and a failed refresh keeps the last good answer on screen instead of clearing the page.
- [#29](../../issues/29) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — The Crew page draws a real org chart: a trunk from each session down to a bus, a moving line into every working subagent, and the same tree on its side under 768px.
- [#22](../../issues/22) [`2c3e6d4`](../../commit/2c3e6d4) Thanks [@ianwieds]! — The tower's page modules read the one shape `/api/telemetry` defines and nothing else: the Usage page draws the endpoint's aggregates or says it has none, and the issue chips the Board and the Brief both draw come from one helper.
- [#23](../../issues/23) [`2c3e6d4`](../../commit/2c3e6d4) Thanks [@ianwieds]! — The Brief page reads `/api/brief` through the page runtime's feed table, so the poll cadence and the Refresh button are the same ones every other page uses.
- (no issue) — Shipped content carries no personal identifiers, enforced by the portability tests, and the engine's address is `~/.claude/workkit`, maintained by the standards heal itself; hooks resolve the engine relative to their own location.
- (no issue) — The crew map in `docs/pipeline.md` names each agent's resolved model and effort tier, and the repo is healed to its own standard (labels, issue forms, branch protection).
- [#7](../../issues/7) [`3eed629`](../../commit/3eed629) Thanks [@ianwieds]! — The v4 state model: statuses are `inbox` and `specced` (plus the `blocked`/`parked` side pockets), the issue body's plan section is `## Spec`, `agent:ok` grants the whole pipeline, assignees are claims, and the heal migrates retired labels on every participating repo.
- [#6](../../issues/6) [`3eed629`](../../commit/3eed629) Thanks [@ianwieds]! — The pipeline and crew charts are rebuilt in a simpler grammar and live in the README; `docs/pipeline.md` is retired.
- [#5](../../issues/5) [`7ec313e`](../../commit/7ec313e) Thanks [@ianwieds]! — The workflow/reload-guard hook says once, mid-session, when the kit's agents, skills, or hook wiring changed after loading — the case `/reload-plugins` exists for.
- [#9](../../issues/9) [`7ec313e`](../../commit/7ec313e) Thanks [@ianwieds]! — CHANGELOG format is enforced in CI: the heal vendors the linter into each repo's `.github/` and the seeded checks workflow lints the `[Unreleased]` section, so every maintainer hits the same gate.
- [#14](../../issues/14) [`7ec313e`](../../commit/7ec313e) Thanks [@ianwieds]! — The spec doc renumbers to v4, matching the shipped state model.
- [#1](../../issues/1) [`1dbbdc0`](../../commit/1dbbdc0) Thanks [@ianwieds]! — The docs:state-check hook caches only silence: a non-zero inbox count is re-verified every session, so a drained inbox goes quiet immediately.
- [#2](../../issues/2) [`1dbbdc0`](../../commit/1dbbdc0) Thanks [@ianwieds]! — The daily heal asserts the hook layer is alive: every wired hook resolves, is executable, and parses, and missing tools are named loudly.
- [#8](../../issues/8) [`1dbbdc0`](../../commit/1dbbdc0) Thanks [@ianwieds]! — Agent claims carry the `agent:working` label; the heal releases a claim idle for 24 hours (label, assignee, and a comment naming the sweep).
- [#11](../../issues/11) [`1dbbdc0`](../../commit/1dbbdc0) Thanks [@ianwieds]! — The commit gate requires a staged CHANGELOG entry on any commit whose message closes an issue.
- [#12](../../issues/12) [`1dbbdc0`](../../commit/1dbbdc0) Thanks [@ianwieds]! — The whats-next digest orders eligible work blockers first, then bugs, shared seams, and dependent features — the order autonomy will use.
- [#15](../../issues/15) [`3e1f89d`](../../commit/3e1f89d) Thanks [@ianwieds]! — Heal bookkeeping commits (the version stamp, the current vendored linter) skip the commit gate's review and new-file checks; tests still run.

### Fixed

- [#43](../../issues/43) [`c2d4c3b`](../../commit/c2d4c3b) Thanks [@ianwieds]! — The tower's runtime-stamped classes move into the `omega-` namespace so a production `omega build` keeps their styles, and the issue dialog's external-link icon becomes the Font Awesome glyph.
- [#38](../../issues/38) [`77f0ec9`](../../commit/77f0ec9) Thanks [@ianwieds]! — `tower/README.md` no longer documents a `TOWER_ROOT` environment variable; nothing reads it, and the roster root is a library option.
- [#25](../../issues/25) [`2c3e6d4`](../../commit/2c3e6d4) Thanks [@ianwieds]! — The Crew page draws only the subagents still working: the API stamps each one `working` or `done` from the same idle window a session's state uses, and the finished ones collapse into one expandable count per session.
- [#21](../../issues/21) [`2c3e6d4`](../../commit/2c3e6d4) Thanks [@ianwieds]! — The telemetry read cache is pruned to the transcripts each collection pass named, so a long-running tower forgets the sessions that ended instead of holding their read state forever.

---

## Contributors

- [@ianwieds]

[@ianwieds]: https://github.com/ianwieds
