# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Each entry is one short paragraph starting with its issue link; the depth lives in the commit it links to. Format rules: `docs/project-state.md` → "CHANGELOG entries".

## [Unreleased]

### Fixed
- [#216](../../issues/216) — The tower now reads the rate limit as GitHub actually sends it on GraphQL: an HTTP 200 whose error type is `RATE_LIMIT` with the budget headers beside it, so the Board names the reset time instead of the bare message.

## [0.50.4] - 2026-08-28

### Fixed

- [#214](../../issues/214) [`34e3281`](../../commit/34e3281) Thanks [@ianwieds]! — Every `gh issue list` in the kit now reads up to 1,000 issues instead of 100: the heal's label check and the status brief no longer stop silently at the first hundred open issues of a large repo.
- [#213](../../issues/213) [`34e3281`](../../commit/34e3281) Thanks [@ianwieds]! — The tower now tells a spent GitHub rate limit apart from a refused token: the local sweep and the published copy both read the rate-limit headers and name the reset time in the reader's own clock, so the Board says when the limit lifts.

## [0.50.3] - 2026-08-27

### Fixed

- [#208](../../issues/208) [`6b9dc8c`](../../commit/6b9dc8c) Thanks [@ianwieds]! — The ship skill names the full 40-character sha for the release target; a short sha is rejected.

## [0.50.2] - 2026-08-27

### Fixed

- [#208](../../issues/208) [`3d94c28`](../../commit/3d94c28) Thanks [@ianwieds]! — Every version bump now gets a GitHub release, private repo or not; only npm publish and deploy stay gated. The 59 workkit versions that had none were backfilled at their release commits.

## [0.50.1] - 2026-08-27

### Changed

- [#207](../../issues/207) [`fb60489`](../../commit/fb60489) Thanks [@ianwieds]! — The kit ships under the Functional Source License (FSL-1.1-MIT): use, change and share it freely, never as a competing product, and each release turns MIT two years on. Test fixtures no longer carry the owner's paths or handle.

## [0.50.0] - 2026-08-27

### Added

- [#206](../../issues/206) [`175d2d0`](../../commit/175d2d0) Thanks [@ianwieds]! — `workkit:checkpoint` hardens a long chat into issues before you compact: every finding, decision and open question routed to its one home, `.workkit/agents/session.md` trimmed to what is in flight, and a Filed trail ending in "Safe to compact."

### Changed

- [#205](../../issues/205) [`175d2d0`](../../commit/175d2d0) Thanks [@ianwieds]! — A blocked card on the Board no longer draws its last comment under the title; the open question now lives in the issue dialog, labelled as such.

## [0.49.0] - 2026-08-27

### Added

- [#194](../../issues/194) [`f045c62`](../../commit/f045c62) Thanks [@ianwieds]! — The board sweep pages past 100 open issues per repo, to a ceiling of 1,000, and both dashboards draw each page as it lands with a per-repo progress line; the brief still composes from a finished board.

### Changed

- [#195](../../issues/195) [`f045c62`](../../commit/f045c62) Thanks [@ianwieds]! — The board sweep's query, its bounding numbers, its node-to-issue parse and its reading of the errors that came back beside them are one shared module both halves run — the machine's `gh` sweep and a published copy's browser sweep — instead of two copies held together by drift tests.
- [#204](../../issues/204) [`f045c62`](../../commit/f045c62) Thanks [@ianwieds]! — The QA walkthrough lists EVERY issue waiting on your check, not only the ones with something to look at, and each item now names how to check it: see it, read the named evidence, or run the given command.

### Fixed

- [#200](../../issues/200) [`f045c62`](../../commit/f045c62) Thanks [@ianwieds]! — The home clone is never downgraded or wedged: the tower seed, the runner and the daily sync stamp the kit version into `.workkit-version`, an older checkout writes nothing and names `workkit update` as the fix (so does `workkit doctor`), and the morning pulls its clone up to date before seeding.
- [#201](../../issues/201) [`f045c62`](../../commit/f045c62) Thanks [@ianwieds]! — The seed and the sync no longer copy the tower app's local `logs/` tree into the home clone: `logs` joins the exclude list, which a test now holds to every top-level entry of `tower/app/.gitignore`.
- [#199](../../issues/199) [`f045c62`](../../commit/f045c62) Thanks [@ianwieds]! — The release-time backfill no longer doubles a contributor handle: an entry that already carries its `Thanks [@who]!` keeps the one it has, and only an entry with no attribution is given one.

## [0.48.1] - 2026-08-26

### Fixed

- [#203](../../issues/203) [`b90839b`](../../commit/b90839b) Thanks [@ianwieds]! — The board's seven lanes share one grid: every header on one line, every lane and card one width, the pipeline and the waiting pocket drawn as two cards behind their lanes, no captions, one "showing X out of Y" line. QA wears the theme's magenta and `type:bug` its red.
- [#202](../../issues/202) [`b90839b`](../../commit/b90839b) Thanks [@ianwieds]! — The board sweep asks GitHub in batches of six repos and skips an issue GitHub dropped instead of ending the API: a 23-repo roster tripped GitHub's query limit, every issue came back empty, and the whole dashboard went down with the API.
- [#198](../../issues/198) [`b90839b`](../../commit/b90839b) Thanks [@ianwieds]! — The tower dashboard builds again on the current OMEGA: its targets moved from `apps/` to `targets/` and each page's config block moved under `config:`, with the engine, the seed and the publish build following. A clone seeded before the rename keeps a stale `apps/` tree until deleted by hand.

## [0.48.0] - 2026-08-26

### Added

- [#196](../../issues/196) [`3fdeac7`](../../commit/3fdeac7) Thanks [@ianwieds]! — The pipeline gains `status:complete` between qa and the close: a passing check moves an item there on the owner's word alone, and the ship reads that stage. Items still at `status:qa` survive a ship, listed for an include-or-delay call.

### Changed

- [#196](../../issues/196) [`3fdeac7`](../../commit/3fdeac7) Thanks [@ianwieds]! — The board reads as two regions: the five pipeline stages in stage order, and a pocket aside holding blocked and backlog, each blocked card showing the open question it waits on.
- [#191](../../issues/191) [`3fdeac7`](../../commit/3fdeac7) Thanks [@ianwieds]! — The tower `.env.example` the engine ships now models double-quoted values in every sample line, so a copy-paste starts compliant with the env lint.
- [#192](../../issues/192) [`3fdeac7`](../../commit/3fdeac7) Thanks [@ianwieds]! — The manager's file-handoff convention now requires an explicit dispatch before any brief file exists: "brief me" in chat means a summary in chat, never an artifact.
- [#190](../../issues/190) [`3fdeac7`](../../commit/3fdeac7) Thanks [@ianwieds]! — The heal now vendors the CHANGELOG linter as `.github/changelog-lint.cjs`, so a repo declaring `"type": "module"` no longer has Node read it as ESM and fail CI. A repo on the old name migrates in place, its `changelog` job repointed and only the kit's own copy removed.
- [#193](../../issues/193) [`3fdeac7`](../../commit/3fdeac7) Thanks [@ianwieds]! — tree-guard now stands aside for `git stash list` and `git stash show`: both only read stash state, and blocking a harmless lookup cost more than it protected. Every mutating stash subcommand, bare `git stash` included, still bounces.

## [0.47.1] - 2026-08-21

### Fixed

- [#189](../../issues/189) [`666ba4c`](../../commit/666ba4c) Thanks [@ianwieds]! — The commit gate's suite budget now fits grown repos: the hook timeout rises to 3000s, and a repo raises `WORKKIT_GATE_TEST_DEADLINE` (default 1500s, clamped at 2900s) in its own settings env block. The bounce message now names that path.

## [0.47.0] - 2026-08-20

### Changed

- [#188](../../issues/188) [`273d6fa`](../../commit/273d6fa) Thanks [@ianwieds]! — Unticking every project box now shows an empty board instead of the whole one: none gets its own `?repo=~` value, the selector reads No projects with the hidden count, and a subset builds up from the empty slate.

## [0.46.0] - 2026-08-20

### Added

- [#185](../../issues/185) [`dcfc6ab`](../../commit/dcfc6ab) Thanks [@ianwieds]! — The tower's project selector gains a search box: typing narrows the rows, arrows walk what is left, Enter takes the top one, and the menu scrolls with the box pinned. The All projects box also unticks every row now, and boxes never reshape the open menu.
- [#186](../../issues/186) [`dcfc6ab`](../../commit/dcfc6ab) Thanks [@ianwieds]! — Projects can be starred in that menu, and the starred ones are drawn above the rest in roster order. A favorite lives in this browser's localStorage, changes no scope and never closes the menu.

### Fixed

- [#184](../../issues/184) [`dcfc6ab`](../../commit/dcfc6ab) Thanks [@ianwieds]! — The 9am job's stale-brief marker is staged beside its final home, so the move into place is a same-filesystem rename and a half-written marker can never be read.
- [#187](../../issues/187) [`dcfc6ab`](../../commit/dcfc6ab) Thanks [@ianwieds]! — Ctrl-C ends the token mint again: the CLI discards the key in its raw screen, so at a real terminal the mint now runs under `expect`, which catches it one layer out. `script` stays the fallback.

## [0.45.0] - 2026-08-20

### Added

- [#173](../../issues/173) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — The 9am job records the newest published brief's date in `~/.workkit/brief-status.json`, and the `docs:session` hook leads with one line when it is over a whole day old — a cloud brief that stopped posting is now named at session start, with no API call there.
- [#172](../../issues/172) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — The tower says when the cloud brief stops posting: `/api/brief` carries the newest published brief's date, off the history read it already makes, and the Health and Brief pages lead with a red line naming that day. A history never published, or unreadable, says so instead.
- [#174](../../issues/174) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — `workkit setup --token` forces the Claude token step: it re-mints `CLAUDE_CODE_OAUTH_TOKEN` however young the one there is. The mint now runs on the terminal's own screen under a pty, its paste-the-code prompt visible and the run endable; the token's capture file is gone on every exit.
- [#178](../../issues/178) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — `npm start` runs the tower: a `start` script aliasing `npm run tower`, so the default command and the named one do the same thing.

### Changed

- [#175](../../issues/175) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — The checks workflow and both seeded templates run checkout and setup-node at v5, clearing the deprecated Node 20 notice every Actions run printed.
- [#177](../../issues/177) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — The tower's nav puts Health last and the Board wears its own bars-progress glyph. Every page's wait state is now a centered ring rather than a corner-flush line, and the Overview's stat grid gains an Uncommitted tile to sit even at eight.
- [#181](../../issues/181) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — The Brief page is the mornings themselves: the newest brief rendered in place, then every published brief and summary as a card opening its full text in an issues-style dialog. The texts ride the Discussions window both copies already fetched. The stat grid and issue lists left.
- [#182](../../issues/182) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — The Health page shows only what is broken: a card per dirty repo naming each fault and its remedy, an alert per unreadable checkout, the restart and stale-brief notices. Board numbers left the page, and a clean machine gets one all-clear line that waits for the feeds.
- [#183](../../issues/183) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — Overview's tiles and panel heads all point into the page that owns their depth, and every pointer carries the sidebar's repo selection — a narrowed tower no longer widens on click.

### Fixed

- [#179](../../issues/179) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — `npm run tower` keeps omega's log colors: a tower on a terminal exports `FORCE_COLOR=1` into both halves, which the fifos behind its filter had turned off, and the filter now judges each line by a color-stripped copy while printing the original. A piped run stays plain.
- [#176](../../issues/176) [`68b635a`](../../commit/68b635a) Thanks [@ianwieds]! — A published dashboard copy now judges brief freshness itself: its browser build attaches the same verdict the tower's API computes, off the history it already reads, so the stale-brief banner draws away from the machine too.

## [0.44.1] - 2026-08-19

### Fixed

- [#166](../../issues/166) [`17a9c8f`](../../commit/17a9c8f) Thanks [@ianwieds]! — The publish installs the tower clone's dependencies from inside the clone's physical path instead of `npm --prefix`, which corrupted the lockfile through a symlinked `~/.workkit` and crashed the next run.
- [#171](../../issues/171) [`17a9c8f`](../../commit/17a9c8f) Thanks [@ianwieds]! — The setup's seed install of the tower clone gets the same treatment: both passes run from the clone's physical path, so a fresh machine can no longer lay down the corrupted tree.
- [#169](../../issues/169) [`17a9c8f`](../../commit/17a9c8f) Thanks [@ianwieds]! — The dashboard's runtime-built URLs (the Settings redirect, the scope rewrite, the page tiles) now read the build's path-prefix stamp off the document, so a copy published under a path like `/workkit/` stays on-site; a root-served copy is unchanged.
- [#170](../../issues/170) [`17a9c8f`](../../commit/17a9c8f) Thanks [@ianwieds]! — `npm run tower` no longer exits silently when omega refuses to boot: the quiet filter passes `omega:`-prefixed lines, and a half ending before the dashboard announce prints one line naming it and pointing at `--verbose`.

## [0.44.0] - 2026-08-19

### Added

- [#167](../../issues/167) [`9c091de`](../../commit/9c091de) Thanks [@ianwieds]! — The tower dashboard gets a Settings page owning the GitHub token: save, clear, the permissions it needs, and the classic `repo`-scoped token a two-owner board takes instead. It is the only page that works without one, so a tokenless landing routes there; the unlock dialog and Token button retire.

### Changed

- [#168](../../issues/168) [`9c091de`](../../commit/9c091de) Thanks [@ianwieds]! — The sidebar's project dropdown lists each project once: an All projects master row over one row per repo, the name scoping to that project alone and the box building a subset. The Filter projects section retires, the boxes hide on a single project, and a subset reads `N of M`.

## [0.43.1] - 2026-08-18

### Fixed

- [#165](../../issues/165) [`2652cd9`](../../commit/2652cd9) Thanks [@ianwieds]! — The publish derives the path the site serves under and hands it to the tower build as `OMEGA_PATH_PREFIX`, so a project-site publish stops emitting root-relative assets once omega reads it.

## [0.43.0] - 2026-08-17

### Changed

- [#163](../../issues/163) [`6614a64`](../../commit/6614a64) Thanks [@ianwieds]! — The whats-next skill is renamed status (same triggers, same digest); the state skill retires to the now-gitignored `_attic/`, its published-data recipe recoverable from git history.
- [#164](../../issues/164) [`6614a64`](../../commit/6614a64) Thanks [@ianwieds]! — Simplification is now a review lens (the deletion test over the diff's additions, scored like every finding); the standalone simplify skill retires to the attic.

## [0.42.1] - 2026-08-17

### Added

- [#162](../../issues/162) [`973f65a`](../../commit/973f65a) Thanks [@ianwieds]! — A parity test pins the docs/hooks.md index, its detail sections, and AGENTS.md's spelled-out hook count to the wiring in hooks.json, both directions.

## [0.42.0] - 2026-08-17

### Changed

- [#161](../../issues/161) [`b5f96df`](../../commit/b5f96df) Thanks [@ianwieds]! — The AGENTS.md budget now judges line length as well as line count: board-guard bounces any line over 400 bytes, state-check announces it, and AGENTS.md itself becomes a pointer-only entry, its hook table and per-topic detail moved into the new docs/hooks.md and the folder READMEs.

## [0.41.0] - 2026-08-17

### Fixed

- [#159](../../issues/159) [`4b44293`](../../commit/4b44293) Thanks [@ianwieds]! — The commit gate now blocks a `pushd`-worded directory change the way it blocks `cd`, and fails closed with a named fix when a commit runs from outside any repository, instead of silently skipping every check.

### Added

- [#157](../../issues/157) [`4b44293`](../../commit/4b44293) Thanks [@ianwieds]! — A new tree-guard hook blocks tree-discarding git commands (`checkout` with paths, `switch --discard-changes`, `restore`, `stash`, `clean -f`, `reset --hard`) so an agent cannot erase another's uncommitted work; a deliberate discard escapes with `WORKKIT_ALLOW_DISCARD=1`.

### Changed

- [#158](../../issues/158) [`4b44293`](../../commit/4b44293) Thanks [@ianwieds]! — The tower now opens with a starting line and shows the dev server's own logs: the app half turns loose at omega's first `[web]` line, hiding only the manage-cycle wall. A drop list removes known-benign noise like the `objc` warning.
- [#160](../../issues/160) [`4b44293`](../../commit/4b44293) Thanks [@ianwieds]! — The whats-next digest now briefs every issue by its outcome in the product, opens the owner-check section as a command-first QA walkthrough, groups the queue into themed batches, and gains `qa` and `build` modes.

## [0.40.0] - 2026-08-06

### Fixed

- [#155](../../issues/155) [`120594b`](../../commit/120594b) Thanks [@ianwieds]! — The commit gate no longer silently skips a stage-and-commit compound: it fails closed on staging inside the commit command, and says so out loud whenever the suite stands down.

### Changed

- [#156](../../issues/156) [`120594b`](../../commit/120594b) Thanks [@ianwieds]! — The whats-next digest opens with a per-label tally, gives every issue a one-to-two sentence brief, and ends with one explicit recommendation: the next item or a logical grouping.

## [0.39.0] - 2026-08-06

### Changed

- [#153](../../issues/153) [`274f231`](../../commit/274f231) Thanks [@ianwieds]! — The kept-on-purpose status is renamed from status:parked to status:backlog across the label SSOT, the spec, the skills, and the tower; existing repos convert with a one-time label rename.
- [#154](../../issues/154) [`274f231`](../../commit/274f231) Thanks [@ianwieds]! — The manager profile now injects two visibility rules every prompt: keep a todo checklist current through multi-step work, and announce every crew spawn with its class, model, and mandate.

## [0.38.1] - 2026-08-06

### Changed

- [#152](../../issues/152) [`14a0319`](../../commit/14a0319) Thanks [@ianwieds]! — The worker and verifier class contracts now scope mid-work testing: a worker proves its change with the test files it touched, a verifier runs the narrowest command that checks the claim, and full suites belong to the commit gate alone.

## [0.38.0] - 2026-08-06

### Changed

- [#148](../../issues/148) [`54483ff`](../../commit/54483ff) Thanks [@ianwieds]! — agent:ok now composes with status:qa: the qa stage belongs to every issue and the label decides who performs the check, the owner or the agent itself.
- [#151](../../issues/151) [`54483ff`](../../commit/54483ff) Thanks [@ianwieds]! — The commit gate runs the test suite only when the staged diff contains code: docs-only commits and a version-only bump in package.json or .claude-plugin/plugin.json skip it, any staged code line still gates, and a code extension now outranks a docs path, so `hooks/docs/*/run.sh` is code to both hooks.

## [0.37.0] - 2026-08-06

### Added

- [#150](../../issues/150) [`7ee9165`](../../commit/7ee9165) Thanks [@ianwieds]! — `workkit heal [repo]` re-runs the standards heal on the repo you stand in, or the one you name, without waiting for the session hook's once-a-day pass.

## [0.36.0] - 2026-08-05

### Added

- [#135](../../issues/135) [`c663968`](../../commit/c663968) Thanks [@ianwieds]! — The pipeline gains `status:qa` between building and the close: built work parks in the working tree, the issue flips with a comment naming what to check, and the owner's word ships it. `agent:ok` is redefined as fully autonomous through the ship, so it never co-exists with `status:qa`.

### Changed

- [#147](../../issues/147) [`c663968`](../../commit/c663968) Thanks [@ianwieds]! — The ship skill now takes the owner's own word as its invocation — "ship it" runs it exactly as `/workkit:ship` does — while a passing mention does not, and an invocation authorizes that one ship alone.
- [#149](../../issues/149) [`c663968`](../../commit/c663968) Thanks [@ianwieds]! — A label colour is now unique within its group and shared across groups: `type:` becomes red/orange/purple, `priority:high` the alarm red, `priority:low` the faint gray, every hex its board token's light value. Status chips gain glyphs, and the tower's brand hex turns blue.

## [0.35.0] - 2026-08-05

### Changed

- [#146](../../issues/146) [`1321700`](../../commit/1321700) Thanks [@ianwieds]! — `.workkit/` splits by owner: `capture.md` is the owner's one editable file (renamed from `inbox.md`), all agent state lives under `agents/`, and the guard hook renames to `capture-guard`. No backwards compatibility; the three participating repos move by hand.

## [0.34.1] - 2026-08-05

### Fixed

- [#145](../../issues/145) [`c45b8a5`](../../commit/c45b8a5) Thanks [@ianwieds]! — The inbox guard now gates writes: the agent clears the owner's inbox only during a triage run and never appends to it, and the change-tracker stops offering the file as a filing fallback when GitHub is unreachable.

## [0.34.0] - 2026-08-05

### Changed

- [#144](../../issues/144) [`a69b639`](../../commit/a69b639) Thanks [@ianwieds]! — The interview now grills: a mandated category sweep asked in chat rounds with recommendations, closing by writing the `## Spec` from the answers. The feature skill enters plan mode on large tasks, whats-next ends in a ranked restated queue, and both skills block the AskUserQuestion tool.

## [0.33.4] - 2026-08-05

### Fixed

- [#143](../../issues/143) [`32534c1`](../../commit/32534c1) Thanks [@ianwieds]! — The 9am morning now reconciles the cloud brief's seeded runner on the home repo, ahead of the dispatch that consumes it, so a checkout that moved on no longer publishes stale briefs until someone re-runs `workkit setup`. A copy already current writes and commits nothing.

## [0.33.3] - 2026-08-04

### Fixed

- [#142](../../issues/142) [`1ce6f9b`](../../commit/1ce6f9b) Thanks [@ianwieds]! — Board and Crew polish: empty-state icons are centered, the card's top-right corner is one shared slot (gear flush at rest, the open button fading in over it on hover), and the crew role glyph wears the theme's icon tile in its per-role color.

## [0.33.2] - 2026-08-04

### Changed

- [#141](../../issues/141) [`0afa392`](../../commit/0afa392) Thanks [@ianwieds]! — A Board card on `status:building` spins its gear, held or not: the status itself says the work is in motion. A claimed specced card keeps the still gear, a claim at rest.

## [0.33.1] - 2026-08-04

### Fixed

- [#140](../../issues/140) [`b187fc2`](../../commit/b187fc2) Thanks [@ianwieds]! — The tower dashboard is restyled onto omega 0.21.0's rebuilt theme: every `classy-*` class the app composes is renamed to its `omega-*` equivalent, so the pages that rendered as bare text after the framework's base/skin rebuild draw correctly again.

## [0.33.0] - 2026-08-04

### Added

- [#136](../../issues/136) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — Board cards and the issue dialog wear one glyph per type and priority, from a single mapping the pages may not bypass, spaced and centered on the chip's text.
- [#134](../../issues/134) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — A restarted or compacted session tells the owner the state carried over: a visible "say continue to resume" line at session start, and the injected state now ends with the manager's duty to open in plain words.

### Changed

- [#139](../../issues/139) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — Questions to the owner are self-contained: briefed in chat first, full background in the question, options as plain outcomes; the rule lives in the crew contract and the manager injection.
- [#133](../../issues/133) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — The report half of the file-handoff convention flips to match reality: an agent's final message IS its report, and a report file is the explicit-ask exception; all five agent prompts and the review skill follow.
- [#131](../../issues/131) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — The crew contract draws the self-edit line: the manager edits inline only when doing it costs fewer tokens than briefing a worker; anything larger goes to a worker and its blind verify.
- [#132](../../issues/132) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — The change-tracker nags once per change: it fingerprints the tree (diff, untracked content, inbox) into `.workkit/` and stays silent on every stop where nothing moved.
- [#138](../../issues/138) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — `workkit tower` is quiet by default: child output filtered to problem lines plus one dashboard-URL announcement, `--verbose` restores the wall, and either half ending still ends both.

### Fixed

- [#137](../../issues/137) [`1d649c0`](../../commit/1d649c0) Thanks [@ianwieds]! — The tower's activity glyph is a gear that turns about its own center: the Crew page's spinner no longer wobbles, and a claimed Board card's still glyph no longer reads as a broken loader.

## [0.32.1] - 2026-08-04

### Fixed

- [#130](../../issues/130) [`c4328b6`](../../commit/c4328b6) Thanks [@ianwieds]! — The publish installs the clone's dependencies when its manifests moved: the sync reports a manifest write, and npm's own install stamp is the memory, so a switch-off run's leftover or a failed install is asked again the next morning instead of building against a stale tree.

## [0.32.0] - 2026-08-04

### Added

- [#129](../../issues/129) [`f69c3cb`](../../commit/f69c3cb) Thanks [@ianwieds]! — Every publish syncs the home clone from `tower/app` by content and mints the brand assets when it must; a failed mint or a part-refreshed sync aborts before anything publishes, and the failure is remembered until a mint succeeds. A ship whose diff touched the tower republishes the dashboard.
- [#128](../../issues/128) [`f69c3cb`](../../commit/f69c3cb) Thanks [@ianwieds]! — The skills docs are pinned to the directory: a test derives the skill list from `skills/` and fails when the AGENTS.md table or the README enumeration misses a skill or keeps a departed one.

## [0.31.0] - 2026-08-04

### Added

- [#127](../../issues/127) [`96f8e1a`](../../commit/96f8e1a) Thanks [@ianwieds]! — The issue dialog says what an issue waits on and what it blocks, both read off the board already in memory, each named issue opening its own dialog.
- [#106](../../issues/106) [`96f8e1a`](../../commit/96f8e1a) Thanks [@ianwieds]! — `workkit:parallel`, the opt-in eleventh skill: the manager groups a batch by dependency edges, seams, then size, runs a worktree-isolated crew per group concurrently, lands the groups serially with the suite green between, and one ship closes the batch.
- [#53](../../issues/53) [`96f8e1a`](../../commit/96f8e1a) Thanks [@ianwieds]! — The tower has a brand: one authored amber tower glyph and one hex in config, from which the omega assets service mints the sidebar mark, the favicon set, and the social image, and the theme composes both modes' accent ramps.

## [0.30.1] - 2026-08-03

### Added

- [#69](../../issues/69) [`78cfd64`](../../commit/78cfd64) Thanks [@ianwieds]! — `docs/cloud.md`: provisioning a remote session — what travels through git, the setup-script recipe, environment secrets, and what stays machine-bound with its cloud twin. The bootstrap itself is the personal repo's build, filed there.

## [0.30.0] - 2026-08-03

### Added

- [#126](../../issues/126) [`d8a0ee3`](../../commit/d8a0ee3) Thanks [@ianwieds]! — session.md stays lean by machine: the `docs:session-guard` hook bounces a write leaving the file over 40 content lines or a bullet over 350 characters, ship's close step deletes the entries a ship completed, and the SessionStart injection keeps warning past the same bar.

## [0.29.0] - 2026-08-03

### Added

- [#103](../../issues/103) [`7e2448f`](../../commit/7e2448f) Thanks [@ianwieds]! — Issues can depend on each other, natively: `gh issue edit --add-blocked-by` writes an edge, the sweep reads it, `nextUp` and the digest order a waiting issue after its blocker, Board cards wear a "waits on" chip, and a List | Graph toggle draws the dependency graph.
- [#100](../../issues/100) [`7e2448f`](../../commit/7e2448f) Thanks [@ianwieds]! — Triage gains the HQ pass: every run drains the home repo's own `status:inbox` issues from any repo, and where captures cluster around one not-yet-project it proposes graduation — transfer or recreate onto a real repo, created and enabled only on the owner's word.

## [0.28.0] - 2026-08-03

### Added

- [#55](../../issues/55) [`fcb0fc8`](../../commit/fcb0fc8) Thanks [@ianwieds]! — The tower charts the board's history: each morning's brief carries a machine-readable stats line, the Overview draws the queue by status over time, closed per day, inbox depth and week-over-week deltas, and the Brief gains a seven-day sparkline row — locally and on the published copy alike.

### Changed

- [#125](../../issues/125) [`fcb0fc8`](../../commit/fcb0fc8) Thanks [@ianwieds]! — The ship skill picks the version bump itself (patch for fixes, minor for new capability) and states the pick in the ship summary; only a breaking major asks.

## [0.27.0] - 2026-08-03

### Added

- [#54](../../issues/54) [`09dbc87`](../../commit/09dbc87) Thanks [@ianwieds]! — `workkit brief` dispatches today's cloud brief on demand (`--local` rehearses here), and the brief gains three sections: a per-repo "work on this next" list, yesterday's summary Discussion, and the weekly rollup on Mondays.

### Fixed

- [#124](../../issues/124) [`09dbc87`](../../commit/09dbc87) Thanks [@ianwieds]! — The aliveSince test assertion is now a two-sided recency window, so the suite no longer loses a birth-time clock race on CI runners.

## [0.26.0] - 2026-08-02

### Added

- [#123](../../issues/123) [`3a0668c`](../../commit/3a0668c) Thanks [@ianwieds]! — The home repo now gets the same heal as any participating repo: `standards.sh --home` syncs labels and issue forms inside the tower clone, invoked at setup and each morning's publish, committing and pushing only when the forms changed.

## [0.25.0] - 2026-08-02

### Added

- [#122](../../issues/122) [`c15fa64`](../../commit/c15fa64) Thanks [@ianwieds]! — Capture discipline: real specs are built with the owner via interview before acceptance, new findings pass a filing litmus test (attach or create), polish nits roll up into one `polish: <surface>` issue per surface, and `/workkit:triage merge` sweeps the open board proposing merges it executes only on approval.
- [#121](../../issues/121) [`c15fa64`](../../commit/c15fa64) Thanks [@ianwieds]! — A new lint test fails any commit that puts a machine-specific path under `agents/`, `hooks/`, or `skills/`, naming the file and line.

### Changed

- [#119](../../issues/119) [`c15fa64`](../../commit/c15fa64) Thanks [@ianwieds]! — The manager standing instruction injected on every prompt is half its old size, keeping only the delegation core; the crew-sizing rules moved to `docs/agents.md`.
- [#120](../../issues/120) [`c15fa64`](../../commit/c15fa64) Thanks [@ianwieds]! — AGENTS.md's Install and home-repo prose walls are now bullet lists, the close-guard row says it warns rather than blocks, and the "generic by construction" and "one mechanism, branching by environment" conventions are written down.

## [0.24.0] - 2026-08-01

### Added

- [#70](../../issues/70) [`751cb5b`](../../commit/751cb5b) Thanks [@ianwieds]! — The Health page now names a tower API running older code than its checkout, with both short shas and the restart command, and says when the process started.

### Changed

- [#118](../../issues/118) [`751cb5b`](../../commit/751cb5b) Thanks [@ianwieds]! — The Board's "No status" column is gone: an open issue carrying no `status:` label is now a danger alert above the five lanes, naming and linking every one of them, and it appears nowhere else on the page.
- [#104](../../issues/104) [`751cb5b`](../../commit/751cb5b) Thanks [@ianwieds]! — The tower's project switch is now the selector dropdown at the top of the sidebar, filled from the roster and carrying `?repo=` onto every nav link, and the selection accepts a comma-separated subset of the roster instead of one repo.
- [#99](../../issues/99) [`751cb5b`](../../commit/751cb5b) Thanks [@ianwieds]! — An agent that goes quiet is now muted after a minute and drawn for five, on the Crew page, the Overview's crew table and the open agent dialog, instead of leaving the page the moment the minute passed.

### Fixed

- [#117](../../issues/117) [`751cb5b`](../../commit/751cb5b) Thanks [@ianwieds]! — The cloud brief's seed now removes a file under the home clone's `brief/` that the runner manifest no longer names, so a rename no longer leaves the retired copy there forever.

## [0.23.0] - 2026-07-31

### Added

- [#87](../../issues/87) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — The `workkit:state` skill loads this machine's global state when you ask for it — `~/.workkit`'s settings and roster first, and when there are none, the home repo and its private roster read back through the GitHub API — and always names the source it read.
- [#92](../../issues/92) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — `docs/history-purge.md` is the runbook for removing a leaked value from git history — the scoped rewrite, the verification, the human-run force push, and the local and server-side purges — pointed at from the ship skill's gotchas.
- [#72](../../issues/72) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — Until `workkit setup` has run, every session start now tells the agent to have you run it, in any directory and with no nag cache — a prompt, never an install.
- [#83](../../issues/83) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — The issue guard now scans `gh api` REST writes to issue and pull endpoints — a POST or PATCH, or an implied POST carrying fields — with the same env-value and token-shape scans, `--input` files included; reads of the same paths stay unblocked.

### Changed

- [#107](../../issues/107) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — The morning is one script, `jobs/morning.sh`, run by both schedulers with every step gated by what its environment can do: the summaries and the site publish name their skip on a runner, and the brief is the cloud's alone — a dispatch that fails is a logged, briefless morning.
- [#102](../../issues/102) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — The `grill` skill is now `interview` — same interrogation, wired into speccing: an issue whose spec reads unclear is a trigger for it, and "grill me" stays a phrase it answers to.
- [#94](../../issues/94) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — Every skill description is now one trigger sentence under 300 characters, and a test reads the skills directory and fails when one grows past the cap.
- [#62](../../issues/62) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — A claimed spec is now flipped rather than tolerated: the standards heal moves an open `status:specced` issue with an assignee to `status:building` with a comment, and the brief and the whats-next skill sort issues by the status label alone.

### Fixed

- [#116](../../issues/116) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — A roster that cannot be read no longer publishes an empty repo list over a good one: the composer tells a failure apart from a machine that registers nothing, and the publish keeps the list already there and warns.
- [#108](../../issues/108) [`754b569`](../../commit/754b569) Thanks [@ianwieds]! — An agent dialog left open now tells the same story as the card behind it: every paint refreshes it, so it spins while the agent works and decays only when it stops, and its freshness is said once — the header's ticking age, not the frozen row.

## [0.22.0] - 2026-07-31

### Added

- [#115](../../issues/115) [`671a74d`](../../commit/671a74d) Thanks [@ianwieds]! — The ship skill waits on the CI run of every direct push and reports a red run loudly at the top of its summary.
- [#113](../../issues/113) [`671a74d`](../../commit/671a74d) Thanks [@ianwieds]! — Turning `site.publish` off now takes the published site down — the `gh-pages` branch is deleted and Pages disabled — instead of leaving a site nobody updates.

### Fixed

- [#111](../../issues/111) [`671a74d`](../../commit/671a74d) Thanks [@ianwieds]! — The repo list on the home repo's default branch is refreshed by every publish run, whether or not a site is published, so the cloud brief's roster stays current either way.
- [#114](../../issues/114) [`671a74d`](../../commit/671a74d) Thanks [@ianwieds]! — The four tests that assumed a Mac answer for the machine they run on: the launchd cases name themselves as skips where `launchctl` is not there, the no-gh case builds the absence it needs, and the gate's tree check waits for the process to go instead of reading one instant.
- [#112](../../issues/112) [`671a74d`](../../commit/671a74d) Thanks [@ianwieds]! — The roster's readers ask for the branch it is actually on — the published pointer carries it, the cloud runner reads the repo's default branch — instead of assuming `main`.

## [0.21.1] - 2026-07-31

### Security

- [#110](../../issues/110) [`dc963e1`](../../commit/dc963e1) Thanks [@ianwieds]! — The published site no longer serves the list of repos it sweeps: the roster moves to the home repo's private default branch, the only public artifact is which repo that is, and every reader fetches the list with a token. Viewer tokens now need Contents: Read on the home repo.

## [0.21.0] - 2026-07-31

### Changed

- [#66](https://github.com/ITW-Creative-Works/workkit/issues/66) [`2e097d4`](../../commit/2e097d4) Thanks [@ianwieds]! — The tower's issue colours come from one place: status, type, and priority chips all draw from `format.js`'s tokens, the dialog says a status in its column's colour, columns read in three priority bands, and an empty panel is an icon above one line.

### Fixed

- [#65](https://github.com/ITW-Creative-Works/workkit/issues/65) [`2e097d4`](../../commit/2e097d4) Thanks [@ianwieds]! — The tower's activity indicator is live again: a one-second clock patches the drawn indicators between feed polls, so a crew card's freshness counts up in seconds and goes green-to-gray-to-gone on time, and the spinning glyph has the animation rule the bundle never carried.
- [#95](https://github.com/ITW-Creative-Works/workkit/issues/95) [`2e097d4`](../../commit/2e097d4) Thanks [@ianwieds]! — `jobs/install.sh` no longer lets a rehearsal under a scratch `HOME` rewire the real 9am job: launchd is only asked to load anything when `$HOME` is the account's real home (`WORKKIT_LAUNCHD_OK=1` forces it), and an agent already loaded from some other plist path is re-registered instead of being reported current.

## [0.20.1] - 2026-07-30

### Fixed

- [#93](../../issues/93) [`a57cb80`](../../commit/a57cb80) Thanks [@ianwieds]! — The commit gate no longer fails open when a test suite outruns the hook timeout: the gate ends the run at its own deadline and bounces the commit, and its declared timeout grew to fit the slowest suites.

## [0.20.0] - 2026-07-30

### Changed

- [#97](../../issues/97) [`690eea0`](../../commit/690eea0) Thanks [@ianwieds]! — `workkit tower` (and `npm run tower` in the checkout) starts the whole tower — the JSON API and the dashboard together, replacing any previous instance on their ports, one interrupt ending both — instead of the API alone.

### Fixed

- [#98](../../issues/98) [`690eea0`](../../commit/690eea0) Thanks [@ianwieds]! — The dashboard stopped bouncing to a sign-in gate it has no accounts for: the layout's gate-disarming key is spelled under the framework's current name for the settings blob, and a test pins the exact path.

## [0.19.3] - 2026-07-30

### Changed

- [#96](../../issues/96) [`3daa908`](../../commit/3daa908) Thanks [@ianwieds]! — The published dashboard asks for its token in a dialog instead of replacing the page: the shell stays and the unlock prompt opens over it, in the same modal the intake dialog uses, and a refused token re-presents it. The local tower-down notice is unchanged.

### Fixed

- [#89](../../issues/89) [`3daa908`](../../commit/3daa908) Thanks [@ianwieds]! — A locked dashboard on this machine says the tower is not connected and gives the two steps that fix it — start it, then a link pointing the page at it — in its body and its intake dialog, instead of asking for a token. The published prompt is unchanged.

## [0.19.2] - 2026-07-30

### Changed

- [#90](../../issues/90) [`bfad5eb`](../../commit/bfad5eb) Thanks [@ianwieds]! — `workkit setup` and `doctor` read as the handful of things they do: titled sections a blank line apart, color at a terminal and never in a log, and secrets lines naming the home repo as where the cloud brief runs and lands. `update --auto` is unchanged.

## [0.19.1] - 2026-07-30

### Fixed

- [#91](../../issues/91) [`e81956c`](../../commit/e81956c) Thanks [@ianwieds]! — The cloud brief runs on your home repo, not on this distributed one: setup seeds the workflow and the code it runs there and puts the two secrets on it, the Discussion is posted with the workflow's built-in token, and `doctor` warns when that seeded runner falls behind.

## [0.19.0] - 2026-07-30

### Added

- [#88](../../issues/88) [`eb3d1aa`](../../commit/eb3d1aa) Thanks [@ianwieds]! — `workkit setup` wires the cloud brief's secrets: it offers to mint the Claude token straight into the repo secret, sets the home token and the home slug from what the machine already knows, and re-offers a token past eleven months. `doctor` reports all three; the daily `update --auto` only warns.

## [0.18.0] - 2026-07-30

### Added

- [#82](../../issues/82) [`0ed5530`](../../commit/0ed5530) Thanks [@ianwieds]! — The morning brief runs in the cloud: the 9am job triggers a GitHub Actions workflow that composes and publishes it from a runner, and only a dispatch that cannot be made brings the brief back to the laptop, so a closed lid no longer means a quiet morning.

## [0.17.0] - 2026-07-30

### Changed

- [#85](../../issues/85) [`5c19f8e`](../../commit/5c19f8e) Thanks [@ianwieds]! — `workkit setup` publishes the dashboard before it exits whenever the switch ends on, freshly answered or already true, and a fresh yes is asked one follow-up for the custom domain, so the first site carries its CNAME.
- [#86](../../issues/86) [`1480da2`](../../commit/1480da2) Thanks [@ianwieds]! — The 9am brief publishes as a `brief: <date>` Discussion on the home repo carrying the upstream version it covered, and the news cursor is read back off that line instead of `~/.workkit/.cache.json`, so the job can run from anywhere; a runner that finds today's brief already posted skips it.

## [0.16.0] - 2026-07-29

### Changed

- [#84](../../issues/84) [`adfbdec`](../../commit/adfbdec) Thanks [@ianwieds]! — An interactive `workkit setup` asks whether to publish the dashboard to GitHub Pages and records the answer, so going live no longer means knowing to hand-edit a file; `site.publish` seeds as null, the unanswered state, and `true` or `false` is never asked again.

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
