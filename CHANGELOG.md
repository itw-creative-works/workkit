# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry is one short paragraph starting with its issue link; the depth lives in the commit it links to. Format rules: `docs/project-state.md` → "CHANGELOG entries".

## [Unreleased]

### Added

- [#18](../../issues/18) — Two warn-only manager hooks: `manager:spawn-guard` flags a crew spawn carrying a hand-passed model and an advisor spawn from a frontier session; `manager:close-guard` flags a frontier session that did the bulk editing itself and worker output that ended the turn unreviewed. Neither blocks.
- [#37](../../issues/37) — The 9am brief carries upstream Claude Code news: `jobs/cc-news.js` reads the raw CHANGELOG and appends every entry newer than the last brief as a topic-grouped `CC NEWS` block; the digest judges what could break or improve the kit. A network failure skips silently.

### Changed

- [#45](../../issues/45) — The tower drops its local copies of four pieces OMEGA now ships: the markdown renderer and the refresh-in-place primitives come from `@omega.js/client`, the chart helpers from the web core layer, and the tone badges, the interactive affordance and the crew org chart's connectors from the framework's stylesheets.

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
