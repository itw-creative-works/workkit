# The hooks: what each one does

- This file is the behavior detail behind `AGENTS.md` § Hooks, which keeps one line per hook.
- The rules the hooks enforce live in [`project-state.md`](project-state.md). This file describes how each hook executes them.
- Of the thirty-one hooks, twenty-two run in process, in the hooks module (§ The hooks module).
  - Nine guards run in the `gh` shim, the `git` shim and git's `pre-commit` and `commit-msg` hooks.
  - `hooks/hooks.json` wires no shell hook.

## How they are wired

- `hooks/hooks.json` holds one key, its `modules` list, naming the hooks module, `./register.js` (§ The hooks module).
  - Settings and the hooks log name a hook by `prefix:name`, never by a path.
- The nine guards outside the module are wired where the real action happens:
  - the `gh` shim (`workflow/identity/gh`), linked into `~/.local/bin`;
  - the `git` shim (`workflow/gitshim/git`), which the module's `classic.SessionStart` puts first on a session's PATH (§ `safety:tree-guard`);
  - and git's own hooks (`workflow/githooks/`), set as a repo's `core.hooksPath` by the heal.
- The shell left under `hooks/` is no hook.
  - `hooks/_lib.sh` and `hooks/lib/*.sh` are the library the `workflow/review/`, `workflow/triage/` and `workflow/proof/` scripts, `workflow/prove.sh` and the snapshot entry source (§ Platforms).

### The hooks log

- Every fire of a hook the hooks module runs leaves one line in `hooks.log`.
  - The nine guards' runs in the `gh` shim, the `git` shim and git's hooks leave none, since they run outside the module.
- The log lives in the workkit folder (`~/.workkit`).
  - `WORKFLOW_HOME` moves it.
  - `wk_hooks_log` in `workflow/lib/platform.sh` is the one spelling of the path.
- It has one writer: the hooks module writes every fire of a dispatch through `logFires` in `hooks/register.js`.
  - That is one read and one whole-file write with `$.fs` per dispatch.
  - The line and the cap are `hooks/mods/log.js`'s.
- The line is tab-separated: `<iso>\t<hook>\t<event>\t<session_id>\t<cwd>\t<verdict>`.
  - The time is in UTC.
  - The hook is named as settings name it (`docs:checkpoint`).
  - Then come the event, session and folder. The module names the classic event, or `agent.spawn`.
  - It asks the session for an id the event does not carry.
  - It logs the session's folder from `$.session.cwd()` wherever the input carries no session `cwd`.
  - Those are `agent.spawn`, the Agent tool's `PreToolUse` (whose `cwd` is a subagent's), and the `tool.call` chains.
- The verdict is `run`, `stood-down` or `crashed`.
  - `stood-down` means not opted in (§ Where every hook stands down).
  - The chain after a Bash call stands down only when no root it looks at opted in and the call left no gh journal line.
  - `crashed` is a guard that threw. A `tool.call` chain then refuses the call.
  - The `classic.PostToolUse` and `classic.PostToolUseFailure` Bash chains refuse nothing.
- A `tool.call` guard's fire is logged under `PreToolUse`.
- `HOOK_DISABLE=1` leaves no line.
- A log past 10,000 lines is cut to its last 5,000 before the next line is added.
- A write that fails never stops the hook.
- The module's write is a read and a whole-file write, since `$.fs` has no append.
  - So two sessions writing at the same moment can lose one of their lines, which the log accepts.
- `workkit log` prints the last 40 lines, `-n <N>` that many, and `--follow` keeps printing new ones.

## Where every hook stands down

- A hook runs only when the repo it acts on has opted in, and steps aside silently when the answer is no.
- One reader answers it: `settingsOptedIn` in `hooks/mods/gate.js`, over the repo's `.workkit/settings.json` text.
- The repos it reads differ by handler (§ The hooks module):
  - the chain after a Bash call asks two roots and the call's gh journal lines (below);
  - every other handler asks `folderOpted` in `hooks/mods/guards.js`, the repo holding one folder.
- The guards outside the module ask `wk_session_judges` (`workflow/README.md`, the `lib/participation.sh` row) of the repo the call acts in.
  - They are the `gh` shim's, the `git` shim's and git's hooks'.

- Opted in: a `.workkit/settings.json` at the repo root that parses and whose top-level `enabled` is `true`.
  - A nested `enabled` changes nothing.
  - `enabled` defaults to `false` (`defaults/settings.json`) and is read from the repo's own file alone.
  - So these all leave the repo off: no file, an empty one, `{}`, a file with no `enabled` key, one that cannot be read or does not parse, and a `true` in `~/.workkit/settings.json`.
  - The rule is the engine's (`wk_opted_in` in `workflow/lib/participation.sh`), and `test/hooks/twins.test.js` holds the reader to it.
- The repo it acts on:
  - an Edit or Write: the repo holding the file it writes, a linked file read where it really is.
    - It is walked up from the nearest folder that exists, as spelled, else from that folder's physical path.
    - `~/.claude/settings.json` and a path through `~/.claude/skills` name the dotfiles checkout only behind the link;
  - a Bash call before it runs, for `safety:capture-guard`: the repo holding the call's real folder, `$.session.cwd()` (a subagent's own in a subagent).
    - No command text is read for the gate;
  - a Bash call that already ran, for `workflow:snapshot`, `workflow:public-mirror` and `safety:script-write`: two roots, and no command text read.
    - The roots are the repo the call began in, recorded before it ran (the call's start, § The hooks module), and the repo holding the folder it ended in, the event's `cwd`.
    - Each is asked once, and only a root that opted in is kept.
    - The chain runs when a root was kept, or when the call left a gh journal line.
    - Each journal line was already kept by its own repo's opt-in (`grownLines`).
    - So a script in a plain folder that claims an issue in an opted-in repo still gets that repo's `workflow:snapshot`.
    - A guard given no line does nothing, and the disk check looks only at the kept roots;
  - anything else: the repo holding the input's `cwd`.
    - A payload with no `cwd`, and a `cwd` outside every repo, stand down.
- The safety and manager hooks stand down with the rest.
  - Two run everywhere, since they speak to the machine rather than to a repo. Both are named in `hooks/mods/gate.js`.
  - `workflow:standards` runs everywhere for its setup reminder. Its own gate keeps the heal per repo.
  - `workflow:reload-guard` runs everywhere for the restart notice.
  - The guard chains name none.

## Platforms

- The hooks run on macOS, on Windows under Git Bash, and on Linux.
- Where a spelling differs between them, the branch is taken once, never in the hook that needs it:
  - in [`hooks/_lib.sh`](../hooks/_lib.sh) for what only a hook asks;
  - in the engine's [`workflow/lib/platform.sh`](../workflow/lib/platform.sh) for what the engine asks too, which this library then points at under its own `hook_` name:

- `hook_is_macos` / `hook_is_windows` / `hook_is_linux`, over `hook_uname_s`: the platform reading.
  - `$OSTYPE` answers first: the shell sets it, so it costs no fork and needs no PATH.
  - `uname -s` answers only for a name that split does not know.
  - The dotfiles hooks load these helpers from this lib through `~/.claude/workkit`, so one mechanism spans both sides.
- `hook_sha1`: the one digest.
  - macOS ships `shasum` and no `sha1sum`, a Linux machine often the reverse, and a key computed with a different tool is a different key.
  - Every marker and cache name goes through the same digest.
  - The four markers go through `hook_review_marker_path`, `hook_triage_marker_path` (above it) and the suite and package record paths in the engine's `workflow/lib/suite.sh`, each built by `wk_marker_path`.
    - A skill writes the first two.
    - The engine's npm `script-shell` wrapper (`workflow/script-shell.sh`) and `workkit prove` (`workflow/prove.sh`) write the suite marker.
    - The same wrapper writes the package record (`wk_pkg_marker_path`): the packages a green `npm test` other than the bare root run proved on a tree.
    - `safety:proof-guard` reads the package record at the qa flip.
  - The same derivation names the three run locks and the fallback logs of the detached suite run, supervised run and CI watch (`workflow/lib/suite.sh`).
  - A machine with neither tool is refused loudly rather than keyed to an empty string.
    - An empty string would be one marker shared by every repo on it.
  - The engine keys the suite record with the same digest, so the body is `wk_sha1` in `workflow/lib/platform.sh`.
    - It sits beside `wk_marker_path`, the one derivation of a marker's path.
    - `hook_sha1` is one line pointing at it, the way `hook_jq` points at `wk_jq`.
  - Every marker kind lives at `markers/<kind>/<sha1>` in the machine folder (`${WORKFLOW_HOME:-$HOME/.workkit}/markers`, `wk_markers_dir`).
    - It never lives in the temp folder a system cleaner empties, and nothing reads a marker anywhere else.
  - The kit sweeps its own: each writer runs `wk_sweep_markers`.
    - The writers are `_hook_write_marker` (through `hook_sweep_markers`), the suite and package record writers, and the `gh` shim's journal append (`journal_append` in `workflow/identity/gh`).
    - The two record writers sweep before they write; `_hook_write_marker` and the shim sweep after theirs.
    - The sweep removes every regular file one folder under that base whose mtime is older than `MARKER_KEEP_DAYS` (7 days).
    - It never enters a folder there (a run lock).
  - The sweep is shell-only because every other marker writer is shell.
    - The module reads markers, and writes and removes one: the gh journal mark (`journalMarkPath` in `hooks/mods/markers.js`).
    - A Bash call's `tool.call` writes that mark, and its `PostToolUse` or `PostToolUseFailure` removes it.
    - So the sweep finds only a mark no call came back to.
- `hook_jq`: the CRLF-safe jq.
  - jq on Windows is a native program whose stdout is in text mode, so it writes CRLF.
  - A value read bare then carries a `\r` into whatever is compared or written next.
  - The engine reads the same JSON with the same tool, so the body is `wk_jq` in `workflow/lib/platform.sh`, and `hook_jq` is one line pointing at it.
    - The strip has one home.
    - jq's own exit status comes back, so a predicate still answers what it answered.
  - `hook_jq_default <default> <jq args...>` is the same pointer for the read that carries a default.
    - jq writes the values it parsed before it fails on a later one.
    - So a `|| printf <default>` in the substitution hands back that partial answer with the default stuck on the end of it.
    - Here the default is taken only when jq wrote nothing.
- `wk_repo_slug` / `wk_slug_from_remote`: what a repo is CALLED, which is platform-shaped too.
  - git stores a remote exactly as it was typed, so a Windows checkout's origin comes back a native path with backslashes.
  - A reader that took only a forward slash answered nothing about it.
  - The rule lives once in the engine's [`workflow/lib/slug.sh`](../workflow/lib/slug.sh). Its Node twin is `slugFromRemote` in `workflow/slug.js`.
  - The module reads it through `repoSlug` in `hooks/mods/optin.js`, over `slugFromRemote` in `hooks/mods/slug.js`.
    - That is the module's copy of the Node twin, shape for shape, since a hooks module cannot import CommonJS.
    - The three change together.
  - `safety:release-taken` names the repo in its github-release bounce through that same `slugFromRemote`.
- `wk_native_path <path>`: the spelling of a path a person reads.
  - Git Bash hands a script `/d/a/x` where Windows and Node print `D:/a/x`.
  - So every path a kit shell line prints for a person goes through it: `cygpath -m` on Windows, the path unchanged elsewhere.
  - It is git's spelling too, so a path git printed is in it already, and a roster key is written and looked up through it.
  - Node prints the native spelling already, through `path`.
- `hook_file_mtime`: BSD `stat -f` against GNU `stat -c`, each spelling accepted only when its output is digits, since the GNU one prints `?` and exits 0 for the flag it does not mean.
- `_hook_snapshot_copy` in `hooks/lib/snapshot.sh`: the snapshot copy.
  - macOS clones with `cp -c` and Linux copies with `cp --reflink=auto`, walking into a folder only where it holds a package's `node_modules`.
  - Windows streams through `tar`, one `--exclude` per such folder.
  - Every platform leaves out `.git` and each package's `node_modules`.
    - A package is a folder whose `package.json` git lists, tracked or untracked and not ignored, outside every `node_modules` (`_hook_snapshot_modules_list`).
    - The fill rebuilds those: § `workflow:snapshot`.
  - Every platform also leaves out the kit's paths inside the folder copied, by real path (`_hook_snapshot_kit_rels`).
    - Links are resolved, as when `~/.workkit` links into a dotfiles repo.
    - The snapshot home (`~/.cache/workkit/snapshot`), where the snapshot itself is built, is left out when it lies inside the folder (a repo at `$HOME`).
    - So is the kit home's markers folder (`wk_markers_dir`).
    - So is every path in the kit home (`wk_user_dir`) that git ignores in that repo (`git ls-files --others --ignored --exclude-standard --directory`).
    - So a tracked file there, or an untracked one git does not ignore, is still copied.
  - The copy walks a folder holding one the same way, and a repo's own folder of the same name elsewhere is still copied.
  - Any other `node_modules`, data inside an ignored folder, is copied as it is.
  - Given paths after its two folders, it copies only those, each one whose parent folder the destination holds.

- `hooks/_lib.sh` is the library's entry. It keeps the seam, `hook_jq`, the engine sources and the constants.
  - It sources its helper groups from [`hooks/lib/`](../hooks/lib/), one file per group, so a script still sources `_lib.sh` alone.
  - The groups: the markers, the tested package a path sits in, the working-diff path list, the red-proof snapshot.
- Its consumers:
  - the scripts the skills and agents run through `workkit review`, `workkit triage` and `workkit proof` (`workflow/{review,triage,proof}/*.sh`);
  - `workflow/prove.sh`, the snapshot entry, the CI's `.github/scripts/release-push.sh` and the dotfiles hooks.
  - No workkit hook sources it.

- The reads the module's guards share each have one home under `hooks/mods/`:
  - `facts.js`: the Bash guards' facts (`bashFacts`, its one home) and the variables as a guard reads them (`guardEnv`).
    - The facts carry no command text. The `gh` shim's gate and the git hooks' judge build theirs here too.
  - `slug.js`: the slug rule `slugFromRemote`.
  - `changed.js`: the files a repo's working tree changed since a moment (`changedSince`), and the capture file's path `CAPTURE_PATH`.
  - `gh.js`: the `gh` calls, `issueView`, `stageList`, and the gh guards' `denyAfter` and `ghSkipped`.
    - It also holds `buildingList`, the `status:building` list no guard reads.
    - That is kept as the twin of `wk_issues_building` in `workflow/lib/hold.sh`, which `test/hooks/twins.test.js` holds to one argv.
  - `proof.js`: the `gh` calls' answers and the `Proof:` pattern.
  - `settings.js`: the settings and the one safe JSON parse (`parseJson`, `isPlain`).
  - `suite.js`: the proved-tree records, the tree hash and the tested package, with `LONG_RUN_MS`, the ceiling of every long program run.
  - `optin.js`: the roster, a folder's origin (`repoSlug`, `originless`) and the folder a gh journal line's call acted on (`placeLine`).
  - `turn.js`: the turn the Stop hooks read (`turnMessages`).
  - `markers.js`: the marker paths, and the folder rule for what the shell spelled.
    - It also holds the gh journal folder and its sized listing, the per-call mark, the journals a call changed and their tail read.
    - Those are `journalDir`, `journalPath`, `journalSizes`, `journalFor`, `journalMarkText`, `journalMarks`, `journalsGrown`, `journalTail`, `journalLines`, `onIssue`.
    - It holds a call's start beside its mark (`callStartPath`, `callStartText`, `callStartOf`) and the triage marker's age limit `TRIAGE_MAX_AGE_S`.
    - It holds the session's PATH with the `git` shim's folder first (`sessionPath`).
- Four hook files are shared homes as well:
  - `test-reminder.js`: the code and test path shapes, `CODE_EXT`, the regex escape `escaped`;
  - `changelog-guard.js`: `isChangelog`, `linterPath`;
  - `change-tracker.js`: `unfiledCount`;
  - `script-write.js`: the five write checks over one file (`writeChecks`, `WRITE_CHECKS`), which the Edit and Write handler runs too, and a path's folder `dirOf`.
- A guard on the chains imports from these and the modules above, never from another chain guard.
- The settings read is `loadSettings(read, { kit, root, user })` in `hooks/mods/settings.js`.
  - It is the one loader for the mods (`io.read`) and the engine's Node scripts (`fs`, through `settingsAt` in `workflow/lib/settings.js`).
  - It merges three layers key by key, the more specific layer winning:
    - the kit's `defaults/settings.json`;
    - then the machine's `~/.workkit/settings.json` (`WORKFLOW_HOME` moves it);
    - then the `.workkit/settings.json` at `root`.
  - A `null`, or a value that is no object over an object (`"manager": "off"`), leaves the lower layer's value.
  - An array replaces. A layer absent or unparsable adds nothing.
  - `enabled` is the repo file's alone, else the default `false`.
  - Missing or unparsable defaults throw an error naming the file.
  - A sync `read` answers the view, an async one a promise of it.
- `settingsFaults(read, { kit, root, user })` sits beside it, from the same walk and with the same call shape.
  - It answers one `{ file, key, line }` for each layer file whose text is neither empty nor a JSON object (`key` null).
  - It answers one for each value set aside over an object (`key` its dotted path).
  - `line` is the sentence naming it.
  - `faultsUnder(faults, prefix)` keeps the faults whose key is `prefix` or under it.
- Three readers act on the faults:
  - `safety:proof-guard` adds the lines to the qa flip's notes: the repo file's faults and those under `proof`, through `rootFaults`.
  - `workflow/identity/token.js` turns one into a `settings` refusal: the machine file adding nothing, or a value under `identity`, through `faultsAt` in `workflow/lib/settings.js`.
  - `workflow/ship/hooks.js` turns one into an error: the repo's own file adding nothing, or a `hooks` value set aside in any layer, through `faultsAt`.
- `rootSettings(root, env, io)` and `settingsOf(cwd, env, io)` bind it to a mod's io, the kit root its `pluginRoot`.
- The shell's twin is `wk_setting <root> <dotted.key>` in `workflow/lib/participation.sh`, the same merge in jq.
- The readers:
  - `findings.file`;
  - `docs.bullets` and `docs.paths` (`docs:board-guard`, through `bulletsOn` and `shapePaths`);
  - `tests.budget` (the commit gate);
  - `tests.check` (`workflow/lib/detach.js`, the minutes between the supervisor's checks of a run, default 5);
  - `commit.attribution` (`safety:commit-attribution`, through `attributionOff`);
  - `public` (`workflow:public-mirror`, `workflow/public/lib.js`);
  - `proof.rootOnly` (`safety:proof-guard`);
  - the `manager` block (`managerConfig` in `hooks/mods/manager.js`);
  - `hooks.<event>` (`workflow/ship/hooks.js`, the ship's `afterRelease`, `afterPublish` and `afterDeploy`).
    - An `afterRelease` hook must be idempotent: [`project-state.md`](project-state.md) § The model.
  - `identity.tokenUrl` (`workflow/identity/token.js`);
  - `site.repo` (`docs:session`, `tower/api/lib/repos.js` and `summaries.js`, `workflow/publish/site-repos.js`, `jobs/morning/brief/cc-news.js`).
    - Each reads it through `homeSlugOf` in `hooks/mods/settings.js`, the scripts by way of `homeSlug` in `workflow/lib/settings.js`.
- No reader parses a settings file itself but one: `hooks.ciSetup`.
  - `.github/scripts/ci-setup.sh` reads it off the repo's own file alone, on a CI runner.
  - The runner has no machine file and runs the repo's Node, perhaps too old to load the ESM loader.
  - Its entries pass the ship hooks' own check (`workflow/ship/entries.js`).
- `docs:change-tracker`, `safety:capture-guard` and `safety:findings-guard` read `findings.file` through `findingsOn` and `findingsRoute`.
  - `findingsOn` is true when the setting reads `true`, the one read all three make.
  - `findingsRoute` is the route sentence the two guards print.
  - The change-tracker's stop instruction words its own: a `status:inbox` issue while on, chat under 🧭 Findings for the owner to answer file or drop while off.

- On Windows the engine's address must be a real symlink.
  - Git Bash answers a plain `ln -s` with a copy unless the MSYS runtime is told otherwise.
  - A copy of the engine at `~/.claude/workkit` hides the kit's folders beside it.
  - The schedule reaches those folders through the address (`~/.claude/workkit/../jobs/morning.sh`).
  - The daily heal sets that flag.
  - When a link still could not be made, it removes the copy and says so, rather than leaving a stale engine at the address.

- The skills carry no platform-bound command at all.
  - The two that record a marker run `workkit review mark` and `workkit triage mark` ([`workflow/review/mark.sh`](../workflow/review/mark.sh) and [`workflow/triage/mark.sh`](../workflow/triage/mark.sh)).
  - Those source `hooks/_lib.sh` and write exactly the path the guard reads.

## The hooks module

- Of the thirty-one hooks, twenty-two run inside Claude Code itself, in one hooks module.
- Nine guards run in the `gh` shim, the `git` shim and git's `pre-commit` and `commit-msg` hooks.
  - The module's one part in them: its `classic.SessionStart` puts the `git` shim's folder first on the session's PATH (§ `safety:tree-guard`).
- `hooks/hooks.json` names the module under `modules` (`./register.js`), and the session loads it once.
  - So dispatching a fire starts no process.
  - A hook runs only the programs it asks for (`git`, `gh`, `node`, an engine entry).
- [`hooks/register.js`](../hooks/register.js) is the one file that touches `$`, the engine's interface.
  - It gathers each hook's facts (a file's text, a `git` or `gh` answer, a stored marker).
  - It gates the hook, logs the fire and answers the event.
- Most hooks gather in their mods file.
  - Every guard gathers through its `<name>Guard` gatherer.
  - The session hooks gather through `<name>Gather` (`standardsGather`, `sessionGather`, `closeGuardGather`, `changeTrackerGather`).
  - `register.js` hands them the engine calls as plain functions (`ioOf`), so no mods file touches `$`.
- Each hook's logic is plain functions over plain data in `hooks/mods/<name>.js`.
  - So the logic suites under `test/hooks/` `require()` them straight.
  - Only the wiring suites need the engine: `test/mods/*.test.ts`, run by `claude plugin test` (`npm test`'s mod half, AGENTS.md § Tests).
- An edit to the module reaches a session only on `/reload-plugins`.
  - That is why `workflow:reload-guard` counts its files among the load-time surfaces.
- The `hooks/` folder carries its own `package.json` (`{ "type": "module" }`).
  - So node reads the module as ESM from the start rather than guessing its type.

| Hook | Event | What it does |
|---|---|---|
| `workflow:standards` | `classic.SessionStart` | The daily heal in a participating repo, `workkit update --auto`, and the setup pester above every gate |
| `docs:state-check` | `classic.SessionStart` | Announces open `status:inbox` issues, a non-empty `.workkit/capture.md`, a repo `CLAUDE.md` to delete, rename or merge, an AGENTS.md over its line or density budget |
| `workflow:reload-guard` | `classic.SessionStart` + `classic.UserPromptSubmit` | Nags once when a surface that loads at session start has changed: the case `/reload-plugins` exists for |
| `manager:resolver` | `agent.spawn` | Supplies each crew spawn's model from `manager/resources/ladder.json` and the session's own model |
| `manager:spawn-guard` | `classic.PreToolUse` (Task/Agent) | Warns (never blocks) on a hand-passed spawn `model`, or a frontier session spawning the advisor |
| `manager:addon` | `classic.SubagentStart` (`^workkit:`) | Stacks a personal add-on (`~/.workkit/agents/<name>.md`) onto a `workkit:<name>` spawn as added context |
| `manager:profile` | `classic.UserPromptSubmit` | Injects the manager standing instruction in frontier/workhorse sessions only |
| `docs:checkpoint` | `classic.UserPromptSubmit` | Fires the `workkit:checkpoint` skill on any line about compacting, clearing or restarting the chat, as a delta after the first run |
| `workflow:feature` | `classic.UserPromptSubmit` | Loads the `workkit:feature` skill on any line about working an issue or the queue, once per session |
| `docs:board-guard` | `classic.PostToolUse` (Edit/Write) | Bounces an `AGENTS.md` write that breaks the 250-line budget or the 400-byte density rule, and, where `docs.bullets` is on, a write to a doc in the `docs.paths` set that adds a paragraph line or a line over 400 bytes |
| `docs:changelog-guard` | `classic.PostToolUse` (Edit/Write) | Bounces an added CHANGELOG entry that is an essay instead of one short linked paragraph |
| `docs:session-guard` | `classic.PostToolUse` (Edit/Write) | Bounces a write that leaves `.workkit/agents/session.md` past either cap: a 350-char bullet or 40 content lines |
| `safety:test-reminder` | `classic.PostToolUse` (Edit/Write) | Asks once per file per session, never bouncing, whether a written code file that no test names needs a test |
| `safety:test-bar` | `classic.PostToolUse` (Edit/Write) | Names each line of a written test file that misses the mechanical half of the test bar, with its rule, never bouncing |
| `docs:session` | `classic.SessionStart` | Injects `.workkit/agents/session.md` (the queue a compacted session reads first) closing with one line for the manager and one for the owner, and leads with a line when the cloud brief has gone stale |
| `manager:close-guard` | `classic.Stop` | Warns (never blocks) when a frontier session did the bulk editing, or when worker output ended the turn with no verifier pass |
| `docs:change-tracker` | `classic.Stop` | Nags once per change, at a park, a block or a close, about uncommitted work, keeping the issue true, promoting findings, and unfiled captures |
| `safety:commit-gate` | git `pre-commit` and `commit-msg` | Blocks a `git commit` the work is not ready for (the proved-tree record, test files, review marker, CHANGELOG entry, the issue it closes and its proof, an issue it names that the owner has not passed, a closing line naming more than one issue) |
| `safety:commit-language` | git `commit-msg` | Bounces kill/destroy/dead wording, and a subject line that is not Conventional Commits or carries a version outside `chore(release)` |
| `safety:commit-attribution` | git `commit-msg` | Bounces a message carrying a Claude co-author line or the Claude Code footer, in a repo whose `commit.attribution` is false |
| `safety:release-taken` | git `commit-msg` | Bounces the release commit whose version npm or the GitHub release tag already has, before the commit and the tag exist |
| `safety:tree-guard` | the `git` shim | Blocks the git commands that DISCARD a shared working tree, with one deliberate escape |
| `safety:script-write` | `classic.PostToolUse` and `classic.PostToolUseFailure` (Bash) | After a Bash call, runs the five write checks an Edit gets on each file the call changed on disk, a failed check a notice, never blocking |
| `safety:issue-guard` | the `gh` shim | Blocks a `gh` call whose outbound text carries a local `.env` value or a token-shaped string |
| `safety:proof-guard` | the `gh` shim | Blocks the flip to `status:complete` and the `gh issue close` of an issue carrying no `Proof:` comment, and the flip to `status:qa` while a package owning a touched test file has no green `npm test` recorded on its own id, the code it can see (§ `safety:proof-guard`, the package id bullet), a package the settings list under `proof.rootOnly` excepted |
| `safety:spec-guard` | the `gh` shim | Blocks the flip to `status:specced` while the issue's `## Spec` is written but carries no `### Contract` |
| `safety:capture-guard` | `tool.call` (Bash, Edit/Write, Read/Grep) | Gates `.workkit/capture.md` in both directions: the owner's surface, whose one sanctioned touch is the triage drain |
| `safety:findings-guard` | the `gh` shim | Blocks the `gh issue create` of a `review notes from` issue while `findings.file` is not on, so findings go to chat under 🧭 Findings |
| `safety:vendor-guard` | `tool.call` (Edit/Write) | Blocks edits to generated, vendored, and gitignored files (`_attic/`, `.workkit/`, `.env*` excepted) |
| `workflow:snapshot` | `classic.PostToolUse` and `classic.PostToolUseFailure` (Bash) | Copies the repo folder when an issue moves to `status:building`: the snapshot `workkit proof red` runs against |
| `workflow:public-mirror` | `classic.PostToolUse` and `classic.PostToolUseFailure` (Bash) | After a `gh issue edit` the gh journal shows adding a `status:` label in a repo paired with a public one, copies that status onto each named issue's public issue, never blocking |

- **`workflow:snapshot`**, the row's detail:
  - The copy includes gitignored files, and leaves out each package's `node_modules` and the kit home's markers and ignored paths.
  - It copies when the gh journal shows an issue moved to `status:building`.
  - It removes the copy at a release (a complete flip, or a close) that leaves none building or at qa.
  - A block or a qa flip keeps it.

- The module registers one handler per event, and each runs its hooks in a fixed order:

| Handler | Its hooks, in order |
|---|---|
| `classic.PostToolUse` (Edit/Write) | `docs:board-guard`, `docs:changelog-guard`, `docs:session-guard`, `safety:test-reminder`, `safety:test-bar`, through `writeChecks` in `hooks/mods/script-write.js`: the first block wins, and the hooks after it do not run |
| `classic.SessionStart` | first the `git` shim's folder put on the session's PATH, on every source (§ `safety:tree-guard`); then `docs:state-check`, `workflow:standards`, `workflow:reload-guard`'s stamp on a `startup` or `resume` source, then `docs:session`: its context last, and one `$.ui.log` line the owner sees when state carried over |
| `classic.UserPromptSubmit` | `manager:profile`, `workflow:reload-guard`, `docs:checkpoint`, `workflow:feature`, their contexts in that order; it also records the turn's start for `docs:change-tracker` (the `turn-journal` key), adding no context |
| `classic.SubagentStart` (`^workkit:`) | `manager:addon` |
| `classic.PreToolUse` (Task/Agent) | `manager:spawn-guard`: its warning as `additionalContext`, and one `$.ui.log` line the owner sees |
| `agent.spawn` | `manager:resolver`: `next({ ...e, model })`, or `{ deny }` in advise mode |
| `classic.Stop` | `manager:close-guard`: its warning as one `$.ui.log` line and nothing else, since a Stop context would continue the turn; then `docs:change-tracker`: its nag as the `block`, which continues the turn on purpose |
| `session.end` | none: it deletes every `$.store` key of the ending session |
| `tool.call` (Bash) | `BASH_GUARDS` in `hooks/mods/guards.js`: `safety:capture-guard` alone |
| `tool.call` (Edit/Write) and (Read/Grep) | `FILE_GUARDS` (`safety:vendor-guard`, then `safety:capture-guard`) and `READ_GUARDS` (`safety:capture-guard`) in `hooks/mods/guards.js` |
| `classic.PostToolUse` and `classic.PostToolUseFailure` (Bash) | `POST_BASH_GUARDS` in `hooks/mods/guards.js`: `workflow:snapshot`, then `workflow:public-mirror`, then `safety:script-write` |

- **`tool.call` (Bash)**, the row's detail:
  - The chain first leaves the call's gh journal mark (`journalMarkPath` in `hooks/mods/markers.js`, keyed by its `tool_use_id`).
    - Per journal, the mark holds a line of its path, then a line of its length in bytes (`journalMarkText`).
    - The length comes from the journal's stat, never a read of it.
  - The journals are every gh journal on the machine: the files of the journal folder (`journalDir`) in name order, each with its length (`journalSizes`).
    - An empty folder is an empty mark.
  - The mark reads no command text and is written before any git call (`markCall` in `hooks/mods/guards.js`).
  - Beside it goes the call's start (`callStartPath`, `callStartText` in `hooks/mods/markers.js`), keyed the same way.
    - It holds the time taken when the call began, before the journals are sized, and the repo root of the call's folder, one `git rev-parse`.
    - It is what `safety:script-write` reads after the call.
  - The guards' facts carry no command text (`bashFacts` in `hooks/mods/facts.js`).
    - They carry the session's folder, `background` (the call's `run_in_background`) and `namesCapture`.
    - `namesCapture` is true when the command contains `.workkit/capture.md`. That one match in `hooks/register.js` is the module's one read of a command's text.
  - The first `{ deny }` refuses the call, and the guards after it do not run.
  - Every notice goes to Claude as one `context` entry on the result, and to the owner as one `$.ui.log` line.
- **`tool.call` (Edit/Write) and (Read/Grep)**, the row's detail:
  - The same runner, event and answers as the Bash chain, logged under `PreToolUse`.
  - The event carries the tool's input flat beside `tool`, `tool_use_id` and `agentId`, and no folder, so the cwd is `$.session.cwd()`.
  - An Edit or Write is gated by the repo holding the file, a Read or Grep by the cwd's (`gateDir`).
  - An empty chain passes the event straight on.
- **`classic.PostToolUse` and `classic.PostToolUseFailure` (Bash)**, the row's detail:
  - The same runner, one chain under two registrations.
  - Their notices go as one `additionalContext` entry and one `$.ui.log` line, never a block.
  - A Bash call that exited non-zero fires only `PostToolUseFailure`.
  - The facts carry `lines`, `since` and `roots`, and no command text (`bashFacts`). The opt-in is § Where every hook stands down's.
  - `callSince` in `hooks/mods/guards.js` reads the mark (`journalMarks`) and the start (`callStartOf`), and removes both. No mark, no lines; no start, no `since` and no roots.
  - `since` is the start's time. `roots` are the root the start recorded and the root of the event's `cwd`, each once (`callRoots`), cut by `runChain` to those that opted in.
  - `grownLines` in `hooks/mods/guards.js` then lists and measures the journal folder again.
    - Each journal longer than its marked length is read past it as a tail (`journalTail`, `journalsGrown` in `hooks/mods/markers.js`).
    - One the mark does not hold, or one shorter than its mark (replaced during the call), is read from its start.
  - The lines are joined and ordered by `ms`, oldest first.
  - Each is kept only when the repo holding its `cwd` opted in (`folderOpted`, each folder asked once per call).
    - A line with no `cwd` is kept.
  - A gh call that failed wrote no line.

- **The answer.**
  - Every handler calls `next(e)`, so the settings hooks beneath still run, and puts its hooks' contexts ahead of theirs.
  - A block joins any block from beneath.
  - A hook adds one `additionalContext` entry or nothing.
  - The three `tool.call` chains answer `{ deny }` without calling `next`, or `next(e)` with its notice put ahead of the result's `context`.
  - There is no `systemMessage` in a module's answer.
    - That is why spawn-guard's warning, docs:session's owner line and close-guard's warning reach the owner through `$.ui.log`, a dim transcript row.
- **The gate.** `folderOpted(io, dir)` in `hooks/mods/guards.js`.
  - The repo root is `git rev-parse --show-toplevel`, run through `$.process.run` from the folder.
    - For a path not made yet, it climbs to the nearest folder that exists (`rootOf` in `hooks/mods/optin.js`).
  - The folder is the event's `cwd`.
    - For an Edit or Write it is the written file's folder, the file read where it really is.
    - So a linked file names its target's repo, and a path not there yet keeps its spelling.
    - For `agent.spawn` and the Agent tool's `classic.PreToolUse` it is the session's folder.
  - It opted in when `<root>/.workkit/settings.json` exists, parses, and its top-level `enabled` is `true` (`settingsOptedIn` in `hooks/mods/gate.js`, the engine's `wk_opted_in`).
    - A nested `enabled` changes nothing.
    - An empty file, a file with no key and text that does not parse are all off.
  - `workflow:standards` and `workflow:reload-guard` are exempt.
  - The guard chains gate once per call through `runChain` in `hooks/mods/guards.js`. No guard is exempt.
    - A Bash chain before the call gates by its real folder, `$.session.cwd()`.
    - A file chain gates by `gateDir`: the repo holding the file for an Edit or Write, and the session folder's for a Read or Grep.
  - The chain after a Bash call, its facts carrying `lines`, gates by its two roots and its journal lines, as § Where every hook stands down states.
  - A hook that stands down says nothing, and still leaves its line in the hooks log.
- **The kill switch.**
  - `HOOK_DISABLE=1` in Claude Code's own environment makes every handler pass its event straight on, with no line in the hooks log.
    - So a session started with it gets no `git` shim on its PATH.
  - The `gh` shim's session gates, the `git` shim and git's hooks read it from the call's own environment (`wk_session_judges`).
    - Whoever runs the command sets it per command.
    - So `HOOK_DISABLE=1 git commit` there is a per-command escape the owner uses, never an agent.
  - The shim's leak scan runs either way.
- **Failure.**
  - Each hook inside a handler fails open on its own: an error goes to the debug log and the hook says nothing.
  - The first exception: a failure of a whole `classic.PostToolUse` (Edit/Write) or `agent.spawn` handler.
    - It refuses (a block, a deny) through its `.catch`, as the mods reference requires of a guard.
  - The second exception: the guard chains.
    - A guard that throws ends its chain, leaves `crashed` in the hooks log and is rethrown.
    - So the three `tool.call` chains' `.catch` (`failClosed`) answers `{ deny }`, ending with the failure's kind (`throw`, `timeout`).
    - So a crash never lets the call through.
  - The `classic.PostToolUse` and `classic.PostToolUseFailure` (Bash) chains never block.
  - Every other handler's `.catch` passes the event on.
- **The parity suite.** Some rules keep a shell home beside the module's, because a script still reads it there.
  - For those, `test/hooks/twins.test.js` runs both on the same inputs and holds them to one answer:
    - the tested package (`hook_test_package_dir`, `testPackageDir` in `hooks/mods/suite.js`);
    - the opt-in read (`wk_opted_in`, `settingsOptedIn` in `hooks/mods/gate.js`);
      - the shell twin reads the top-level key through node, and only `"enabled": true` reads opted in on both;
    - the machine folder (`wk_user_dir`, `userDir` in `hooks/mods/log.js` and `workflow/user-dir.js`);
    - the CHANGELOG path test (`wk_is_changelog`, `isChangelog` in `hooks/mods/changelog-guard.js`);
    - the slug rule (`wk_slug_from_remote`, `slugFromRemote` in `workflow/slug.js` and in `hooks/mods/slug.js`);
    - the `Proof:` pattern (`workflow/ship/items.sh`, `PROOF_RE` in `hooks/mods/proof.js`);
    - the version file test (`hook_is_manifest` in `hooks/lib/tree.sh`, `isManifest` in `hooks/mods/commit-gate/checks.js`);
    - the version-only diff (`hook_version_only_change` in `hooks/lib/tree.sh`, `versionOnly` in `hooks/mods/commit-gate/checks.js`);
    - git's global options that take a value (`VALUE_FLAGS` in `workflow/gitshim/git`, `GIT_VALUE_FLAGS` in `hooks/mods/tree-guard.js`);
    - the two shims' shared shell helpers, `norm_dir`, `real_path` and `in_list`, and their PATH walk to the real tool (`real_git` against `real_gh`), `workflow/gitshim/git` against `workflow/identity/gh`;
    - and the hooks log line (`logLine` in `hooks/mods/log.js`).
  - The prompt shape (`hooks/mods/frame.js`) and the manager config and model tier (`hooks/mods/manager.js`) have no shell side.
- **State.**
  - Per-session state lives in `$.store` under `workkit:<session_id>:` (`test-reminder`, `checkpoint`, `feature`, `reload-guard`, `turn-journal`).
  - `session.end` drops it.
  - The two caches outlive a session and stay files, written with `$.fs`:
    - the inbox count under `~/.claude/logs/state-check` (`STATE_CHECK_CACHE` moves it);
    - the heal's daily marker under `~/.claude/logs/workflow-standards` (`WORKFLOW_STANDARDS_CACHE`).
    - Each is named by the SHA-1 of its folder.
- **The variables it reads**, each through `$.env.get`:
  - `HOOK_DISABLE`, `WORKFLOW_HOME`, `HOME` (`USERPROFILE` where there is none), `TMPDIR` (with `TMP`, `TEMP` and `LOCALAPPDATA`);
  - `WORKFLOW_DIR` (the engine folder, the tests' override), `WORKFLOW_CLAUDE_HOME`, the two cache folders;
  - `RELOAD_GUARD_ROOT` (the folder whose surfaces reload-guard reads, the plugin root by default);
  - `MANAGER_LADDER`, `MANAGER_USER_SETTINGS`, `MANAGER_DEBUG`, `MANAGER_CLOSE_EDITS`;
  - `CLAUDE_CODE_REMOTE` (the cloud session flag the setup pester reads);
  - and `PATH`, which `classic.SessionStart` sets again through `$.env.set` with the `git` shim's folder first.
  - `claude plugin validate .` lists them, with the ten events and every `$` call.
  - Each folder the shell spelled (`TMPDIR`, `/tmp` when unset, `WORKFLOW_HOME` and `HOME`) is read as the folder Git Bash means by it (`shellEnvOf` in `hooks/mods/markers.js`).
    - On Windows `/tmp/<rest>` is the Windows temp folder plus the rest: the first native `TMP` or `TEMP`, else `%LOCALAPPDATA%\Temp`.
    - On Windows `/c/<rest>` is `C:/<rest>`.
    - So the markers a script wrote and the machine folder's other files are where the module looks.

### `workflow:standards`: SessionStart

- Runs the engine's heal in a participating repo, once per repo per day.
  - The call is `bash workflow/standards.sh <root>` under `QUIET=1`, through `$.process.run`.
  - It runs under that call's ten-minute ceiling, past the heal's worst case.
  - What the heal writes: `workflow/README.md`. The standard it heals to: the spec § Enforcement.
- The heal includes the one check that is the hook layer's own (`workflow/standards/hooks.sh`):
  - the hooks module loads in `node`, which pulls in every module under `hooks/mods/`;
  - the shell pieces the scripts source (`hooks/_lib.sh`, `hooks/lib/*.sh`) parse;
  - and the tools both call are present.
- Reports only what it fixed.
  - `QUIET=1` silences the heal's skips at the source.
  - Only the lines opening with the engine's ✓ or ⚠ are kept.
  - Their indent and glyph are stripped before the report goes into the session's context (`engineLines` in `hooks/mods/standards.js`).
  - A heal that exits non-zero is reported as unfinished and retries next session. Only a clean one writes the day's marker.
  - An undecided repo hears one offer and is never written to.
- The same daily run calls `workkit update --auto`, the machine-side upkeep, under the same ceiling.
  - It updates a schedule a human already installed, and installs no schedule fresh.
  - It links the `workkit` command and the `gh` shim into an existing `~/.local/bin`.
  - Off the cloud it warns about a cloud secret that is missing or stale. A cloud session gets one not-applicable line for that step instead.
  - Off the cloud, it says `identity: not signed in` when the machine has no sign-in.
- Above every gate sits the setup pester.
  - A machine with no `~/.local/bin/workkit` is told, every session and in any directory, to run `workkit.sh setup` itself.
  - Where `CLAUDE_CODE_REMOTE` is `true`, the command it names is `workkit.sh setup --cloud`.
  - It is told to hand the user only what setup prints for them. The pester is a prompt, never an install.
  - It stops the moment the link exists, whoever made it.
  - `standards.sh --command-link` makes the command link alone, for a bootstrap that runs no setup at all.
  - A cloud bootstrap that does run setup calls `workkit setup --cloud`, which makes the link itself.
  - Outside a repo the pester is all it says.
- A missing `standards.sh` or unreadable `labels.json` is a broken install, said once, only for a repo whose settings said yes.

### `docs:state-check`: SessionStart

- Announces open `status:inbox` issues, a non-empty `.workkit/capture.md`, a repo `CLAUDE.md`, and an AGENTS.md that breaks its budget.
- A repo `CLAUDE.md` is announced with the one fix its shape calls for (the spec § Repo docs).
  - Pointer only (every non-blank line the bare `@AGENTS.md`) says delete it with `git rm`.
  - Content with no `AGENTS.md` beside it says `git mv CLAUDE.md AGENTS.md`.
  - Content beside an `AGENTS.md` says merge it by hand.
  - The user-level `~/.claude/CLAUDE.md` is never announced.
- Each nudge whose fix is mechanical ends with one instruction, `FIX_NOW` in `hooks/mods/state-check.js`.
  - The mechanical fixes: deleting or renaming a `CLAUDE.md`, and both AGENTS.md budget ones.
  - The instruction: make the fix now, in this session, without asking, and let it ride the session's next commit.
  - The hand merge, a judgment call, carries none.
  - Neither do the inbox and capture nudges, which route through triage.
- The AGENTS.md announcement covers both halves of that budget.
  - A file over 250 lines.
  - A file carrying any line over 400 bytes: the density rule, since a markdown paragraph is one source line.
  - It names the rule and says `docs:board-guard` bounces writes until it fits.
  - The limits and the measurement are the ones board-guard reads: `AGENTS_MAX_LINES`, `AGENTS_MAX_BYTES` and `agentsBudget` in `hooks/mods/board-guard.js`.
  - They count in BYTES, the same unit board-guard uses.
- The inbox count is the one network call.
  - It is `gh issue list` through `$.process.run` with a 5-second limit, inside a git work tree only.
  - A `gh` that is missing, fails or runs out of time is a silent skip.
  - The count is cached about 30 minutes per repo, and only silence is cached.
  - The reason: triage drains `status:inbox` on GitHub and leaves no local trace.
  - So a non-empty count empties the cache file (`$.fs` has no delete) and is asked again every session.
  - And the first session after the drain goes quiet with no help from the skill.
- The logic is `stateCheckContext(facts)` and `inboxCount(stdout)` in `hooks/mods/state-check.js`.
  - The capture count is `unfiledCount` in `hooks/mods/change-tracker.js`, the change tracker's own.

### `workflow:reload-guard`: SessionStart + UserPromptSubmit

- Stamps the load-time surfaces at a `startup` or `resume` session start, into the session's `$.store` record, digested.
  - `hooks/hooks.json` by content.
  - Plus the file list and mtimes of `agents/*.md`, `skills/*/SKILL.md`, `hooks/register.js` and every file under `hooks/mods/` at any depth.
  - Plus `packages/core/test/lib/lexer.js`, the one file a mod loads from outside them.
  - The list is `surfacePaths` in `hooks/mods/reload-guard.js`.
- Injects one line when they change.
  - Skill bodies and engine edits are already live, so only these need `/reload-plugins`.
  - A prompt in a session with no stamp re-stamps silently.
- Each change nags once: the record keeps the fingerprint last told.

### `manager:resolver`: agent.spawn

- Supplies each crew spawn's model from `hooks/manager/resources/ladder.json` and the session's own model, the spawn's `parentModel`.
  - The crew contract: [`agents.md`](agents.md).
- The config is the ladder's `classes` and `ladder` (`MANAGER_LADDER` overrides its path).
  - Then `mode`, `enabled` and `tiers` come from the merged settings' `manager` block (`managerConfig` in `hooks/mods/manager.js`).
  - The first layer is the kit's `defaults/settings.json`: `rewrite`, `true`, and the tiers `fable`, `opus`, `sonnet`.
  - Then `~/.workkit/settings.json`. `WORKFLOW_HOME` moves the folder, and `MANAGER_USER_SETTINGS` names the file.
  - Then the one at the repo's git root (`loadSettings` in `hooks/mods/settings.js`).
  - `classes` and `ladder` stay global.
  - No git root means no repo layer, since a non-repo directory's settings file is the machine's own.
- A merged `manager.enabled: false` turns this hook, `manager:spawn-guard` and `manager:profile` off.
  - A layer that cannot be read adds nothing.
- Per class, either spelling (`worker`, `workkit:worker`), the model is picked (`resolverModel` in `hooks/mods/resolver.js`):
  - the advisor gets the frontier rung, and the scout the fast rung;
  - the worker and verifier get the weaker of the workhorse rung and the session's own, so the crew never outspends the session.
  - Any other agent type, a resumed run and a fork pass through untouched.
- `mode: rewrite` answers `next({ ...e, model })`.
  - A spawn that already carries a model is the manager's deliberate override and passes unchanged.
- `mode: advise` denies a class spawn not already carrying the resolved model, naming the model to re-issue with.
- The Agent tool's model is an alias enum (`sonnet`, `opus`, `haiku`, `fable`), so the ladder's values are aliases.
- `MANAGER_DEBUG=1` logs one decision line per resolved spawn to `${TMPDIR:-/tmp}/claude-manager-resolver.log`.

### `manager:spawn-guard`: PreToolUse (Task/Agent)

- Warns (never blocks, never decides a permission) in two cases:
  - a crew spawn carries a hand-passed `model` param. It is silent in advise mode, which asks for one;
  - or a frontier session, read from `$.session.model()`, spawns the advisor.
- The warning goes to the model as `additionalContext` and to the owner as one `$.ui.log` line.
- The logic is `spawnGuardWarning(config, subagentType, givenModel, parentModel)` in `hooks/mods/spawn-guard.js`.

### `manager:addon`: SubagentStart (`^workkit:`)

- For a spawn whose `agent_type` is `workkit:<name>`, reads `${WORKFLOW_HOME:-~/.workkit}/agents/<name>.md`.
  - It returns its text as `additionalContext`, under a one-line header: `Personal add-on for workkit:<name> (from <path>):`.
  - What an add-on is for and what it cannot change: [`agents.md`](agents.md) § Personal add-ons.
- No file, or a blank one, adds nothing: the normal case.
  - Any other agent type adds nothing the same way, so the matcher is the first filter, not the only one.
- A file that exists but cannot be read: a `manager:addon:` line naming it, through `$.ui.log`, and no context.
  - SubagentStart cannot block a spawn, so the agent runs as shipped.
- The logic is `addonPath(userDir, agentType)` and `addonContext(text, agentType, path)` in `hooks/mods/addon.js`.

### `manager:profile`: UserPromptSubmit

- Injects the manager standing instruction in frontier/workhorse sessions only, the session model read from `$.session.model()`.
  - An unknown model hears it as a frontier session does.
  - `manager.enabled: false` silences it.
- The instruction, in its order:
  - the session is the manager, judgment and dispatch: recon to `workkit:scout`, implementation to `workkit:worker`, blind review to `workkit:verifier`;
  - the advisor line by rung: a workhorse session consults `workkit:advisor` for plans and hard calls, a frontier or unknown one never spawns it;
  - the resolver picks models, so no spawn passes a model;
  - a todo checklist for any multi-step task, kept current;
  - every crew spawn announced in chat as it is made, and what it returned reported;
  - the handoff: a brief file only to dispatch, from a `briefs/` template, naming the framework guide, and the agent's reply is the report;
  - authorized issues built in batches of parallel groups, each a pair and a verifier, with one `workkit:review` full panel per batch ([`agents.md`](agents.md) § Batches);
  - every background test run started supervised and acted on at its end ([`agents.md`](agents.md) § Watching a run);
  - authorized work spawns now, and an owner question rides beside running work;
  - design, contracts and verdicts stay with the manager, and an owner question takes the `workkit:interview` shape;
  - off-issue findings go in chat under 🧭 Findings, and a one-time problem is one report line;
  - an issue line is one bullet for a cold reader (`project-state.md` § Restating an issue).
- It stays under 1800 characters on both rungs, held by `test/hooks/manager-profile.test.js`.
- The logic is `profileContext(config, model)` in `hooks/mods/profile.js`.

### `docs:checkpoint`: UserPromptSubmit

- Matches the compaction phrases on every prompt, line by line and case-insensitively:
  - `compact`, which carries `compaction` and `/compact`;
  - `context` beside `full`, `low`, `running out` or `window` on the same line;
  - and the spoken order, `running out of context`, `out of context`, `low on context`;
  - `clear the chat`, `clear this chat`, `new chat`, `fresh session`, `start over`.
- Silent on a prompt Claude Code delivered itself, whatever words it holds.
  - That is one carrying a frame line, or opening with a tag other than `<pasted_content` (`isSystemPrompt` in `hooks/mods/frame.js`, § Platforms).
  - The check runs before any phrase is matched.
- A match injects one instruction: run the `workkit:checkpoint` skill before anything else in the turn, then answer the line.
  - What the skill does with the chat is its own home, [`skills/checkpoint/SKILL.md`](../skills/checkpoint/SKILL.md).
- The session's `workkit:<session_id>:checkpoint` key holds the time of the last fire.
  - The second fire in a session asks for a DELTA instead, naming the time the instruction was last issued.
  - So the second run files only what has been spoken since.
  - A payload with no session id gets the full line and writes no marker.
- It never blocks a prompt.
- The logic is `checkpointContext(prompt, marker)` in `hooks/mods/checkpoint.js`.

### `workflow:feature`: UserPromptSubmit

- Matches an issue-work line on every prompt, line by line and case-insensitively, with a curly apostrophe read as a straight one.
  - A STRONG match is `#N` or a queue phrase as whole words. A WEAK match is a bare number.
  - The bare number is 2 to 4 digits bounded by non-alphanumerics.
  - Single digits (`1.2.3`) and digits glued to letters (`a1234b`) stay silent. A year, a port, a time or a two-digit version part fires.
  - The phrases: `work on`, `work the`, `do issue`, `the issues`, `next issue`, `what next`, `what's next` and `what's left` (each with or without the apostrophe).
  - Then `continue`, `resume`, `keep going`, `what now`, `next one`, `go now`, `lets do`, `let's do`, `finish up`.
  - Then `task list`, `the queue`, `the batch`, `open items`, `the board`.
  - A phrase inside a longer word is silent: `framework only`, `presume`, `discontinued`.
- Silent on a prompt Claude Code delivered itself (a frame line, or an opening tag other than `<pasted_content`).
  - The test is `isSystemPrompt`, before any match.
  - A task notification saying "work on #12" is not the owner asking.
- A match injects one instruction: load the `workkit:feature` skill before working the issue.
  - The build procedure itself is the skill's own home, [`skills/feature/SKILL.md`](../skills/feature/SKILL.md).
- The session's `workkit:<session_id>:feature` key makes every later fire in the session silent.
  - The skill is already in context, and a compaction summary keeps the skills invoked.
  - Only a STRONG match writes it.
  - A weak match injects the line and leaves no marker. So a false fire (`port 8080`) never spends the session's one load, and a later `work on #374` still fires.
  - A payload with no session id gets the full line every time and writes no marker.
- It never blocks a prompt.
- The logic is `featureMatch(prompt)` and `featureContext(prompt, marker)` in `hooks/mods/feature.js`.

### `docs:board-guard`: PostToolUse (Edit/Write)

- Bounces an `AGENTS.md` write that breaks the spec's budget (§ Repo docs). A `CLAUDE.md` write passes: `docs:state-check` names its fix at session start.
- `AGENTS.md`: the size budget, ≤250 lines, and the DENSITY rule beside it: no line over 400 bytes, since a markdown paragraph is one source line and a file can pass the line count while carrying a book in fourteen of them.
- A density violation lists the first few offenders as `line N (M bytes)` and says to bulletize or move the detail into `docs/<topic>.md`. The bounce names the spec file, the plugin's own `docs/project-state.md`.
- The unit is BYTES, each line's UTF-8 length, so the same file is judged alike on every platform. One rule, one unit, everywhere it is described.
- The markdown shape is its second check. It runs only after the `AGENTS.md` verdict passes, under the same fire.
  - It runs only in a repo whose merged settings set `docs.bullets` to `true`. The kit default is `false`.
  - The setting is read through `bulletsOn` in `hooks/mods/settings.js`, the way `findingsOn` reads `findings.file`.
  - It reads the settings only for a `.md` write not exempt by name or folder, from the repo that holds the file.
- The doc set is the `docs.paths` setting: which markdown the shape check judges. A file outside it passes.
  - It is an array of paths from the repo root, read through `shapePaths` in `hooks/mods/settings.js`.
  - The trailing `/` is what marks a folder: an entry ending in `/` is every `.md` under it at any depth.
  - Any other entry is one file, and must end in `.md`.
  - The entry `./` is the repo root, so every `.md` in the repo.
  - The kit default is `["AGENTS.md", "README.md", "docs/"]`. This repo sets `["./"]`.
  - A repo's file wins over the machine's file, as for `docs.bullets`, and an array replaces the one below it whole.
  - A bad setting bounces every `.md` write not exempt by name or folder while the switch is on.
    - A value that is not an array of strings is a bad setting.
    - So is an entry that can match nothing: one ending in neither `/` nor `.md`, starting with `/`, or holding a backslash.
    - An empty array is valid and judges nothing.
    - The bounce is `board-guard: docs.paths in the settings is not an array of path strings`, and it names the two settings files that can set it.
- The shape is a ratchet: a count that may fall and never rise.
  - The check counts the offending lines in the written file and in its copy in the git index (`git show :<path from the root>`).
    - When that read fails, `git ls-files --stage` says whether the index holds an entry at all.
  - A write bounces when it leaves more paragraph lines than the index copy holds, or more lines over 400 bytes. Each count is held on its own.
  - A file with no index copy is new: its counts start at zero, so it must be clean on every write.
    - An untracked file is new, and so is a git-ignored one.
  - A file in a merge conflict, its index entry holding no stage 0 copy, is not judged until it is staged.
    - The index read rejects, and the fire logs it and passes the write. A failed git call is treated the same way.
  - The measure is the staged copy, not the last commit.
    - A line written and never staged counts against the next write to that file.
    - Staging the file raises the measure to what it holds.
  - A clean doc stays clean, and an old doc can be edited freely while neither count rises.
- The shape has two halves, both judged outside front matter. Front matter opens with `---` on line 1 and ends at the next `---` line.
  - No paragraph line. Every non-blank line opens with a heading, a list marker, a table row, a quote, a tag or a placeholder, or is an import line.
  - The check reads each line after its indent, so a nested bullet passes.
  - A list marker is `- `, `* `, `+ `, or a number, a dot and a space. A tag is `<`, and a placeholder is `{{` or `{%`.
  - An import line is `@` and a path with no space, alone on its line.
  - A `---` rule line passes too. A fenced block, from its fence line to its closing line, is never prose.
    - A fence opens on a run of three or more backticks or tildes.
      - A backtick run with another backtick later on its line opens none: that line is inline code.
    - It closes on a line holding only a run of the same character, at least as long.
  - No line over 400 bytes, the `AGENTS.md` density bar. Fence lines and fenced lines count here.
- Two files are exempt by name (`SHAPE_EXEMPT`): `CHANGELOG.md`, which `docs:changelog-guard` judges, and `LICENSE.md`.
- The issue forms are exempt by folder (`SHAPE_EXEMPT_DIRS`): a file whose folder is named `ISSUE_TEMPLATE` or `issue-forms`.
  - A form is an issue body, and its `## Spec` holds the literal line `safety:spec-guard` reads.
- The bounce opens `board-guard: <file name> breaks the markdown shape`. Only a half whose count rose gets its lines.
  - The half opens with its two counts: `DOC PROSE: 6 paragraph lines, 5 before` or `DOC DENSITY: 3 lines over 400 bytes, 2 before`.
  - It then names up to three offending lines the write added, each `DOC PROSE: line N` or `DOC DENSITY: line N (M bytes)`, and the third adds `and K more` past three added.
    - An added line is one the index copy's offenders of that half do not excuse, matched by text: each old line's text excuses one written line with the same text.
    - A new file has no index copy, so every offending line is added.
- The logic is in `hooks/mods/board-guard.js`.
  - `docShape(text)` finds the offending lines, and `inDocSet(rel, paths)` tests the doc set.
  - `docShapeVerdict(path, text, before, on, spec)` judges the ratchet, `before` the index copy's text or `null` for a new file.
  - `boardGuardGather(path, text, spec, repo)` runs both checks in order. `repo` resolves `{ settings, rel, before }`, built by `boardGuardRepo`.
  - `repo` is asked only for a `.md` write not exempt by name or folder, and `before` only for a file in the doc set while the switch is on.

### `docs:changelog-guard`: PostToolUse (Edit/Write)

- Bounces a CHANGELOG entry that is an essay instead of one short linked paragraph, only entries the write ADDED.
- It runs the linter, `node workflow/changelog/lint.js <file> --added-only`, through `$.process.run`.
  - It stands aside when the linter does not start (no `node`, a run past its timeout).
  - It says so in one `$.ui.log` line: `docs/changelog-guard: the linter did not start (<reason>); the write is not judged`.
- The path is `linterPath` in `hooks/mods/changelog-guard.js`, the one `safety:commit-gate` check 3 runs too.
  - `script-shell.sh` resolves the same file through `workflow/lib/changelog.sh`.
  - `WORKFLOW_DIR` names another engine folder.

### `docs:session-guard`: PostToolUse (Edit/Write)

- Holds `.workkit/agents/session.md` to the shape it exists in: the task queue a compacted or restarted session reads first.
  - Left alone it grows into a journal of what already shipped, whose facts live in the CHANGELOG and the closed issue.
- Bounces a write that leaves it past either cap, both named at once:
  - a bullet (optional indent, then `- ` or `* `) over 350 chars (`MAX_BULLET_CHARS`), named with its length and its first 60 characters;
  - or the file over 40 content lines (`MAX_CONTENT_LINES`).
  - A content line is non-blank, not a heading, not a blockquote, not an HTML comment. So the seeded template counts zero.
- The bounce says to promote anything durable to its issue or the CHANGELOG, delete what has already shipped, and split or trim the oversized bullet.
- It judges the resulting file, which is why it is POST: only the file on disk knows the length an edit leaves behind.
  - A write that shrinks an oversized file but leaves it over still bounces.
- The content-line count and its bar of 40 are also `docs:session`'s, which warns past the same bar at session start.
  - Both read `contentLineCount` and `MAX_CONTENT_LINES` in `hooks/mods/session-guard.js`.
  - The `workkit:ship` prune is what normally keeps the file under.

### `safety:test-reminder`: PostToolUse (Edit/Write)

- Asks at edit time whether a written code file needs a test, with one line in the agent's context.
  - The line: `<path> has no test naming it. Does this change need one? If not, say why in the Proof: line.`
  - The rule it serves is the spec's (§ The proof): whether a change needs a test stays judgment.
  - A "no" is recorded in the `Proof:` line.
- A code file is the one `safety:commit-gate` check 1 asks about.
  - It has a code extension, outside a test folder and a test name.
  - It is never a `*.config.*` file or anything under `_attic/`.
  - `isCodePath` in `hooks/mods/test-reminder.js` is its one home, which check 1 reads too.
- A test NAMES the file in any of three ways:
  - its text carries the basename with its extension as a whole word (`thing.js`, `run.sh`; `index.json` never names `index.js`, nor `webapp.js` `app.js`);
  - or `<parent>/<base>` when more than one repo file shares the basename (a root-level file keeps the basename);
  - or a require or import path ending in the stem (`require('../lib/thing')`).
  - The tests read are the repo's tracked and untracked test-shaped files.
- Once per file per session: the session's `workkit:<session_id>:test-reminder` key lists each file already asked about.
  - A payload with no session id is asked every time, since silence would hide the question.
- Never a bounce: the answer is the agent's.
- Silent for no file path, a file that does not exist, or a directory inside no git repository.
  - Silent too for a file whose repository is not the session directory's (a multi-root session's other repo is left alone).

### `safety:test-bar`: PostToolUse (Edit/Write)

- Reads a written test file for the mechanical half of the test bar (`docs/tests.md` § The bar).
  - It adds one line per finding to the agent's context, in line order: `test-bar: <file>:<line> <rule>`.
  - Never a bounce: the write lands and the agent decides.
- A test file is a test path as `safety:test-reminder` reads one (`isTestPath` in `hooks/mods/test-reminder.js`).
  - That is a test name, or any file under a `test`, `tests` or `__tests__` folder.
- The six rules, read off the text as written, comment lines skipped:
  - `mkTmp`: a `mkdtempSync(` or `tmpdir(` outside the scratch writer (`test/lib/scratch.js` or `tests/lib/scratch.js`, or the kit's `packages/core/test/lib/scratch.js`);
    - one inside a quoted span or a template literal spanning lines is left alone: a fixture's text, never this test's call;
  - `serial`: a literal `/tmp/<name>` path or a literal port (`localhost:<n>`, `port: <n>`, `.listen(<n>`);
  - `worth`: a case whose every assertion is an `existsSync`, a mode or exec-bit check, `assert(true)`, `assert.ok(true)` or `expect(true)`, named at its first;
    - a case is a line opening with `test(` or `it(`, or its `.skip`, `.todo` or `.only` form, `await` before it or not;
    - an assertion is an `assert(`, an `assert.<name>(` or an `expect(` call;
    - a case runs to the next case, a `describe(` (its `.skip`, `.todo` or `.only` form too), or a hook (`before(`, `after(`, `beforeEach(`, `afterEach(`), and a hook's assertions count to no case;
    - a case inside a quoted span or a template literal spanning lines is left alone: a fixture's text, never this suite's case;
  - `source-regex`: a `readFileSync` of a source path (a repo-root anchor or a repo-relative literal, never a path through a `test/` or `tests/` folder) whose text reaches a regex check, `assert.match` or `expect(...).toMatch`, inline or through the name it is held under;
  - `deadline`: a JavaScript wait bound written as a nonzero number literal;
    - the bounds: a `setTimeout` or `setInterval` delay, a `sleep(<n>)` call, a `timeout: <n>` option (a case's own among them), the last argument of `Atomics.wait`;
    - outside the deadline's homes: `test/lib/process.js` or `tests/lib/process.js`, or the kit's `packages/core/test/lib/process.js` and `packages/core/test/lib/spawn.js`;
    - a bound passed to `until` or `elapsedUntil` is left alone;
    - so is any literal inside a quoted span or a template literal spanning lines: a fixture's or a child program's text, never this test's wait;
    - that read is `quoteFree`, through the kit's one line lexer, `lexLine` in `packages/core/test/lib/lexer.js`;
    - it keeps the code of a template's `${...}` expressions for this rule, `mkTmp` and `worth`, so `` `${os.tmpdir()}/x` `` is named;
    - the lexer also drops a regex literal and a `//` or one-line `/* */` comment, so a backtick in any of them opens no template;
  - `helper-test`: a test-named file under a `test/lib/` or `tests/lib/` folder at any depth (the kit's `packages/core/test/lib/` among them), named at line 1.
- It shares test-reminder's repo read (`repoRel` in `hooks/register.js`) and so its silences.
  - The silences: no file path, a file that does not exist, a directory inside no git repository, or a file whose repository is not the session directory's.
- It keeps no per-session memory, so every write of the file is read again.
- The logic is `testBarContext({ root, rel, text })` in `hooks/mods/test-bar.js`, empty for a path that is not a test path or a file with no finding.

### `docs:session`: SessionStart

- Injects a participating repo's `.workkit/agents/session.md` on every source: the task queue a compacted or restarted session reads first.
- Warns when it has grown past the light bar: the `NOTE:` line past 40 content lines.
  - The count is `contentLineCount` and `MAX_CONTENT_LINES` in `hooks/mods/session-guard.js`, the one home `docs:session-guard` reads too.
- Under a `---` rule that keeps them clear of the file's last heading, the injection closes with one line per reader.
- The manager is told to open its first reply in plain words with the state above.
- The owner (who otherwise cannot see that anything survived) hears one `$.ui.log` line, a dim row in the transcript.
  - The line: `workkit: state carried over. Say "continue" to resume the session queue`.
- Silent for a header-only or absent file, closing lines and owner line included.
- Gated by the module's opt-in like the rest.
  - It finds the file from git's toplevel (the module's `git rev-parse --show-toplevel` from the event's `cwd`).
  - So a session opened in a subdirectory still finds it, and a `cwd` git places in no repo says nothing.
  - Every read goes through `$.fs`.
- It also names a cloud brief that stopped arriving (`briefLine` in `hooks/mods/session.js`).
  - The 9am job records the newest published brief's date in `~/.workkit/brief-status.json`.
  - `WORKFLOW_HOME` moves the folder, for this file and the settings file below alike.
  - Past one whole calendar day, the injection LEADS with one line. The day maths is UTC, in JavaScript over `$.clock.now()`.
  - The line holds the date, the gap, `workkit setup --token` as the fix, and `gh run list --repo <home> --workflow brief.yml` as the check.
  - The slug is read from `site.repo` in the machine's merged settings: `rootSettings` with no repo, the kit's default `null` under `~/.workkit/settings.json`.
  - With no slug, the clause is left off rather than guessed.
- The marker's OWN age is part of the answer.
  - Past the same bar, `checkedAt` older than a whole day swaps the diagnosis for `this machine last checked <date>`.
  - A laptop that was off is not a token that expired.
  - The check clause rides either wording.
- That half is a FILE read and nothing else. A session start never waits on the network.
  - A marker that is missing, unreadable, or missing either date says nothing at all.
  - The line rides alone in a repo with no session state, and alone it carries no owner line.
- The one-whole-day bar is `FRESH_DAYS` in `hooks/mods/session.js` and in `tower/api/lib/history.js`.
  - The second asks the same question for the tower's pages. Change both together.
  - What they count diverges on purpose: the tower reads briefs carrying a stats line, the marker counts any `brief: `-titled Discussion.

### `manager:close-guard`: Stop

- Warns (never blocks) when a frontier session did the bulk editing itself, or when worker output ended the turn with no verifier pass.
  - Rule 3: a frontier session making `MANAGER_CLOSE_EDITS` (default 5) edits or more with no worker spawn.
  - Rule 4: a worker spawned with no verifier.
- The warning is one `$.ui.log` line, `manager:close-guard: <warning>.`, seen by the owner alone.
  - The handler returns `next(e)` untouched, never a block or a context, so it never continues the turn.
  - `stop_hook_active` passes straight through: the turn was judged once.
- The turn is every entry of `$.session.messages()` after the last owner prompt.
  - An owner prompt is a user entry with text and no tool results.
  - The slice is `turnMessages` in `hooks/mods/turn.js`, the slice `docs:change-tracker` reads too. The counts are `turnFacts` in `hooks/mods/close-guard.js`.
  - Edits are the Edit and Write tool uses.
  - Spawns are the Task and Agent tool uses, each class read off `subagent_type` with the `workkit:` prefix stripped.
- A prompt Claude Code delivered itself starts no turn, known by shape since the IDE's list keeps growing (`isSystemPrompt` in `hooks/mods/frame.js`).
  - One opening with a tag other than `<pasted_content`. An owner's paste opening with that tag counts as the owner's prompt.
  - Or one holding a frame line anywhere.
  - So a hand-back or a task notification never resets the turn.
  - The limit: the engine's rows carry no `isMeta`. So a meta user row of plain prose (no opening tag) reads as an owner prompt and resets the turn.
  - A tag-opening one is caught by the frame test.
- The model is `$.session.model()`, and its family is `modelTier`.
  - The frontier rung is the effective config's (`managerConfig` in `hooks/mods/manager.js`, the three layers `manager:resolver` reads).
  - `enabled: false` is silence. No owner prompt in view is silence.

### `safety:commit-gate`: git pre-commit and commit-msg

- Blocks `git commit` unless all of these hold:
  - a green root `npm test` recorded the tree it commits;
  - new source files come with test files;
  - code carries a fresh review marker;
  - any added CHANGELOG entry matches the format;
  - a commit closing an issue (`Fixes #N`) stages the entry it closes against;
  - and each closing line names one issue.
- It runs as git's own hooks: `workflow/githooks/pre-commit` (checks 1, 2, 3, 5) and `commit-msg` (checks 8, 4, 6, 7).
  - The heal sets them as the repo's `core.hooksPath` (`ensure_git_hooks`, `workflow/standards/githooks.sh`).
  - The heal names them through the engine link as `~/.claude/workkit/githooks`, so a plugin update leaves the path good.
  - Where the link is missing, the path is the plugin's own `workflow/githooks` folder.
  - npm's `script-shell` wrapper sets the path back right after a repo's `prepare`, `install` or `postinstall` script.
  - The reason: that script may set the path itself (husky's does).
- They judge only where `wk_node` finds a Node 22.12 or newer. With none: one stderr line, and the commit lands unjudged.
  - They judge only where `wk_session_judges` holds for the repo root (`workflow/README.md`, the `lib/participation.sh` row).
  - That is the full-suite hold's and the `gh` shim's gate too, so the owner's terminal is never judged.
- The repo's own hooks run after ours, whatever the session.
  - The folder carries the other fourteen hooks git runs from the hooks folder, as a pass-through to the repo's own.
  - Git runs those on commit, merge, rebase, checkout, rewrite, apply, push, gc, send-email and index write.
  - They are `pre-push`, `post-commit`, `post-checkout`, git-lfs's and the rest (`workflow/README.md`, the `githooks/` row).
- `git lfs install` refuses a hooks folder that already holds hook files.
  - `git lfs update --force` would overwrite the kit's shared folder for every repo.
  - A repo turning lfs on after the heal runs `git lfs update --manual`.
  - That prints the hook lines to put into its own `.git/hooks`, where the chain runs them.
- The hooks read the commit itself, never a command's text.
  - `workflow/githooks/judge.js` builds the facts from the real machine (`workflow/lib/io.js`) in the hook's environment.
  - There git sets `GIT_INDEX_FILE` to the commit's index.
  - So the staged list (`git diff --cached --name-only`) and the tree (`tree-hash.sh -i`, a scratch copy of that index) are what the commit carries.
  - That holds under `-a`, a pathspec, `git -C`, a `cd` or `sh -c` alike.
- `commit-msg` reads the message file git hands it, `-m` and `-F` the same, as their cleanup leaves it.
  - Every line is kept, `#` lines included, so check 7 reads a `#N`-led line.
  - Only everything from the `--verbose` scissors line down, and the blank lines at either end, are dropped.
- `git commit --amend` and a rebase's `reword` run both hooks too, so an amended or reworded message is judged as git will commit it.
- A commit made by a script file (`bash file.sh`, a Makefile, a package script) is judged like any other.
  - Git runs the hooks whoever runs `git commit`.
- `git commit --no-verify` and `-c core.hooksPath=` skip both: the accepted bypass, which no code watches for.
  - The agent instructions forbid both, and the transcript shows the flag.
- Staging and committing in one command is judged like any commit: the hooks run once the `git add` has run, on the index it left.
- A check that stands down says so out loud instead of skipping in silence.
  - The no-origin skip below is the one silent stand-down, by design.
  - Every stand-down of one run arrives in ONE notice, a line each, on the hook's stderr, which the Bash call's output carries.
  - A deny carries none.
- A repo with no commit yet (`headTime` null) commits with no checks.
  - Once the commit has staged files and an origin, the whole gate stands down in one line.
  - The line: `commit-gate: first commit of this repo, no HEAD to judge against; the gate stands down`.
  - None of the eight checks run. Every commit after it is judged as usual.
  - A read the gate needs that git cannot answer is not that.
    - Such reads: HEAD's time while a HEAD ref is there, the staged list, check 1's added and present lists.
    - A run that never started or timed out counts.
    - The commit is held naming the read, as a failed heal arm holds it.
    - It is never stood down as a first commit or an empty one.
- The record is required only for a commit carrying CODE in a repo whose root `package.json` declares a `test` script.
  - These need none and stand check 5 down, each root or nested (`isDocPath`, `isManifest` and `versionOnly` in `checks.js`):
    - a docs-only commit;
    - a version-only bump in any `package.json`. Exact pins equal to its version may move in lockstep with it;
    - one in a `.claude-plugin/plugin.json`;
    - and a `package-lock.json` moving only its version spots: the top level and each local package's entry (the root's, a workspace member's).
    - A dependency's entry moving is code.
- A commit whose files are ALL heal bookkeeping stands checks 1 and 2 down. The record is still required.
  - There are three arms (`hooks/mods/commit-gate/heal.js`), each proving its file is exactly the heal's output.
  - Arm one: the heal's removal of the retired `version` key from `.workkit/settings.json`.
    - Only `version` differs from HEAD, present on one side and absent on the other, and it is never a new file.
  - Arm two: the DELETION of a linter copy once no workflow in the tree the commit produces still runs it.
  - Arm three: a `.github/workflows/checks.yml` whose blob is byte for byte the caller the heal writes (`checksIsJobRewrite`).
    - That holds whatever HEAD held, a first caller included, so HEAD is never read.
  - The copies, the still-runs question and the rewrite are `workflow/changelog/changelog-job.sh`'s, the file the heal runs.
    - The arms reach it as a program through its entry, so the two cannot disagree.
    - `copies` (`wk_linter_copies`).
    - `names <file|-> [copy]` (`wk_names_linter_copy`): a mention outside a comment line.
    - It is asked over the workflows of the tree the commit produces: the index's blobs, the commit's own in the hook.
    - `rewrite [template]` (`wk_checks_heal_rewrite`): the template `wk_checks_template` names by default.
    - The rewrite fills the template with the repo's default branch, `wk_default_branch`'s: GitHub's answer, else `origin/HEAD`'s.
    - With neither it exits 2 naming `git remote set-head origin -a`, which the arm holds on like any failed tool.
  - That caller is all the CI a repo carries.
    - The repo's own `npm test` script is the one test command it runs.
    - A repo that wants a narrower CI run reads `$CI` in that script.
    - No job setting of an older copy is carried.
  - A tool that fails inside an arm is not a no.
    - That is any tool a check runs, `git` exiting past the probe's absent-means-no 1 included.
    - It includes one that did not start, held as `did not start` with its exit code never compared.
    - It includes one that started and ended with no exit code, a child a signal ended, held as `exited null`.
    - The gate blocks naming the arm, the failed command and its stderr.
    - It never gives the review bounce an unknown answer would otherwise read as.
  - The verdict writes no file: the rewritten text is hashed through `git hash-object --path=<file> --stdin` (`hashOf`).
  - The entry runs at the repo root, whose default branch it reads.
  - Each run of an arm, and the tree hash, may take ten minutes (`LONG_RUN_MS` in `hooks/mods/suite.js`; the tree hash is its `treeHash`).
  - `workkit review covers` ignores the same removal.
    - A `.workkit/settings.json` tracked in HEAD may differ in its working copy only in `version`, present or absent, both sides parsing as objects.
    - Such a file never makes the full-panel marker stale. Every other path is judged by its mtime as before.
    - A diff holding nothing but that removal reads `stale: no working diff`, as an empty one does.
    - The rule is `hook_version_only_change` in `hooks/lib/tree.sh`, the shell twin of `versionOnly` in `checks.js` less its lockstep pins.
    - The two change together.
- Check 3 lints the CHANGELOG entries the commit adds with `node workflow/changelog/lint.js <file> --added-only` (`--staged` for the index).
  - It is the linter `wk_changelog_lint` in `workflow/lib/changelog.sh` runs for `script-shell.sh`, with the same message.
  - It lints every `CHANGELOG.md` the commit carries, as its index holds it.
  - `WORKFLOW_DIR` names another engine folder. With no linter there the check has nothing to run.
  - A linter that did not start (no `node` to start, a run past its timeout) stands check 3 down out loud, never a deny.
  - The notice line: `commit-gate: check 3 stood down: the CHANGELOG linter did not start (<reason>)`.
- Check 5 runs no tests; it reads the record.
  - A green `npm test` at the repo root records the id of the working tree it started on, through npm's `script-shell`.
  - A green `workkit prove` records the index's tree.
  - A run with `CI` set (any value but the empty string) records nothing, and the gate never reads `CI`: a tree only such a run proved is refused for a missing record.
  - The record's shape and home, and its two writers: `workflow/README.md`, the `lib/suite.sh`, `script-shell.sh` and `prove.sh` rows.
  - The gate compares it with the tree the commit carries (`treeId`): the commit's index's tree less `.workkit/`.
  - That id comes through `bash workflow/lib/tree-hash.sh <root> -i` (`wk_suite_index_tree`).
  - It hashes a scratch copy of the index, which in the hook is the `-a` or pathspec commit's own. So the real one is never written.
  - So a commit whose content differs from what ran is not proved, and one that differs only under `.workkit/` is.
  - On a match check 5 stands down in one line.
  - The record's first line is the tree id. A second line, `ms=<n>`, is the run's wall time in milliseconds, which older records may lack.
    - The read is `suiteRecordMs` in `hooks/mods/suite.js`. The reads match on the first line alone.
    - On a match that time is held against `tests.budget`, the whole minutes the repo allows its root run.
    - `tests.budget` comes through `loadSettings`: the repo's `.workkit/settings.json` over `~/.workkit/settings.json` over the kit's default, `null`.
    - Past it, one more line sits beside the proved one: `test-budget: the root run took Nm, the budget is Mm`.
    - Minutes are rounded up (`budgetLine` in `hooks/mods/commit-gate/budget.js`), and the commit still passes.
    - No budget, or a record with no `ms=` line, adds nothing.
  - The record may prove the tree on disk (`bash workflow/lib/tree-hash.sh <root>`, `wk_tree_hash`'s one home) while the commit carries another.
    - That is an untracked file or an unstaged edit the commit leaves out.
    - The bounce names that gap and its two fixes: `git add -A`, or `workkit prove`.
    - `workkit prove` runs the suite on a copy of the index and records the staged tree, leaving the folder as it is.
  - Any other case bounces, naming `npm test` at the repo root as the fix and the log that run writes its output to.
    - The log is `.workkit/suite.log` where git ignores it, else the `claude-suite.log` marker path (`wk_suite_log_path`'s rule).
    - npm's `script-shell` is read with `npm config get script-shell`.
    - It is compared by physical path with the `workflow/script-shell.sh` beside the module.
    - When it is not the kit's wrapper, the bounce says so and names `workkit setup` first. With no npm to ask, that clause is left out.
    - On Windows (a plugin root on a drive letter), npm's shell is the built `script-shell.exe` setup builds into `~/.workkit` (`wk_script_shell_exe`).
    - That exe hands the call to the same wrapper under Git Bash.
    - So the comparison there is by physical path with that file (the `scriptShellExe` fact, `<user dir>/script-shell.exe`).
    - A deleted file is not the kit's wrapper either.
    - A nested package's suite is the root `test` script's job, never the gate's (spec § The proof).
- The gate judges the repo the commit lands in, its git toplevel, however the command reached it (a `cd`, `git -C`, `sh -c`).
  - It skips one with no origin (the `originless` fact).
  - A scratch or fixture repo is outside the pipeline, so its commit passes and says nothing.
  - A brand-new local repo gets the gate the moment it has a remote.
- Check 6 is the proof: every issue the message closes must already carry a comment whose line starts `Proof:`.
  - The parse is the same `Fixes/Closes/Resolves #N` one check 4 uses (`closedIssues` in `checks.js`).
  - It names every unproved issue in the bounce.
  - It fails open with one line on the stand-down notice when `gh` cannot answer.
- Check 7 is the stage: every OPEN issue of this repo the message names must be at `status:complete`, the owner's pass.
  - A name is `#N` anywhere in the message: a trailer, `Refs`, the subject.
  - The bounce names each other issue and its stage (`#12 is at status:qa`, or no status label).
  - A closed issue passes, and a message naming no issue passes (a release commit, a small fix found on the way).
  - A pull request passes too, merged or open. `gh` answers a PR number as well, and a `/pull/` url marks it as no work item.
  - A trailer naming a pull request asks no proof either.
  - A `#N` glued to a run that opens with a letter, `_`, `.`, `/`, `-`, `&` or `$` is not read (`namedIssues`). Digits may follow inside the run.
    - `owner/repo2#N` is another repo's, `page#12` a URL fragment, `&#12` an entity, `$#` shell.
    - A run of digits alone opens none, so `#123#456` reads as #123 and #456.
    - One in a code span IS read, since the rule is plain text, not markdown.
  - Checks 6 and 7 share ONE read per named issue.
    - The read is `gh issue view <n> --json state,labels,comments,url` at the repo root (`issueView` in `hooks/mods/gh.js`).
    - Its answers are `viewStage` and `viewHasProof` in `hooks/mods/proof.js`.
    - Checks 6 and 7 run only where a `CHANGELOG.md` marks the repo as in the pipeline.
    - They fail open the same way: one line per issue `gh` could not answer, on the stand-down notice.
- Check 8 is one issue per closing line.
  - A closing keyword (`Fixes`, `Closes`, `Resolves` and their forms) whose `#N` is followed on the same line by another bare `#M` bounces.
  - The two are apart only by spaces, commas or `and`: `Fixes #455 #456`, `Fixes #455, #456`, `Fixes #455 and #456`.
  - The reason: GitHub closes only the first, and the release tools read it the same way.
  - The bounce names each issue the line would leave open.
  - It shows the one-per-line form: `Fixes #455`, then `Fixes #456` on the next line.
  - A number with its own keyword (`Fixes #455, fixes #456`) or after other words (`Fixes #455 after #440 landed`) passes.
  - The parse is `sharedTrailers` in `checks.js`, over the same trailer pattern as `closedIssues`.
  - It runs in every repo the gate judges, a `CHANGELOG.md` or not, since GitHub's close reads the line the same way everywhere.
- The logic is `hooks/mods/commit-gate.js`.
  - `preCommitVerdict(facts)` runs checks 1, 2, 3 and 5 with the stand-downs (no origin, nothing staged, the first commit, the bookkeeping arms).
  - `commitMsgVerdict(facts)` runs checks 8, 4, 6 and 7 over `facts.message`.
    - It is silent where `pre-commit` stood down on no origin or the first commit.
    - It runs on an amend that stages nothing new. Check 4, the one that reads the files, passes with none.
  - `commitFacts(g, root, message)` gathers their facts for the hooks' judge.
  - Each deny opens with `BLOCK_PREFIX`.
  - The facts:
    - `message`, `root` (the git toplevel or null), `originless`;
    - `staged`: the commit's paths, `git diff --cached --name-only`;
    - `headTime`: the last commit's epoch seconds, null before the first commit, or the hold the gate denies on when git cannot read HEAD;
    - `staged` holds the same way on a failed read;
    - `reviewMarker` (`{ mtimeMs }` or null), `suiteRecord` (the record's text or null);
    - `treeId` (the tree the commit carries), `diskTreeId` (the working tree's id), `isWindows`;
    - `scriptShell` (npm's raw value, null with no npm to ask), `kitRoot` (the plugin root), `scriptShellExe` (the Windows wrapper's path);
    - `userSettings`: the machine's `settings.json` path, read for `tests.budget` under the repo's;
    - `home`: the machine folder the marker and record paths sit under;
    - `real(path)`: the physical path, null when missing.
  - The calls:
    - `show(rev, path)`: a `HEAD:` or `:` blob, null when git cannot;
    - `run(argv, init)`;
    - `read(path)`: a file's text, null when missing;
    - `issueView(n)`;
    - `lint(path)`: the linter's run over the commit's index, null with no linter; `{ skipped }` when the linter did not start;
    - `jobRewrite()`: the entry's caller for this repo, run at its root;
    - `hashOf(path, text)`: the blob id.
  - A fact may be a promise, so `commitFacts` reads the costly ones (the tree id, the records, npm) only when a check asks.
  - The marker and record paths are `hooks/mods/markers.js`'s, and the marker's time is `stat`'s from `workflow/lib/io.js`.

### `safety:commit-language`: git commit-msg

- Bounces commit messages using kill/destroy/dead wording, suggesting the neutral terms.
- Bounces a subject line that is not Conventional Commits, or that carries a version number outside `chore(release)`.
- It runs in git's `commit-msg` hook (`workflow/githooks/`, the gate and the chain § `safety:commit-gate` names), after the commit gate's message checks.
  - It reads the real message: the file git hands the hook, so `-m`, `-F`, a heredoc and any quoting read the same.
  - Every line above the scissors line is kept. A `#` line git keeps is judged too.
  - The subject is its first line.
  - Merge, revert, fixup and squash subjects skip the format checks, never the vocabulary.
- It skips a commit in a repo with no origin, the scratch or fixture repo outside the pipeline, printing nothing.
  - A brand-new local repo gets the check the moment it has a remote.
- The logic is `commitLanguageVerdict(message)` in `hooks/mods/commit-language.js`, over the whole message.

### `safety:commit-attribution`: git commit-msg

- Bounces a commit message carrying a Claude attribution line, in a repo that turns attribution off.
  - The setting is `commit.attribution`, merged from the kit default (`true`), the machine file and the repo file as every key is.
  - Attribution is allowed unless a file says `false` (`attributionOff` in `hooks/mods/settings.js`). Without that, the check asks nothing.
- With the setting false, it refuses the first line that is either:
  - a `Co-Authored-By:` line, in any letter case, whose name's first word is Claude or whose address is at `anthropic.com`;
  - or a line holding `Generated with Claude Code`, with or without the link brackets.
- It never refuses a `Claude-Session:` line, a `Co-Authored-By:` line for a person (`Jean-Claude Van` too), or the word Claude in a subject or a body.
- It runs in git's `commit-msg` hook (`workflow/githooks/`, the gate and the chain § `safety:commit-gate` names), after `safety:commit-language`.
  - It reads the real message, as `safety:commit-language` does, in a repo with an origin or without.
- The deny quotes the line and says to remove it and commit again.
- The logic is `commitAttributionVerdict(message)` in `hooks/mods/commit-attribution.js`.

### `safety:release-taken`: git commit-msg

- Bounces a release commit whose version npm or the GitHub release tag ALREADY has, at the one moment the number is still free to change.
  - The release commit: a commit whose real subject is exactly `chore(release): <x.y.z>`.
  - Found afterwards, a taken version costs a second release rather than a different number.
- It is judged in git's `commit-msg` hook (`workflow/githooks/`, the gate and the chain § `safety:commit-gate` names).
  - It runs after the commit gate, `safety:commit-language` and `safety:commit-attribution`, when the real message's subject is exactly `chore(release): <x.y.z>`.
  - `releaseCommitVerdict({ subject, root, facts })` reads the project off disk and runs the two lookups below.
  - The version shape is `VERSION_RE`, the one `safety:commit-language` accepts in a release subject.
- An `npm publish` is not judged here. The ship's publish asks npm itself (`onRegistry` in `workflow/ship/publish.js`) and skips a version already out.
- It asks npm for every package with publish intent, each at its own `package.json` version.
  - It asks for the GitHub release `v<x.y.z>` once.
- The project is the package.json at the git toplevel.
  - Plus every `workspaces` member (the array, or the object's `packages`).
  - A literal directory is read where it stands. `dir/*` is every direct subdirectory of `dir` holding a package.json.
  - Any other glob shape, a pattern that matched nothing and a member with no package.json are each named and skipped.
- Publish intent is the publish plan's rule, and [`workflow/ship/plan.js`](../workflow/ship/plan.js) is its home.
  - npm is asked about exactly the packages the plan would not skip (`"private": false` and a `files` or `publishConfig` key).
  - Plus a workspaces root that carries the intent itself.
- The lookups are two programs run from the project root through the judge's `run` (`workflow/lib/io.js`), concurrently, each with a 15-second `timeoutMs`.
  - `npm view --no-update-notifier --fetch-retries=0 --fetch-timeout=15000 <name>@<version> version`.
    - Taken when the trimmed answer IS the version. An E404 is free.
    - `onRegistry` in `workflow/ship/publish.js` asks the same question.
  - `gh release view v<x.y.z> --json tagName -q .tagName`.
    - Taken when the answer is `v<x.y.z>`. "release not found" is free.
  - The bounce names the repo off the origin (`git remote get-url origin`, read through `slugFromRemote`), left off rather than guessed at when the origin names none.
- Cannot tell is not free, and is never silent.
  - Each of these is one line on the hook's stderr, and the commit goes ahead:
    - a lookup that fails any other way (offline, unauthenticated, the tool missing);
    - and every member left out.
  - A bounce carries those lines first.
  - Then one `release-taken: BLOCKED this release commit: <npm|github-release> already has ...` line per taken pair.
  - Then what to do.
- The escape is `HOOK_DISABLE=1` and nothing narrower: releasing over a taken version is the owner's deliberate call, not a per-command habit.
- The logic is `releaseCommitVerdict({ subject, root, facts })` in `hooks/mods/release-taken.js`, over its judgment `judged`.

### `safety:tree-guard`: the git shim

- Blocks the git commands that DISCARD a working tree, since the tree is shared and no agent can see what else is uncommitted in it.
  - A worker reverting its own files with `git checkout -- <files>` once took another agent's uncommitted work in the same files with it.
  - The alternative it names is the scoped one: revert your own changes by reverse-editing your own hunks.
- It runs in the `git` shim, `workflow/gitshim/git`, on git's real arguments, never a command's text.
  - So `bash -c 'git reset --hard'`, a script file and a command with quotes or a line break in it are judged alike.
- The session puts the shim on its PATH.
  - The hooks module's `classic.SessionStart` puts `workflow/gitshim` first on the session's PATH through `$.env.set`, on every source (startup, resume, compact, clear).
  - The PATH is `sessionPath` in `hooks/mods/markers.js`. One whose first entry is already the folder is left alone.
  - On Windows the folder is in its native form and the separator is `;`.
  - `HOOK_DISABLE=1` sets nothing.
  - A PATH that cannot be set is one `$.ui.log` line: `workkit: the git shim is not on this session's PATH, so safety:tree-guard is off: <why>`.
  - So the session's shells and a subagent's find it first. The shim is never linked into `~/.local/bin`, so a terminal outside a session never meets it.
  - `workkit doctor` checks it: a missing or not executable shim is a warning in a session or out of one; in a session another `git` first on PATH is a warning too, and outside one that PATH line is a skip.
    - Doctor sees only the PATH it inherited: a shell or subagent whose PATH was set apart from the session's is not what it reads.
- What the shim does with a call:
  - It finds the real `git` as the `gh` shim finds the real `gh`: the first one on PATH after its own folder. With none it prints `git: no git on PATH after the workkit shim at <path>` and exits 127.
  - When none of `checkout`, `switch`, `restore`, `stash`, `clean` and `reset` is among the arguments, and the verb is one of git's own on the shim's list (or there is none), it execs the real git at once. No other program starts first.
  - Any other first word is looked up as an alias (`git config --get alias.<word>`). An alias that leads to one of the six is judged as that verb. A `!` alias is not.
  - For one of the six it asks the real git for the repo root, git's own global options kept (`-C`, `-c`, `--git-dir`, `--work-tree`).
  - Outside a repo, or where `wk_session_judges` does not hold for that root, it execs the real git.
  - Where it holds, it runs `node workflow/githooks/judge.js tree-guard -- <argv...>` under `wk_node`.
    - Exit 0 runs git. Any other code is a refusal whose text the judge put on stderr, and git does not run.
    - With no node at the kit's floor it prints `git: the workkit tree-guard did not run (no node <floor> or newer found)` and runs git.
- What it bounces:
  - `git checkout` carrying a pathspec;
  - `git switch` with `--discard-changes` or `-f`/`--force`. A plain switch takes no pathspec and stays legal;
  - `git restore` except `--staged` (`-S`) without `--worktree` (`-W`);
  - every `git stash` but the read-only `list` and `show`;
  - `git clean` forced (`-f`, any cluster carrying `f`, `--force`);
  - `git reset --hard`.
- The checkout line is drawn toward blocking. All of these block:
  - `--` anywhere, `-f`/`--force`, `--pathspec-from-file`;
  - an operand that is `.`, `..`, `./…`, `../…`, absolute, or `~/…`;
  - an operand that carries a glob character;
  - an operand that EXISTS in the folder git acts in: the shim's folder with each `-C` before the verb folded on, in order (`gitFolder` in `workflow/githooks/judge.js`);
  - and more than one operand (`<ref> <path>`).
  - `git checkout main`, `git checkout -`, `git checkout -b new main` stay legal.
  - A branch whose name is also a path in the tree blocks, the case git itself calls ambiguous.
- Where it does not look:
  - a program that starts `git` by a full path, or on Windows through a native process call, never passes the shim;
  - a `git` that git itself starts never passes it either, since git puts its own exec folder first on PATH: an alias's shell, `rebase -x`, `submodule foreach`, `bisect run`, a git hook;
  - a `!` alias passes unjudged;
  - an alias chain is followed up to five hops, the global options leading an alias skipped, and a chain deeper than five hops is refused (exit 1, git not run), never passed unjudged;
  - and every `git` call a session's shell makes pays the shim's few milliseconds, a test suite's included.
- Always on, with one escape, the owner's deliberate discard: `WORKKIT_ALLOW_DISCARD=1` in the shim's real environment (`WORKKIT_ALLOW_DISCARD=1 git reset --hard`).
  - The guard then stands aside out loud, one stderr line (`tree-guard: stood aside for a deliberate discard: ...`), and git runs.
- The logic is `treeGuardVerdict({ argv, exists, allow })` in `hooks/mods/tree-guard.js`.
  - `argv` is git's real argument list as the shim got it, an alias for one of the six spelled as its words.
  - `exists(rel)` answers for the folder git acts in, and `allow` is true when `WORKKIT_ALLOW_DISCARD=1` is set.
  - It answers `{ deny }`, `{ context }` or null.
- `judge.js tree-guard -- <argv...>` exits 0 to run git and 1 with the block text on stderr.
  - A judge that fails before its verdict prints `tree-guard: the workkit judge failed before it could judge this git call, so git did not run: <message>`, exit 1.

### `safety:script-write`: classic.PostToolUse and classic.PostToolUseFailure (Bash)

- The write hooks fire on the Edit and Write tools alone. So after a Bash call this checks, on disk, each file the call changed.
  - A file edit goes through Edit or Write (`agents/worker.md`), and a write hook's bounce is fixed or reported, never worked around.
  - It reads no command text: a `sed -i`, a redirect, `tee`, a script run by name and a kit command are seen alike.
- It runs last in the chain after a Bash call, after `workflow:snapshot` and `workflow:public-mirror`.
  - Its facts are the call's start time (`since`) and the opted-in roots it began and ended in (`roots`, § The hooks module).
  - No start time, or no root, checks nothing.
- The files are `changedSince(io, root, ms)` in `hooks/mods/changed.js`, for each root.
  - It runs `git ls-files -z -m -o --exclude-standard` at the root: the modified and untracked files.
  - It adds `git diff --cached --name-only -z`, so a file staged in the same call is listed too.
  - It adds `.workkit/capture.md` and `.workkit/agents/session.md`, which git ignores.
  - It keeps each one that is there, is not a folder, and was modified at or after `ms`, in path order.
  - So a file git shows modified but last changed before the call began is not listed.
  - The same root and time give the same list every time.
  - A listing git refuses is one line, and that root is not checked: `script-write: the files changed during this Bash call could not be listed (<message>), so none in that repo was checked.`
- Each listed file gets the five write checks an Edit gets, in the same order: `docs:board-guard`, `docs:changelog-guard`, `docs:session-guard`, `safety:test-reminder`, `safety:test-bar`.
  - They are `writeChecks` in `hooks/mods/script-write.js`, the function the Edit and Write handler runs. The first block ends that file's checks.
  - Each finding is one notice line naming the file and the check, then the check's own text.
    - It says the file changed during this Bash call, and asks for a fix with the Edit or Write tool only if the call wrote it.
  - Nothing is refused and nothing is undone.
- A changed `.workkit/capture.md` outside a triage run (no triage marker under 30 minutes, `TRIAGE_MAX_AGE_S`) is a notice that the file is the owner's.
  - So `workkit note` run from a Bash call is reported here.
- At most 50 files are checked per call (`CHECK_LIMIT`).
  - Past that, one line says how many were not: `script-write: <N> files changed during this Bash call; <M> were not checked, past the 50 a call is checked for.`
- `changedSince` is the one export another plugin calls, with its own start time, to run its own write checks on the same files.
  - No list file is shared, since two plugins' after-call handlers run in no fixed order.
- Where it does not look:
  - two repos alone, the one the call began in and the one it ended in: a write in a third repo is not seen;
  - a file git ignores, but the two `.workkit` files above;
  - a file the call wrote and committed in the same call, since git's own hooks judged that commit;
  - and who wrote a file: one another writer changed during the call's window (a parallel agent, the owner) is named too.
- The logic is `scriptWriteGuard(facts)` in `hooks/mods/script-write.js`, a member of `POST_BASH_GUARDS`, answering `{ context }` or null, never `{ deny }`.

### `safety:proof-guard`: the gh shim

- Runs in the `gh` shim, on the call itself (`workflow/identity/gate.js`, `workflow/README.md`), where `wk_session_judges` holds for the cwd's git toplevel.
  - It reads the call's expanded argv, the shim's cwd and the repo the shim resolved (`WORKKIT_GATE_REPO`).
  - So every `--repo` spelling and every directory change are already resolved.
- It judges these calls:
  - `gh issue edit` adding `status:qa` or `status:complete`;
  - `gh issue close`;
  - a `gh api` PATCH, POST or PUT to `repos/<o>/<n>/issues/<N>` or its `labels`, whose `-f`/`-F` fields add those labels (`labels[]=`) or set `state=closed`, on the endpoint's own repo.
  - `state_reason` `not_planned` or `duplicate` is the close that proves nothing.
- A block exits the call 1 before the real `gh` runs, its text on the call's stderr.
- A pass lets the call run and writes the guard's notice, when it has one, on the call's stderr, a line each.
  - This is what `workflow/githooks/judge.js` does for the git hooks.
- Blocks `gh issue edit <N> ... --add-label status:complete` and `gh issue close <N>` when one `gh issue view <N> --json comments` finds no comment whose line starts `Proof:`. The rule is the spec's (§ The proof): a missing proof is a hard gate, not a note at ship time.
- Two closes pass: `--reason "not planned"` (`-r` is the same flag) and `--duplicate-of <M>`. Nothing was built on either, so there is nothing to prove. Every other label flip but the qa one below, and every read, is untouched.
- The issue is read from every positional argument (`classify` in `workflow/identity/gate.js`): a bare number or `#N` wherever it sits among the flags, and an issue URL.
  - A flag takes the next word as its value unless gh gives it none, so `--milestone 12 ... 14` reads only #14.
  - The resolved repo rides the read, so a cross-repo flip is judged against its own issue.
  - The view runs from the shim's cwd with a 600-second `timeoutMs`.
- Fails open, out loud: a view `gh` cannot give (no `gh`, a non-zero exit, an answer that does not parse) lets the call go ahead, its line carried at the head of any block that follows, else on the call's stderr.
- The flip to `status:qa` reads the records of the touched test files, once per call, in the repo the flip names, and runs no test.
  - A flip on the cwd's own repo (the resolved repo is its origin, owner/name, any letter case) is checked in the cwd's repo.
  - One on another repo is checked in that repo's folder on this machine's roster. Its base, touched list and records are all keyed on that folder.
  - The roster read is `rosterPath` in `hooks/mods/optin.js`, the rule of `wk_roster_path` in `workflow/lib/slug.sh`.
    - It takes the enabled entries of `~/.workkit/.repos.json` whose origin is that slug, any letter case.
    - A declined entry never matches.
  - A repo the roster does not hold, or holds as declined, is not a yes. So its flip is not judged, as no hook judges such a repo.
- The touched list is the working diff at the repo root plus the committed leg below, deletions excluded.
  - The working diff is `git diff HEAD --name-only --no-renames -z` and `git ls-files --others --exclude-standard -z`.
  - It is the list `hook_working_paths` in `hooks/lib/tree.sh` prints for `workkit proof red` and `workkit review covers`.
  - In a repo with no commit yet, the staged list, `git ls-files -z`, stands in for the diff against HEAD.
  - A failed `git diff HEAD` or `git ls-files` read, or one that did not start, denies the flip naming the read.
- Every test-shaped path (`*.test.*`, `*.spec.*`, `*_test.*`: `isTestName` in `hooks/mods/test-reminder.js`) counts, whatever its extension.
- A file's package is the nearest folder at or above it, short of the root, whose `package.json` declares a test script.
  - It is found by `testPackageDir` in `hooks/mods/suite.js`, the rule of `hook_test_package_dir`.
  - A file in no such folder is the root's, `.`.
- The flip passes when either of these holds:
  - the suite record holds this tree, since a green whole root run covers every package (`suiteProved`);
  - the package record holds a line `<id> <pkg>` for every package that owns a touched test file, each on that package's own id (`pkgProved`, `wk_pkg_proved`'s read).
- Each package must hold its own line: the root's `.` never covers a nested package's file, nor a nested package's line the root's.
- A package with no line blocks the flip, listing each such package with its touched files as a hint, never a ready command.
  - The block asks for that package's own tests: `npm test -- <files>` run from its folder, with the paths in the form its runner takes.
- A repo can declare the packages whose proof is the root run alone: `.workkit/settings.json` takes `"proof": { "rootOnly": ["packages/backend"] }`.
  - The values are folders relative to the repo root, `.` for the root.
  - They are read from the merged settings once per check (`loadSettings`, the kit's default `null` declaring nothing).
  - At the qa flip a declared package needs no package record: it is skipped, while every other package keeps its line.
  - A value that is not an array of strings is named under a block, and the check runs as if nothing were declared.
  - A repo settings file that adds nothing, or a value of its own or under `proof` that the merge set aside, is named the same way (`settingsFaults`).
  - The declared package's proof is still the root `npm test` before the commit.
  - The full-suite hold on that run (`wk_suite_hold` in `workflow/lib/hold.sh`) is unchanged.
- The guard writes no record.
  - npm's script shell (`workflow/script-shell.sh`) is the one writer of the package record.
  - The suite record keeps its two writers, the script shell and `workkit prove`.
  - A green bare root `npm test` writes the suite record (`workflow/README.md`, `script-shell.sh`).
- Every other green `test` event, a narrowed run anywhere or a nested package's bare run, writes the package record.
  - The writer is `wk_pkg_marker_write`. The file is `~/.workkit/markers/claude-package-marker/<sha1 of the repo root>`, named here by `pkgMarkerPath` in `hooks/mods/markers.js`.
  - It holds one line per package, `<id> <pkg>`.
  - `<id>` is the package's own tree id, hashed before the run. `<pkg>` after it is the package folder relative to the root (`.` for the root).
  - The hash is `wk_tree_hash <root> <pkg>`: untracked files in, ignored ones and `.workkit/` out.
    - So a write there (the suite log, a marker, `settings.json`) never voids a record.
- A package's id is the working tree less the workspace members it neither is, holds, sits in, nor depends on, directly or through other members.
  - A member whose folder holds a kept member's folder is kept too.
  - The read is `workflow/lib/workspaces.js`. It reads the root `package.json` `workspaces` and each member's dependency fields, as the publish plan does.
  - The dependency fields are `dependencies`, `devDependencies`, `peerDependencies` and `optionalDependencies`.
  - Each of these keys the package to the whole tree:
    - `.`;
    - a repo with no `workspaces` field;
    - anything the publish plan refuses (a pattern it does not expand, a `package.json` that does not parse), with one stderr line in the plan's own words;
    - a machine with no node, with one stderr line that says so.
  - So a package's record dies when its own files, a member it depends on, or a file outside every member changes.
  - A repo with no workspaces keys every package to the whole tree.
- A package's run rewrites the record under its lock, every other package's line copied and its own appended.
  - So overlapping runs each keep their line.
  - A red run, a run that changed its id, or a run with `CI` set (any value but the empty string), writes nothing.
- The guard hashes each package the same way before it reads, through `bash workflow/lib/tree-hash.sh <root> [<pkg>]` with a 600-second `timeoutMs`.
  - The root's `.` is hashed on the whole tree.
  - It runs with the variables the gate read (HOME, PATH, TMPDIR and WORKKIT_NODE among them). So its `wk_node` finds node the way the record's writer did.
  - An edit voids only the records of the packages that can see it. An edit undone byte for byte is the recorded id again.
  - A tree that cannot be hashed blocks the flip, naming the cause.
- A package with no line whose own id the child still keyed to the whole tree gets one sentence after the block's head.
  - That sentence is its `tree-hash:` and `workspaces:` stderr lines, in order (`note` of `treeHash` in `hooks/mods/suite.js`).
  - A `tree-hash:` line naming node is followed by the fix: `<line>; put the node it names on the gate's PATH, or set WORKKIT_NODE.`
  - A `workspaces:` line prints as it is.
- A file under a `test`, `tests` or `__tests__` folder that is not test-shaped (a helper such as `test/lib/harness.js`, a data file) is never required.
- Nor is a test file the root owns while the root has no test script, since no `npm test` there can record a run.
- The committed leg reads the commits since `origin`'s default branch, else since this branch's upstream.
  - With neither, or when HEAD shares no merge base with it, that leg reads nothing.
- The check's one skip is the committed `proof.rootOnly` declaration above, which names a package rather than skipping the check; no env var turns it off. What a package's `npm test` proves is that package's runner's to define; a layer skipped on purpose is recorded in the `Proof:` line for the reader, naming the layer and the reason, and is never handed to the guard.
- The third stage of the same gate is `safety:commit-gate` check 6, the `Fixes #N` trailer, which reads the same pattern. The pattern's homes change together: `PROOF_RE` in `hooks/mods/proof.js` (this guard's `viewHasProof`), `workflow/ship/items.sh` (the ship's read), and `PROOF_LINE` in `tower/api/server/validate.js` and the dashboard's `libs/tower/github/writes.js`.
- The tower Board's own move of a card to Complete applies the same gate off the same read, on both of its write paths; the one difference is that a read the board cannot make refuses the move, where this guard lets the call go ahead. Detail: `tower/README.md`.
- The logic is `proofVerdict({ steps, cwd, repo, facts })` in `hooks/mods/proof-guard.js`.
  - It takes one step `{ sub, number, add, remove }` per issue, and `repo` '' for the cwd's.
  - `facts` is `{ root, issueView, touched, packages, suiteRecord, packageRecord, treeId, pkgTree, roster, rootOnly, settingsFaults, slugOf, toplevel, baseless }`.
  - The qa facts may be async functions of the repo root.
  - `proofFacts` builds them from the gate's reads (`workflow/lib/io.js`), each gathered only when the qa check asks, once per root.

### `safety:spec-guard`: the gh shim

- Runs in the `gh` shim, on the call itself (`workflow/identity/gate.js`), where `wk_session_judges` holds for the cwd's git toplevel.
  - It judges a `gh issue edit` whose `--add-label` values add `status:specced`, read off its expanded argv.
  - Its issue is read from the shim's cwd on the repo the shim resolved.
  - A `--body`/`--body-file` on the same call blocks as below.
- A block exits the call 1 before the real `gh` runs.
- A pass that failed open says so on the call's stderr, a line each.
- Matches `gh issue edit <N> ... --add-label status:specced`, the label read whole from each comma list (`--add-label=status:specced`, `priority:high,status:specced`).
  - A `--remove-label status:specced`, a body that names the label, and every other call pass untouched and read nothing.
  - The issue numbers and the repo are the gate's `classify` reads, the ones `safety:proof-guard` judges by. So a cross-repo flip is judged against its own issue.
- Reads the issue once, `gh issue view <N> --json body`, from the shim's cwd, and takes the `## Spec` section: the text from that heading to the next `## ` heading outside a code fence, or the end, CRLF read as LF.
- Passes when the section's non-blank text is exactly `None needed: small item.`, or when it holds a `### Contract` heading (`specOk` in `hooks/mods/spec-guard.js`). The Contract's shape (Files, Names, Cases) is the spec's: `docs/project-state.md` § Specs. A `### Contract` outside the Spec section does not count.
- Anything else blocks, a body with no `## Spec` section included, with one line that leads with `BLOCKED this flip`, names the issue, and asks for the Contract's three parts or the small-item line before the flip.
- A flip whose call also edits the body (`--body`, `-b`, `--body-file`, `-F`) blocks before any read, with one line that leads with `BLOCKED this flip` and says to edit the body in its own command first, since the read would judge the old body.
- Fails open, out loud: a view `gh` cannot give (no `gh`, a non-zero exit) or a body that does not parse lets the call go ahead, one line on its stderr naming the issue and why.
- The tower Board holds the same rule on its drag to Specced, in both move twins.
  - The twins are `specOk` in `tower/api/server/validate.js`, restated in the dashboard's `libs/tower/github/writes.js`.
  - One difference: a body the board cannot read refuses the move, where this guard lets the call go ahead.
  - The rule's three homes (`specOk` in `hooks/mods/spec-guard.js` and the two `specOk` copies) change together, the two headings and the small-item line alike.
  - The bodies in `test/tower/spec-bodies.js` hold the two `specOk` copies to one answer.
  - Detail: `tower/README.md`.
- The logic is `specVerdict({ steps, cwd, repo, facts })` in `hooks/mods/spec-guard.js`, one step `{ sub, number, add, remove, body }` per issue (`body` when the call also edits the body), `facts` `{ issueView }` (`specFacts` builds it), `issueView(n, repo)` gh's view or null.

### `safety:findings-guard`: the gh shim

- Runs in the `gh` shim, on the call itself (`workflow/identity/gate.js`), where `wk_session_judges` holds for the cwd's git toplevel: a `gh issue create`'s `--title`/`-t` value as gh receives it, the settings read from the shim's cwd. A block exits the call 1 before the real `gh` runs.
- Makes the off default of `findings.file` hold on the ship path.
  - A `gh issue create` whose title starts `review notes from` (the ship's review-notes issue, `skills/ship/SKILL.md` step 3.2b), letter case ignored, bounces while the setting reads anything but `true`.
  - The setting is `findingsOn` in `hooks/mods/settings.js`: the repo's `.workkit/settings.json` at the shim's cwd's root over `~/.workkit/settings.json`.
- The bounce names the route (`findingsRoute`), the findings said in chat under 🧭 Findings for the owner to answer file or drop, and the toggle: `findings.file: true` in the repo's `.workkit/settings.json` or `~/.workkit/settings.json` turns filing on (`docs/project-state.md` § How big is one issue).
- The title is the `--title`, `--title=` or `-t` value in the call's argv, as gh receives it, so its quoting, escapes and substitutions are already resolved and a body naming the phrase is data.
- Everything else passes silently: another title, a title where the phrase is not at the start, a `gh issue comment` or `edit` carrying it, and any create while the setting reads `true`.
- The logic is `findingsVerdict({ steps, cwd, repo, facts })` in `hooks/mods/findings-guard.js`, one step per issue, a create's `{ sub: 'create', number: null, add, remove, title }` carrying its title, and `facts` `{ route }`, the `findingsRoute` answer (`findingsRouteOf` reads it for a folder); the filing route is the on answer.

### `workflow:snapshot`: classic.PostToolUse and classic.PostToolUseFailure (Bash)

- Takes the snapshot `workkit proof red` runs against.
  - After a Bash call whose `gh` write moved an issue to `status:building` (the claim in `skills/feature/SKILL.md`), it copies the whole repo folder.
  - The copy goes to `tree/` in the repo's snapshot folder, `~/.cache/workkit/snapshot/<sha1 of the repo root>` (`hook_snapshot_dir`), outside every repo even when `~/.workkit` is a link into one.
    - Its base is the kit's cache folder (`wk_cache_dir`), beside the proof copies (`~/.cache/workkit/proof`). `HOME` moves it; `WORKFLOW_HOME` does not.
    - The keyed name comes from `wk_keyed_path <folder> <anchor>`, the step `wk_marker_path` shares.
  - Gitignored files are included.
  - Left out: `.git`, each package's `node_modules`, the snapshot home when the repo holds it (a repo at `$HOME`), and the kit home's markers folder and git-ignored paths (when the repo holds the kit home).
- It reads the gh journal lines the call left, each `{ ms, verb, sub, repo, numbers, add, remove, cwd }`, never the command text. The post-call row states the read. On the opt-in, it follows § Where every hook stands down, the Bash call that already ran. So a claim in another opted-in repo is read, whatever `cd`, subshell or script led there.
- The read crosses sessions: a line another session's `gh` write left during the call is read too.
  - Two sessions in one repo already read each other's lines this way.
  - A repeat mirror sets the same label.
  - A repeat claim after the first take finished keeps the snapshot (the re-claim rule below).
  - One that lands while the first take still copies starts a second take.
  - The take's race rule decides which copy stays: the second to move in records its numbers on the winner (`hook_snapshot_take`).
- Beside the copy it records `head` (the HEAD it was taken at, one sha line), `paths` (the working-change list at that moment, NUL-separated, as `hook_working_paths` prints it) and `issues` (the claimed issue numbers, one a line).
- One snapshot per repo. A claim while it is live adds its issue numbers and leaves the copy alone. A snapshot whose recorded issues have all left `status:building` is stale, and a claim of a number it does not record replaces it; a claim of a number it already records keeps it, stale or not, so a re-claim after a block never swaps in a tree that already carries the edits.
- A release is the flip that ends the work: an add of `status:complete`, or a `gh issue close`.
  - On one, while a snapshot is there, it asks GitHub which issues in that repo are still at `status:building` or `status:qa`.
  - The read is `stageList` in `hooks/mods/gh.js`, one list per label, the qa list read only when none is building.
  - None left removes the snapshot.
  - A failed GitHub read leaves it, and the stale check catches it at the next claim.
- An add of `status:qa` is not a release.
  - A failed check sends the work back while the label stays at `status:qa`.
  - The fix round's verifier proves red against the same snapshot.
- Nor is a `--remove-label status:building` that adds neither (a block, a re-spec).
- Each leaves the snapshot alone and calls no `gh`, as does every call that is neither a claim nor a release.
- A snapshot stays while any issue in the repo sits at `status:qa`.
  - One whose work left qa with no journaled complete flip or close (a flip back to `status:blocked`, a close on the web, a close by a commit's trailer) stays until the next claim's stale check replaces it.
- The stale check reads `status:building` alone. So a claim made while the work waits at qa replaces the snapshot.
  - A later fix round at qa proves red against that newer one, which holds the first round's edits and not the fix.
- Only a claim of a new number replaces a stale snapshot; a re-claim of a recorded number keeps it.
- The repo is the one the journal line names:
  - the cwd's repo when the line's repo is its origin;
  - otherwise another repo's folder on this machine's roster (`rosterPath` in `hooks/mods/optin.js`), as `safety:proof-guard` finds it.
  - A repo off the roster gets one notice and no snapshot.
- Every line that claims or releases is one step, run in order.
  - So two `gh issue edit` calls in one Bash call record both numbers, and a claim in each of two repos snapshots both.
  - The notices of one call are joined into one.
- The module plans and `hooks/lib/snapshot.sh` acts.
  - `snapshotPlan` reads the journal lines.
  - For the copy, `snapshotGuard` runs the file's entry from the repo root with a 600-second `timeoutMs`: `bash hooks/lib/snapshot.sh take|add|stale|drop <root> [args]`.
  - The entry runs `hook_snapshot_take`, `hook_snapshot_add`, `hook_snapshot_stale` or `hook_snapshot_drop`, their exit status passed through.
  - The module writes no snapshot file of its own. The `issues` list is appended by the entry, and read whole by the module for the re-claim test.
  - Sourced, the file defines its functions and runs nothing, as `workflow/proof/red.sh` and `workflow/prove.sh` source it.
- The copy per platform:
  - macOS clones (`cp -c`), which costs almost nothing;
  - Linux copies with `--reflink=auto`;
  - Windows (Git Bash) streams through `tar`.
- No platform copies a package's `node_modules` folder.
  - That is one beside a `package.json` git lists, tracked or untracked and not ignored, never one under another `node_modules`.
  - Red-proof's copy makes each one a real folder with its entries linked from the live repo.
  - A workspace link points at the same path inside the copy.
  - So a partial copy of a dependency tree cannot happen.
- Every other `node_modules` is data inside an ignored folder and is copied as it is, bytes and links alike.
  - So a code-signed app bundle in a download cache stays sealed.
- The take builds the whole snapshot (`head`, `paths`, `issues`, then `tree/`) in a sibling folder `<dir>.XXXXXX` and moves it into place last.
  - So two claims racing on one repo never leave a half tree under the final name.
  - A failed take removes the sibling, keeps any snapshot already there, and is a notice naming the error.
  - An old snapshot the take cannot remove is moved aside to a `<dir>.XXXXXX` sibling, named in a notice, and the new one takes its place.
  - A take ended by `TERM`, `INT` or `HUP` removes its sibling at once and exits non-zero (143, 130 or 129).
  - Siblings older than 10 minutes, left by a take ended without a signal it can catch (a `SIGKILL`), are swept at the next take.
- The fill that turns a folder into a runnable copy is `hook_snapshot_fill <tree> <root> <dest> [rel]...` in `hooks/lib/snapshot.sh`.
  - `<dest>` is filled from the folder `<tree>`, only the named paths when any are given.
  - Each package's `node_modules` the live repo `<root>` holds is rebuilt as above, on every platform.
- Red-proof fills from the snapshot's `tree/`.
- `workkit prove` fills from the live folder, naming only its gitignored paths, with its root spelled through `hook_snapshot_root`.
  - It does so since the fill compares link targets spelled by `pwd -P`.
- The copy's worktree is the shared pair both use:
  - `hook_snapshot_worktree_add <root> <copy>` adds a detached worktree of HEAD with nothing checked out, tried three times against a racing add or prune;
  - `hook_snapshot_worktree_remove <root> <copy>` removes it, deleting the folder and pruning the list when git cannot.
- The other notice with no snapshot taken or dropped: a claim whose roster folder is outside any git repository. A claim made from a folder in no repository is dropped unread, so it draws no notice. A live snapshot that cannot take a later claim's numbers is a notice too. Every notice reaches Claude as context and the owner as one `$.ui.log` line.
- A failed Bash call (exit non-zero) fires `classic.PostToolUseFailure` and no `classic.PostToolUse`, so the hook runs on both, reading the journal alike: a `gh` write that landed has its line whatever the call's exit, and one that failed has none.
- Never blocks: neither Bash chain refuses, a failed copy or GitHub read included.
- The logic is `snapshotPlan({ lines, cwd, roster, slugOf, building })` in `hooks/mods/snapshot.js`.
  - `lines` is the journal lines past the mark.
  - `building(dir, repo)` is GitHub's `status:building` list, its `status:qa` list when none is building.
  - It answers a list of steps, one per line that claims or releases: `{ take, issues, repo }`, `{ drop, repo }` or `{ note }`.
  - The list is empty for a call that does neither.
  - `snapshotGuard` runs them in order.
- How red-proof builds its copy from the snapshot (HEAD checked out as its floor), its `--live` mode that swaps the snapshot's versions into the live tree instead, and the limits each accepts: [`agents.md`](agents.md) § Crew sizing.

### `workflow:public-mirror`: classic.PostToolUse and classic.PostToolUseFailure (Bash)

- Keeps a paired public issue's label in step with its private issue (`docs/project-state.md` § Capture).
  - It acts after a Bash call whose gh journal lines (read as `workflow:snapshot` reads them) record an issue `edit` adding any `status:` label.
  - It runs the engine's `public/mirror.js` with the issues that line named, from the root of the repo the line acts on.
  - The script reads each private issue's `Public:` line and makes the public issue's `status:` label the private one's, posting nothing.
- The repo is the one the line names, as `workflow:snapshot` finds it: the cwd's when the line's repo is its origin, another repo's folder on this machine's roster (`rosterPath` in `hooks/mods/optin.js`) otherwise. A repo off the roster (the public repo itself among them) is no mirror.
- It acts only in a paired repo: one whose merged settings hold a `public` string (`rootSettings` in `hooks/mods/settings.js`, the repo's `.workkit/settings.json` over the machine's, the kit's default `null`). Everywhere else it calls nothing, and for a line adding no `status:` label it reads nothing either, returning before the roster.
- A `gh` edit that failed leaves no journal line, so it mirrors nothing; the daily heal's `mirror.js --all` sweep catches a miss.
- A mirror that fails, or a `public` key that is no slug, is one notice carrying the script's stderr, to Claude as context and to the owner as one `$.ui.log` line; never a block. A mirror that worked says nothing.
- The logic is `publicMirrorPlan({ lines, cwd })` in `hooks/mods/public-mirror.js`.
  - `lines` is the journal lines past the mark, read as `workflow:snapshot` reads them.
  - It answers `[{ dir, repo, issues }]`, one per line that mirrors, `dir` the line's cwd (the session's when the line has none).
  - `publicMirrorGuard` places each step's repo (`placeLine` in `hooks/mods/optin.js`) and reads its `public` key.
  - It then runs `node <engine>/public/mirror.js <N>...` for each, with a 600-second `timeoutMs`. The engine is `WORKFLOW_DIR` or the plugin's own `workflow/`.

### `safety:vendor-guard`: tool.call (Edit/Write)

- Blocks edits to generated, vendored, and gitignored files, the mechanical half of "edit the SOURCE, not the output":
  - a `node_modules/`, `vendor/` or `.bundle/` segment;
  - a `dist/` or `build/` directly under a package root;
    - A package root is the repo root or a folder holding a `package.json`.
    - A folder that is not there cannot be disproved and counts as one.
    - The folders are asked from the path's root: `/`, or a drive (`D:/`) for a Windows path.
    - Deeper in a source tree the folder is source.
  - a lockfile;
  - and a file `git check-ignore` matches in the repo holding its folder.
- `_attic/` is excepted first, so an attic may hold a parked `dist/`; `.env*` and `.workkit/` after the vendor checks, so a `.workkit/` nested in installed output stays blocked.
- It judges the path as the input typed it (a relative one is the session folder's, a backslash read as a slash), never where a link leads: a workspace link `node_modules/p` into `packages/p` is still installed output, and the block names the typed path. The repo for the gitignore check is asked from that path's folder.
- It runs first in the Edit/Write chain, so its deny ends the chain before `safety:capture-guard`.
- The logic is `vendorGuardVerdict({ file, root, ignored, kindOf })` in `hooks/mods/vendor-guard.js`: `root` the repo root or null, `ignored(path)` the `git check-ignore -q` answer, `kindOf(path)` `'file'`, `'dir'` or null off `$.fs.stat`.

### `safety:issue-guard`: the gh shim

- Runs in the `gh` shim on every `gh` call it sees but `gh auth` (`workflow/identity/gate.js`), in a Claude session or not, the owner's own terminal calls included.
  - The outbound text is the call's expanded argv joined by newlines, plus the text of every body file it sends, read from the shim's cwd.
  - The body files are `--body-file`/`-F` for an issue or PR, and `--input` and a `-F` field's `@<path>` for `gh api`.
  - A body on stdin is included, since the shim hands the gate stdin as a file.
- A block exits the call 1 before the real `gh` runs, in the cloud before `rest.js`.
- Blocks a `gh` call whose outbound text carries a local `.env` value or a token-shaped string, whatever its verb: an issue or pull request write, a `gh api` call, a read alike.
- Every repo is assumed public (the spec § Issue anatomy), so it runs in every repo and outside any.
- It skips the calls whose whole job is sending a value to GitHub's encrypted store: the `secret` and `variable` verbs, and an `api` write whose endpoint is an Actions secret or variable (`/actions/secrets`, `/actions/variables`; a secret is PUT, a variable POSTed then PATCHed) (`sendsToStore` in `workflow/identity/gate.js`). Every other call is scanned.
- It names the key or the kind, never the match.
- A relative body file is read against the shim's cwd. Each pattern is tried line by line, as grep read it.
- Local `.env` values come from the shim's cwd and the repo root above it, the committed example and template variants skipped.
  - Each value is read two ways. Node's own `.env` reader (`util.parseEnv`, handed in by the gate) drops a trailing comment and reads all three quote kinds, a `\n` escape in double quotes and a quoted value over several lines.
  - Each line is read too: the whole text after `=` (trimmed, one outer quote pair stripped), and that value with its trailing comment cut (a quoted value ends at its closing quote when only whitespace or a comment follows, a bare one before the first `#` after whitespace).
  - The line reading keeps what Node's reader drops: an earlier line of a repeated key, a bare value holding `#`, a line under an unclosed quote.
- An obviously plain value never matches: under 8 characters (every boolean is), one lowercase word, a bare number or version, a local URL with no credentials.
  - Under a key naming a secret (holding `PASS`, `PWD`, `SECRET`, `TOKEN`, `KEY` or `CREDENTIAL`, in any case and anywhere in the key, so `KEYBOARD_LAYOUT` names a secret too) only the under-8 rule holds.
  - So a common word of 8 or more characters there (`API_KEY="development"`) blocks a call whose text holds it, the block naming the key.
- Nor does a value that is, ignoring case, a public GitHub name the outbound text itself names (`publicNames`):
  - an owner or repository segment of a `github.com/<owner>/<name>` URL, of a `repos/<owner>/<name>` API path or of a `--repo`/`-R <owner>/<name>` flag, in the argv or its body files (one trailing punctuation character dropped);
  - or the owner or name of the repository the shim's cwd stands in (its `origin` slug).
- The shim fetches the bot's token only after the gate has judged the call and hands it to `gh` through the environment (`GH_TOKEN`), never in argv, so a `ghs_` token written into the call is still blocked.
- The logic is `leakVerdict({ text, bodies, envFiles, slug, parseEnv })` in `hooks/mods/issue-guard.js`.
  - `text` is the action's own text, and `bodies` each body file's text it sends.
  - `envFiles` `[{ path, text }]` and `slug` (the root repository's `owner/name` or null) are the two `leakFacts` reads for a folder.
  - `parseEnv` is Node's `util.parseEnv`, handed in by the gate, since no `hooks/mods/` file imports a Node built-in. It has no default: a call without it throws, and the gate fails the call closed.
  - It scans what it is handed; the caller decides what is outbound, and the gate hands it every call.
  - A `--repo`/`-R` value is public on the next line too, as the shim's newline-joined argv spells it.

### `safety:capture-guard`: tool.call (Bash, Edit/Write, Read/Grep)

- Gates `.workkit/capture.md` in both directions: the owner's capture surface, whose one sanctioned touch is the triage drain. It sits in all three chains.
- A Read or Grep of it, an Edit or Write of it, and a Bash command naming its path need the marker the `workkit:triage` skill records, stale after 30 minutes (`TRIAGE_MAX_AGE_S`).
- The Bash half reads no command text itself.
  - The Bash handler in `hooks/register.js` makes one match: does the command contain `.workkit/capture.md`. The guard gets that answer as the boolean `namesCapture`.
  - A match outside a triage run is refused before the call runs, a read, a count and a write alike. The session-start line already says whether the file has entries.
  - A match inside a triage run passes.
  - The marker it asks for is the one of the session folder's repo.
- A write a Bash call makes without naming the path, `workkit note` among them, is reported after the call by `safety:script-write`, never refused.
- The marker is `triageMarkerPath` in `hooks/mods/markers.js`, the file `workkit triage mark` writes.
  - It is keyed to the capture file's repo root, or for a file in no repo the `.workkit` folder's parent.
  - Its age is `$.fs.stat`'s mtime against `$.clock.now()`.
- A `~/`, `$HOME/` or `${HOME}/` path resolves through `HOME`, a relative one against the `cwd`.
  - A Read, Edit, Write or Grep path is read with every backslash a slash, on every platform, so `D:\a\repo\.workkit\capture.md` is matched; a drive start (`D:/`) is absolute.
- A Grep is gated only when its path points at the file or its folder (the file present there) or its glob names it.
  - A repo-wide search stays open.
- The write and Bash blocks name where a finding goes instead, by `findings.file` read for the session's `cwd` (`findingsRoute` in `hooks/mods/settings.js`): said in chat under 🧭 Findings while it is off, the default; a `status:inbox` issue when it is on (`docs/project-state.md` § How big is one issue).
- Where it does not look:
  - a Bash command that reaches the file without spelling its path (`cd .workkit && cat capture.md`) is not matched, since the one text match stays a tripwire;
  - a Bash call is gated by the session's folder before it runs, so from a folder that did not opt in `cd <repo> && cat .workkit/capture.md` stands down;
  - a path to another repo's capture file is judged against the triage marker of the session folder's repo;
  - and a command that only MENTIONS the path (a commit message, an issue comment body) is refused like a read. The way around is a body file.
- The logic is `captureGuardVerdict({ tool, input, cwd, root, markerAgeS, route })` in `hooks/mods/capture-guard.js`, `markerAgeS` the marker's age in seconds or null.
  - A Bash call's `input` is `{ namesCapture }`. `captureGuardGuard` gathers the facts for all three chains.

### `docs:change-tracker`: classic.Stop

- Fires only at an endpoint: the Stop of a turn whose gh journal lines record an issue `close`, or an `edit` adding `status:qa` or `status:blocked`.
  - The test is `endpointTurn(lines)` in `hooks/mods/change-tracker.js`.
- The turn's lines are those the journal of the cwd's repo root (`journalFor` in `hooks/mods/markers.js`) gained since the owner prompt that opened the turn.
  - `classic.UserPromptSubmit` records `{ ms, bytes }` on an owner prompt, under the session's `turn-journal` key: the time, and the journal's length from its stat.
  - It never records on a harness frame (`isSystemPrompt` in `hooks/mods/frame.js`: a hand-back, a task notification).
  - The Stop reads past `bytes` as a tail (`journalTail`), never the journal or the transcript whole, since the engine's `$.fs.read` refuses a file over 4 MiB.
  - A Stop with no record (no prompt yet this session) reads no lines.
- The journal is the shim's (`workflow/README.md`, the `identity/gh` row).
  - So a close a script made counts, and a command that names one in its text but failed does not.
- Every other Stop is silent, however dirty the tree.
- `manager:close-guard`, on the same Stop, reads `$.session.messages()`.
- Nags about uncommitted work, keeping the issue true, promoting findings out of `.workkit/`, and unfiled captures.
  - What it nags on: uncommitted code, a `git status --porcelain` path that is not docs.
    - A `docs/` path, a `*.md`, `CHANGELOG*` or `LICENSE*` name and anything under `.workkit/` are docs.
    - A code extension wins over the `docs/` path.
  - Or unfiled entries in `INBOX.md` or `.workkit/capture.md`: a line not a heading, a quote or blank.
  - A clean tree or a docs-only change is silent, and so is a stop the turn already continued (`stop_hook_active`).
- The nag is `hooks/mods/change-tracker/prompt.md`, read from the plugin root.
  - Missing, it says so in one `$.ui.log` line and nags nothing.
- Then comes one FINDINGS line chosen by `findings.file` (`findingsOn`):
  - off, the default, says each finding outside the issue in hand in chat under **🧭 Findings** and files nothing;
  - on, files each as a `status:inbox` issue with the `Filed:` trail.
- A `PROGRESS.md` still there adds the BOARD line, unfiled entries the INBOX and SCRATCH counts.
- The answer is `{ block }`: the reason line, then the nag. It joins any block from beneath, and continues the turn on purpose.
- Once per change: it fingerprints what it nags about, as one SHA-1.
  - The fingerprint covers the status, `git diff HEAD` (`git diff` with no HEAD), each untracked file's text in path order (`git ls-files --others --exclude-standard -z`) and both capture surfaces' text.
  - It stays silent on every endpoint stop whose fingerprint is the one in `.workkit/agents/.change-tracker`.
  - The fingerprint has no clock in it, so two identical trees fingerprint alike.
- The state file is written whole through `$.fs.write`, one hex line, and only where `.workkit/` is a folder that gitignores it.
  - A repo with no `.workkit/`, or one whose `.workkit/` is not gitignored, keeps no memory and hears the nag at every endpoint.
  - Nothing is written on a stop with nothing to say.
- It reads git and files only, never `gh`: a network round trip on every stop is latency nobody agreed to pay.
- The logic is `changeTrackerVerdict({ stopHookActive, porcelain, diff, untracked, inbox, capture, previous, prompt })` in `hooks/mods/change-tracker.js`, async for the SHA-1.
  - It answers `{ block, context, fingerprint }` or null.
  - `cwd`, `findings`, `board` and `surfaces` (the two surfaces' text) shape the lines after the prompt and the fingerprint.
  - `changeTrackerGather(io, env, e, turn)` (`turn` the `turn-journal` record) asks `endpointTurn` over the turn's journal lines first.
  - Then it gathers them and writes the state file.
