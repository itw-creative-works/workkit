# workflow: the issue-workflow core

- The agent-agnostic core of the issue workflow.
- It calls the `claude` CLI in one place only: the command's machine steps in `workkit/`.
  - Those are the plugin's install and list, and `claude setup-token` for the cloud brief's secret.
  - The test runner and its library, whose `modCase` runs `claude plugin test`, are the `workkit-core` package (`../packages/core/`).
- Past that it knows nothing about Claude Code. That is why it lives at the plugin's top level instead of under `hooks/`.
  - The hooks call it, and `~/.claude/workkit` is its stable address for anything else that does.

| File | What it is |
|---|---|
| `labels.json` | Machine SSOT for the label vocabulary: every label is `group:value`, with its description and color |
| `standards.sh` | The heal's shell hand-over: every mode and argument handed to `standards.js` under a node at the kit's floor (`run_at_floor`), for `script-shell.sh` and a by-hand call |
| `standards.js` | Brings a repo to the standard, idempotently: the heal's modes and its flow, CJS; the session-start hook, the home heal and the command start it by path with `node` |
| `standards/` | The heal's steps `standards.js` requires, one CJS file per concern |
| `templates/issue-forms/` | The markdown GitHub issue templates (bug · enhancement · idea · dump) installed into a repo's `.github/ISSUE_TEMPLATE/`. Each pre-fills the issue anatomy (`## Description` then `## Spec`) and auto-applies `status:inbox` + its `type:` label |
| `templates/github-workflows/` | Two workflows, installed into two different places |
| `templates/capture.md` · `templates/session.md` | The two gitignored working files seeded into a participating repo's `.workkit/`: the capture file at its root, the session file under `agents/`. A file that already has content is never overwritten |
| `workkit.js` | The one command: the front door to everything below, a Node program (`#!/usr/bin/env node`) that `~/.local/bin/workkit` links to |
| `workkit.cmd` | The template of the command's Windows file, one line, `@node "{{ENGINE}}\workkit.js" %*`, which `workkit setup` and `update` write to `~/.local/bin/workkit.cmd` |
| `workkit/` | The pieces `workkit.js` requires, one CJS file per concern, and `mint-pty.exp`, the token mint's Expect script |
| `lib/` | The engine's shared libraries: Node files, one concern each, and the shell seams the git hooks, the shims and the starters source, functions only and nothing run at load, save the MSYS link flag `platform.sh` exports |
| `lib/platform.sh` | The spellings that differ per platform, and the read shapes built on them |
| `lib/run.js` | The one Node home for starting a program |
| `lib/participation.sh` | The sibling of `platform.sh` for what the KIT means rather than for what a platform spells |
| `lib/slug.sh` | The third of the seams beside `platform.sh` and `participation.sh`: what a repo is CALLED |
| `lib/tree-hash.js` | The one home of the tree ids the records hold: the working tree's, a package's own and the real index's, and the index's scratch copy and its tree `prove.js` takes, CJS, requiring `lib/run.js` and, for a package, `lib/workspaces.js` |
| `lib/tree-copy.js` | The Node home of a tree copy: the copy less `.git`, every package's `node_modules` and the kit's own paths, the fill that links each package's `node_modules`, and the worktree a copy is made in, checked out and filled with the live repo's gitignored files, CJS |
| `lib/proof-dir.js` | A proof run's folder under `~/.cache/workkit/proof`, its one-day sweep, and the empty Claude home a run hands its copy, CJS |
| `lib/snapshot.js` | The red-proof snapshot: `take`, `add`, `stale` and `drop`, as exports and as the command `workflow:snapshot` runs, CJS |
| `lib/records.js` | The suite and package records' writes and reads, the rules in `hooks/mods/suite.js` bound to the disk, CJS |
| `lib/workspaces.js` | The workspace members a package's tree id leaves out |
| `lib/expand-workspaces.js` | The expansion of a root's `workspaces` the publish plan, `lib/workspaces.js` and workkit-core's runner share |
| `lib/hold.js` | The full-suite hold, which the script shell's bare root run and `prove.js` ask in process, CJS |
| `lib/runs.js` | A detached run, one Node process from the lock to the answer: the take, the launch, the attach and the end, its answers handed back in process, CJS |
| `lib/run-lock.js` | The run lock: the take and its judge, the pid file, the record beside the lock, the live and held reads, the end request, the end of a run's processes and the listing and sweep of the narrowed runs' slots, CJS |
| `lib/run-paths.js` | Where a detached run logs and locks, the suite's, the supervised run's, the CI watch's and a narrowed run's slot; the slots a repo holds, and a slot cleared, CJS |
| `lib/body.js` | A detached Node body's end: its last line `<prefix>: exit <code>`, and its signal codes, CJS |
| `lib/lock.js` | The lock folder's rules: the claim, a run lock's mark, its retire and adopt, the plain mutex and the state mutex's path, the marker write and the markers' sweep, CJS, requiring `lib/run.js`, `lib/read.js` and `lib/proc-state.js`, and `hooks/mods/markers.js` only for the sweep |
| `lib/proc-state.js` | A process's state: its `/proc` fields, and whether it ended and waits uncollected, CJS, requiring nothing beyond Node; a program it starts goes through the starter its caller hands it |
| `lib/attach.js` | A call attached to a run: the tail of its log, painted in process, its look, the run under a supervisor already, and the view, the log reads and the path compare `watch.js` shares, CJS |
| `lib/detach.js` | The detached runner's launcher (`node detach.js`, which `lib/runs.js` runs as a process of its own) and its supervisor: its checks and its ends, requiring `lib/run.js`, `lib/pulse.js`, `lib/tree.js` and `lib/write.js`, and `lib/settings.js` only with `--root` |
| `lib/command-log.js` | The command log: a `workkit` command that does work runs again as a child whose two streams reach the call's own as they come, and its run kept plain in its log file, CJS |
| `lib/child-end.js` | The wait on a child as a shell waits on its foreground command: INT held off, HUP and TERM passed on, the end read as a shell's code, CJS, requiring only `lib/detach.js` |
| `lib/bounded.js` | One program run to its end under a bound, both streams read; past the bound its whole tree is ended and it answers 124; and the rules a bound's and a wait's variable are read by, CJS, requiring `lib/run.js`, `lib/detach.js` and `lib/tree.js` |
| `lib/pulse.js` | The supervisor's verdict on a run from one reading per check, CJS, requiring nothing: `judge`, and the counts, the work floor and the two codes |
| `lib/tree.js` | The processes under a pid by parent with their processor time (`treeOf`), and the end of that tree (`endTreeOf`, on Windows from both the Windows and the Git Bash process tables), CJS, requiring only `lib/run.js` |
| `lib/discussions.js` | The home repo's Discussions API (GraphQL through `gh`): enabling, resolving and caching the repo and category ids, posting a summary or a brief, reading prior posts back, and the category names, CJS |
| `lib/ports.js` | The processes listening on a TCP port and the end of one, `lsof` off Windows and `netstat -ano` on it, CJS, requiring only `lib/run.js` |
| `lib/regex.js` | The engine's regex escape, `escapeRegex(text)`, CJS, requiring nothing |
| `lib/scratch.js` | The scratch folder's one frame, `withScratch(run, prefix)`: a folder under the temp folder made for one piece of work and removed whatever the work did, CJS, requiring nothing beyond Node |
| `lib/git.js` | The git reads the kit's Node scripts share, CJS, requiring only `lib/run.js` |
| `lib/pause.js` | The one blocking wait the kit's synchronous Node commands share, CJS, requiring nothing beyond Node: `pause(seconds)` blocks the process through `Atomics.wait`, a fraction allowed, so a poll loop sleeps with no child process (`identity/rest-pr.js`'s `pr checks --watch`, `ship/cut.js`'s release wait, `lib/tree-copy.js`'s worktree add retries, `lib/say.js`'s full pipe) |
| `lib/day.js` | A day in the local calendar, `today(now)`, the one spelling of a dated line the kit's Node commands share, CJS, requiring `hooks/mods/log.js` for its `pad` |
| `lib/interrupt.js` | An end signal held off for a run that must clean up first, as a shell's EXIT trap lets a script: the run stops, cleans up, then ends by that same signal (on Windows, by its code), CJS, requiring `lib/run.js` and `lib/detach.js` |
| `lib/say.js` | The line helpers the kit's Node commands share, CJS, requiring only `lib/pause.js` |
| `lib/read.js` | The read of a file that may not be there, CJS, requiring nothing beyond Node |
| `lib/write.js` | The write of a file through a temp file and a rename (`writeWhole`), so a reader never sees it half-written, a JSON file changed whole on it (`editJson`), and a JSON file's value as jq reads it (`readJsonText`), CJS, requiring `lib/voice.js`, `lib/platform.js` and `lib/link.js` (the `lib/write.js` entry) |
| `lib/voice.js` | The kit's one voice: the color gate, the five levels, the title, the section and the closing line, a relayed line made plain, a tool's lines warned, the wait line, the process's own quiet and indent, CJS, requiring only `lib/say.js` |
| `lib/spin.js` | The moving wait line: a worker thread draws the frames while the caller's call runs, on the terminal device a logged command names or on stderr, CJS, requiring only `lib/voice.js` |
| `lib/flows.js` | The questions asked at a terminal: whether stdin is one, the yes or no question, a line read, the Enter gate, the opener and the poll, CJS, requiring `lib/run.js`, `lib/say.js`, `lib/spin.js` and `lib/voice.js` |
| `lib/platform.js` | The platform reads the kit's Node scripts share: a path's native spelling, a folder's physical path, and whether the kit runs from Claude's plugin cache, where a clone outranks it, CJS |
| `lib/link.js` | A machine address made a link, renamed onto it, and the link reads, CJS, requiring nothing beyond Node |
| `lib/participation.js` | What the kit means by its own git hooks folder, the Node half of the `wk_githooks_*` rules in `lib/participation.sh`, and whether a file is executable, CJS |
| `lib/repo.js` | What a repo is: its origin slug, whether it is a clone of the kit, whether its `package.json` takes the kit's test runner, CJS |
| `lib/settings.js` | The settings loader bound to the disk for the kit's Node scripts, CJS |
| `lib/cloud.js` | Whether this is a claude.ai/code cloud session, CJS, requiring nothing beyond Node: `isCloud(env)` is `CLAUDE_CODE_REMOTE` being `true` (`env` is `process.env` when absent), the workflow layer's Node twin of `wk_is_cloud` in `lib/platform.sh`, read by `ship/hooks.js`, `identity/gate.js` and `workkit/`: `allow`, `doctor`, `doctor-machine`, `identity`, `install`, `update` |
| `public/` | The public pairing's three verbs, each a Node script run from the private repo |
| `slug.js` | The Node twin of `slug.sh`, required rather than re-spelled |
| `user-dir.js` | The Node twin of `wk_user_dir` in `lib/platform.sh` |
| `identity/app.js` | The workkit-agent App's two constants, their one home |
| `identity/login.js` | The user's sign-in |
| `identity/install-page.js` | The repo's canonical owner, the owner's public id, and the App's install page |
| `identity/token.js` | The client of the hosted token service |
| `identity/gh` | The `gh` shim, linked to `~/.local/bin/gh` beside the `workkit` link so it outranks the real `gh` |
| `identity/gate.js` | The shim's gate, `node gate.js <cwd> <gh argv...>`, CJS |
| `gitshim/` | `git`, the `git` shim, put first on a Claude session's PATH by the hooks module and never linked, so `safety:tree-guard` judges git's real arguments |
| `identity/rest.js` | The shim's cloud half |
| `identity/rest-pr.js` | The REST forms of `pr create`, `pr list`, `pr view`, `pr checks` and `pr merge` |
| `identity/rest-release.js` | The REST form of `release view`, built on `rest.js`'s helpers as `rest-pr.js` is |
| `home.js` | The home repo's lifecycle, its one entry: `node home.js <verb> [argument]` |
| `home/` | The steps `home.js` requires, one CJS file per stage, the reads of a folder's committed copy (`committed.js`), and the cloud runner's list (`runner-files.js`) |
| `publish.sh` | The starter of `publish.js`, under a node at the kit's floor, every argument handed over |
| `publish.js` | Heals the home repo and refreshes its roster, then builds the tower project and pushes it to the home repo's `gh-pages` branch |
| `publish/build.js` | The one home of the three commands that turn a tower project into a built site |
| `publish/site-repos.js` | The roster the published site sweeps |
| `script-shell.sh` | npm's script shell, once `npm config set script-shell` names it |
| `script-shell.js` | A `test` event of npm's script shell, and its detached bodies |
| `script-shell.cs` | npm's script shell on Windows, a C# 5 console program |
| `prove.js` | `workkit prove`, the root suite on exactly the staged tree, the suite record's second writer |
| `supervise.js` | `workkit supervise -- <command>`, any command run detached under the supervisor, as the root suite runs |
| `morning-task.js` | The program the 9am Task Scheduler task starts on Windows, through the engine's address: it starts `jobs/morning.js` of the real kit hidden and detached, its output appended to `~/Library/Logs/com.workkit.claude-daily.log`, and ends at once; a job that cannot start is one line in that log and exit 1, CJS (`../jobs/README.md` § Install) |
| `watch.js` | `workkit watch [--end] [suite\|run\|<pid>]`, the call attached again to the repo's live run, given the code of one that ended with no call attached, or that run ended on request |
| `githooks/` | Git's own hooks, set as a repo's `core.hooksPath` by the heal |
| `note.js` | The capture command, `workkit note`'s program: `node note.js <text...>` appends one bullet to the right capture file, or files an issue on the home repo outside one |
| `changelog/lint.js` | Machine SSOT for the CHANGELOG entry rules, and the CLI both guarding hooks call (`linterPath` in `hooks/mods/changelog-guard.js`) and npm's script shell runs (`script-shell.js`): `workkit changelog lint <file> [--added-only [--base=<ref>]] [--staged] [--unreleased-only]` |
| `changelog/changelog-links.js` | Release-time backfill of each entry's commit link and contributor handle: `node changelog-links.js [--file X] [--range A..B] [--dry-run]` |
| `changelog/job.js` | A repo's `checks.yml` as the heal writes it, and the retired linter copies: the heal requires it, the commit gate runs it, `node job.js rewrite [template] \| copies \| names <file\|-> [copy]` |
| `ship/release.js` | The ship's release commit, the three edits in their order |
| `ship/plan.js` | The ship's publish plan: which packages go to npm, in dependency order, and which are skipped and why |
| `ship/publish.js` | The ship's publish, `workkit ship publish [--dir <root>]`, of what HEAD holds: from a copy of HEAD when the folder differs from it |
| `ship/cut.js` | The ship's GitHub release, which CI makes: `workkit ship cut <x.y.z>` creates nothing |
| `ship/caller.js` | A repo's checks caller, a library with no CLI: `CALLER` (its path, `.github/workflows/checks.yml`), `hasReleaseJob(text)`, `callerAtHead(root)` (its text at HEAD, or null) and `callerPending(root)` (changed, staged or untracked); `cut.js` and `release.js` require it |
| `ship/deploy.js` | The ship's deploy: `workkit ship deploy`, from inside the repo, run at its root |
| `ship/hooks.js` | The ship hooks, a library with no CLI |
| `ship/entries.js` | The one shape of a `hooks.<event>` declaration and its check, CJS, requiring `isPlain` from `hooks/mods/settings.js`: `commandsOf(settings, event)` answers `[{ command, local }]` or throws `HooksError` naming the first misshapen entry; `ship/hooks.js` and `.github/scripts/ci-hooks.js` (`hooks.ciSetup`, `hooks.ciPostInstall`, on the kit's Node) both call it |
| `ship/watch.js` | The ship's CI watch: `workkit ship watch <sha>`, under a node at the kit's floor |
| `ship/triggers.js` | Two rules over one workflow file, read in Node: `listensTo(file, event)`, whether its top-level `on:` names an event, which `ship/watch.js` and `.github/scripts/ci-release.js` require, and `takesInput(file, input)`, whether its dispatch declares an input, which `ci-release.js` requires |
| `ship/semver.js` | The kit's one version comparison, `compareVersions(a, b)` in semver's order (a missing part reads as 0, a prerelease sorts below its release), and `isSemver(v)` beside it. Required by `plan.js`, `release.js` and `cut.js` for the version shape and by `jobs/morning/brief/cc-news.js` for the upstream releases; it requires nothing |
| `ship/items.js` | The ship's Step 0c read, `workkit ship items [--repo owner/name]`, under a node at the kit's floor: every open issue at `status:qa` or `status:complete`, one line each |
| `review/covers.js` | The ship's review tier, under a node at the kit's floor: whether the full-panel review marker covers the working diff, `workkit review covers` |
| `review/mark.js` | The review marker's writer, `workkit review mark [full]`, under a node at the kit's floor: the `workkit:review` skill's record that it ran on this repo, keyed on the repo root; `full` writes the full-panel marker `review/covers.js` reads as well. An unknown argument, or no repo, exits 1 |
| `triage/mark.js` | The triage marker's writer, `workkit triage mark`, under a node at the kit's floor: the `workkit:triage` skill's record that a drain is under way, keyed on the repo root or `$HOME` outside one, which `safety:capture-guard` reads before it lets the capture file open (`docs/hooks.md` § `safety:capture-guard`) |
| `checkpoint/mark.js` | The checkpoint marker's writer, `workkit checkpoint safe`, under a node at the kit's floor: the `workkit:checkpoint` skill's record that a run filed everything, at `checkpointMarkerPath` of `CLAUDE_CODE_SESSION_ID`, holding the time in ms, for a harness; the kit reads it nowhere. No session: nothing written, exit 1 |
| `proof/red.js` | The verifier's red run, `workkit proof red [--live] <path>... -- <command>...` |
| `proof/place.js` | The place a red run's command runs in: the copy, or the live swap with `--live`, each with its restore |
| `proof/reading.js` | How a red run's output is read: the test summary and the modules that failed to load |

- `labels.json`:
  - A color is not free-chosen. It is the LIGHT-mode value of the theme token the tower draws that label in.
    - The token side lives in the dashboard's `libs/tower/format.js`, so the board and the issue page agree.
  - The heal keeps existing labels on it rather than only creating them: every fixed label, with no exception.
  - A color is unique WITHIN its group and shared freely across them, since every chip on the board carries its own word and its own glyph.
    - `type:idea` wears `status:specced`'s purple.
    - `priority:high` wears `status:blocked`'s alarm red.
    - `priority:low` wears `status:backlog`'s faint gray.
- The heal (`standards.js`):
  - It creates the labels from `labels.json`, and corrects description/color drift.
  - It installs the issue templates.
  - It rewrites `.github/workflows/checks.yml` to the kit's CI caller whenever it differs.
    - A replaced copy gets one warning per customization it held: a step to move into `hooks.ciSetup` or `hooks.ciPostInstall`, a kit step changed, a trigger, a job or workflow setting.
  - It removes a vendored linter copy.
  - It converts a `CHANGELOG.md` written with em dash separators to spaced hyphens once.
    - One that is not valid UTF-8 is left as it is, with a warning that flags the run.
  - It asks for branch protection on the caller's `checks / test` check (best effort).
    - The kit's own repo, whose `checks.yml` is its own, asks on `test`.
  - A protection that already requires `test`, a copy's own job, gets that one check swapped for `checks / test` once.
    - The swap waits until the default branch on GitHub carries the caller, read through the contents API and compared with the render. Before then it leaves the check as it is.
    - The swap is `swapRequiredTestCheck` (`standards/labels.js`), a PATCH of the required checks alone; every other check and app is kept.
    - A refused swap is a warning that flags the run.
  - It keeps `.workkit/` in `.gitignore`, along with the basics every repo needs (`.DS_Store`, `.env`).
    - Those are appended only when nothing already covers them.
  - It points git's `core.hooksPath` at the kit's commit hooks (`githooks/`), the repo's own hooks chained after them.
  - It seeds `.workkit/capture.md` and `.workkit/agents/session.md`.
  - It removes the retired `version` key from `.workkit/settings.json` (§ Every heal runs).
  - It releases agent claims that went quiet. A released `status:building` issue goes back to `status:specced` in the same edit.
  - It flips the other direction too. An open `status:specced` issue carrying `agent:claimed` is a claim on an authorized spec, so it moves to `status:building` with a comment.
    - The label is the claim. An assignee is a person's mark and moves nothing, and the release leaves it in place.
  - It checks that the hook layer beside it is alive.
  - It reports an open issue whose status labels are missing or doubled, and flags the run so the next session hears it again.
  - The session-start hook, the home heal and the command start `standards.js` by path with `node`.
    - `standards.sh` is only its shell hand-over: it loads `lib/platform.sh` and hands every mode, every argument with it, to `standards.js` under a node at the kit's floor (`run_at_floor`). `script-shell.sh` starts the git hooks mode through it.
  - Its modes: `--state`, `--announce`, `--enable`, `--decline`, `--engine-link`, `--command-link`, `--home` and `--git-hooks`; no mode is the heal.
    - A mode that reads a repo takes its folder last, the current one by default; `--engine-link` and `--command-link` read none.
- `standards.js`:
  - The heal itself, CJS: the mode parse and the flow. Each step it runs lives in `standards/`, loaded only when the mode in hand calls it.
    - So `--state`, run at every session start, loads only the state step.
    - A kit that is a `workflow/` folder alone answers `--engine-link`, `--git-hooks` and a folder that is no repo; `--command-link` and each mode that reads the participation load `hooks/mods/` beside it.
  - Its modes: `--state`, `--announce`, `--enable`, `--decline`, `--engine-link`, `--command-link`, `--home`, `--git-hooks <repo>`, and no mode for the heal (§ Participation: the tri-state).
  - `--command-link` makes `~/.local/bin/workkit` alone, through `linkCommand` of `workkit/links.js`, the link `workkit setup` makes.
  - `--git-hooks <repo>` runs the git hooks step alone, with no participation check, exit 1 when the step flagged the repo, else 0.
    - It prints in its caller's voice: it sets neither `WK_LOG_STDERR` nor `WK_LOG_INDENT`, so a bare call prints on stdout, flush left.
    - Every other mode sets both (stderr, two spaces), keeping stdout for the answer of `--state` and `--announce`.
  - It builds one run object and hands it to every step, each step a function named for what it heals, awaited in turn:
    - `root` (git's top level, the process's folder), `rosterKey` (`nativePath(root)`), `kit` (the kit root, physical), `userDir`;
    - `claudeHome` (`claudeHome()` of `lib/platform.js`), `hooksDir` (`WORKFLOW_HOOKS_DIR`, else the kit's `hooks/`), `state` (the participation answer);
    - and `needsAttention`, which a step sets to flag the run. A step never ends the process.
  - It needs no `jq`, `perl`, `awk` or `sed`: what it reads, it reads in Node, and it starts `git` and `gh` by name from PATH.
- `standards/`:
  - Each file CJS, required by `standards.js`, each step taking the run object.
  - `flag.js`: `flag(run, line)`, the heal's one "warn and flag the run": the line through `warn` (`lib/voice.js`), then `run.needsAttention` set.
    - Every step's warning that flags the run calls it; a flag with no line of its own, or one another writer printed, sets the property itself.
  - `engine-link.js`: the engine's address (`ensureEngineLink`).
  - `state.js`: participation, the seeds, the version key's removal, the roster, the opt-in.
    - `seedUserSettings`, `resolveState`, `offerLine`, `recordDecline`, `writeRepoOptin`, `registerInRoster`, `reportUserSettings`, `removeVersionStamp`.
    - It reads a settings file's flag through `repoFlag` (`hooks/mods/gate.js`), and edits a settings file or the roster through `editJson` (`lib/write.js`), a decline and the roster under the state mutex (`stateLockPath` in `lib/lock.js`).
  - `gitignore.js`: `.gitignore` and the local working files (`ensureWorkflowIgnored`, `ensureGitignoreBasics`, `ensureLocalFile`).
  - `githooks.js`: `ensureGitHooks(run)`, for the run's root.
    - It runs after the `.gitignore` basics, and alone through `--git-hooks <repo>`, which `script-shell.sh` runs through `standards.sh` and `workkit setup` runs on `standards.js`.
    - It sets git's `core.hooksPath` to the folder `githooksAddress` names, in git's spelling of the path.
    - That is `~/.claude/workkit/githooks` when the engine link points at this engine, so a plugin update leaves the path good.
    - It is this kit's own `githooks/` folder where the link is missing.
    - `core.hooksPath` is read with `--path`, so a `~/` spelling is read expanded.
    - A folder the repo named before is saved once to `workkit.hooksPath`, an existing saved value kept.
      - That is husky's `.husky/_` or lefthook's, or one of its own that merely ends `/workflow/githooks`.
    - A kit-like folder (`githooksKitlike`, `lib/participation.js`) is repointed with nothing saved:
      - this kit under another spelling, always;
      - a gone folder, always;
      - another kit, unless it is a workkit clone, which outranks the plugin cache as the engine's address does.
    - The ok line is `git hooks: installed (<path>)`. The changed line is `git hooks: set|repointed core.hooksPath → <path>`.
    - Whether the hooks are set is `core.hooksPath` naming a kit's hooks folder: `git_hooks_installed <root>` for the script shell, a shell read with no node (the `lib/participation.sh` entry), and the same read in Node for `workkit setup` and `doctor` (`localConfig` of `lib/git.js`, then `githooksKit`).
  - `templates.js`: the issue forms (`ensureIssueForms`).
  - `checks.js`: `checks.yml`, the kit's caller (`ensureCiWorkflow`).
    - It writes the rendered template (`checksRewrite`, `changelog/job.js`) through `writeWhole` (`lib/write.js`) whenever the file differs, and nothing when it matches.
      - A template it cannot render, or a caller it cannot write (a `.github` that is a file included), is a warning that flags the run.
    - Before replacing a file it reads it into `<path>\t<value>` leaves (`checksLeaves`).
    - It names every customization in a `checks.yml: replaced by the kit's caller; <reason>: <what>` warning that flags the run (`checksKeptOut`).
    - A customization is any of these:
      - a step the kit's templates never carried, its `with:` and `env:` said:
        - a `run:` step: `move this step into hooks.ciSetup, or into hooks.ciPostInstall when it needs the installed packages`;
        - a `uses:` step: `a uses: step cannot run in the kit's CI; do its work as a command in hooks.ciSetup or hooks.ciPostInstall`;
      - a kit step whose body differs from every template's (`the kit's own step runs in place of this one`);
      - a trigger or a trigger filter past `pull_request`, a push on exactly the default branch and an old copy's CHANGELOG `paths-ignore` (the caller's release-push skip took its place);
      - a job setting past `runs-on: ubuntu-latest`, `steps` and the kit's changelog `uses:`;
      - any top-level key but `name`, `on` and `jobs`;
      - the retired kit clone step (`the kit no longer clones itself; a repo whose tests need WORKKIT_ENGINE sets it in hooks.ciSetup`).
    - A kit step is known by `name:`, else by the action a nameless one `uses:`, its version aside.
    - A key the template itself holds at the same value is never one.
    - The kit's own checkout is skipped: its `checks.yml` is its own.
    - A repo with no origin remote gets no caller.
    - A repo whose default branch nothing names keeps its file, with a warning naming `git remote set-head origin -a`.
  - `changelog.js`: the linter copies, the separator (`removeChangelogLinterCopies`, `ensureChangelogSeparator`).
  - `labels.js`: branch protection, the label sync, and the public pairing (its key, the `status:` labels on the public repo, the mirror sweep).
    - `ensureBranchProtection`, `readPublicRepo`, `syncLabels`, `syncPublicLabels`, `sweepPublicMirror`.
    - Its `gh` reads and writes go through `runGh` (`public/lib.js`); the one whose wait shows is the read of the default branch, through `spin` (`lib/spin.js`): frames at a terminal, `⏳ reading the default branch...` once anywhere else.
  - `claims.js`: the claim sweeps and the issue label check (`sweepStaleClaims`, `flipClaimedSpecced`, `checkIssueLabels`).
    - A released `status:building` issue returns to `status:specced` in the same edit.
    - Its spec is still accepted, and leaving it building would count it as in flight everywhere.
    - The staleness test reads each issue's `updatedAt` in Node, so no platform's `date` is asked.
  - `hooks.js`: the hook layer's self-check (`checkHookLayer`).
  - `tests.js`: whether `npm test` runs `workkit-core`'s runner (`checkTestRunner`).
    - `package.json` is read, never run.
    - A test script passes when its devDependencies name `workkit-core` (`hasCorePackage`, `lib/repo.js`), whatever the script, since one may wrap `workkit test`.
    - Any other test script warns once, naming `npm i -D workkit-core` and `"test": "workkit test"`. It never marks the run unfinished.
    - The shape it stands for: `docs/tests.md` § The shape.
- `templates/github-workflows/`:
  - `brief.yml` is the cloud morning brief, seeded onto the HOME repo by home's runner seed (`home/runner.js`) and nowhere else.
  - `checks.yml` is the CI caller written into a repo's `.github/workflows/`, the kit's and never the repo's.
    - The triggers: every pull request, and every push to the default branch.
    - The default branch is the `__DEFAULT_BRANCH__` placeholder the heal fills through `defaultBranch` (`lib/git.js`).
    - Job `checks` calls the kit's `.github/workflows/ci.yml@main` with `secrets: inherit`.
    - Job `release` runs on a push only (`if: github.event_name == 'push'`), so a pull request's token stays read-only.
    - `release` has `contents: write` and `actions: write`, and calls the kit's `.github/workflows/release.yml@main` with no secrets. The job's own token is its only credential.
  - The reusable `ci.yml`'s `test` job runs the kit's `.github/scripts/ci-node-version.js`, `ci-hooks.js` and `ci-test.js` from a shallow clone of the kit in `$RUNNER_TEMP`, outside the workspace.
    - What they run: the Node version, the repo's `hooks.ciSetup` before the dependency install, its `hooks.ciPostInstall` after it, the suite under `xvfb-run -a`.
    - Every kit script runs on the kit's own Node, never the repo's, which may be older: right after the kit's clone, `actions/setup-node` sets up `lts/*`, and a `Kit Node` step keeps its path in `WORKKIT_NODE`.
      - Each script's step is `"$WORKKIT_NODE" "<kit>/.github/scripts/<name>.js"`. The kit's own `checks.yml` has the same two steps in its `scope` job.
      - The repo's Node is set up after the `Scope` step, at the version `ci-node-version.js` names; the install, the hook commands and the suite run on it, through PATH. A `workkit` command started inside them runs on PATH's `node`, the repo's, and stops on its floor line where that Node is below the kit's floor (§ The one command).
    - A newer run on the same pull request cancels the older.
  - A release push runs no setup, install or suite.
    - A `Scope` step right after the kit's Node answers `run=true` for a pull request.
    - For a push it asks the kit's `release-push.js` with the push's `before`, which fetches it when the shallow checkout lacks it.
      - It reads each changed file at both commits through git, so it moves no ref, and needs no `jq`.
      - A version stamp is the commit gate's version-only rule (`isManifest` and `versionOnly` in `hooks/mods/commit-gate/checks.js`), so a release that also moves the dependency pins equal to the version, as a workspace releasing in lockstep does, skips too.
    - Every later step runs only on `run=true`.
    - On `run=false` one last step prints one line saying every change is the CHANGELOG or a version stamp.
  - Its `changelog` job calls the kit's `changelog.yml`, whose header says what a push and a pull request judge.
  - The reusable `release.yml` clones the kit the same way and runs `.github/scripts/ci-release.js` on a full checkout, `GH_TOKEN` the job's token.
    - It takes each `chore(release): <x.y.z>` commit the push brought, oldest first.
      - The range is `before..after` from the event, a merged branch's included.
      - A new branch or a force push reads the pushed commit alone.
    - It also takes every release commit the cut would wait for that an earlier run never released.
      - Those are the branch's newest, and the ones `cut.js`'s `missingBefore` walk finds below it.
      - Each prints `ci-release: v<x.y.z> has a release commit but no release, so it is released too`.
    - Each with no `Release: none` trailer and no release yet gets `gh release create v<x.y.z> --target <sha> --title v<x.y.z> --notes-file <notes>`.
    - The notes are `cut.js`'s `sectionBody` of that commit's CHANGELOG. None is the cut's line and a failed job.
    - gh's stderr is read and written to the job's stderr as it was, on success and on failure.
    - A failed create is `ci-release: gh release create v<x.y.z> exited <code>`, and the job exits with gh's code.
      - Another run that made the release meanwhile is `ci-release: gh release create v<x.y.z> exited <code>, but v<x.y.z> is there now, so it is released` instead, exit 0.
    - A failed create whose stderr holds `HTTP 403` adds two lines when the target's `.github/workflows` differs from the pushed head's (which a target that is the pushed head never does), `git diff --quiet <target> <head> -- .github/workflows` exiting 1:
      - `ci-release: GitHub refuses a job's token a release at a commit that is no branch head or tag when its .github/workflows differs from the branch's (it needs the workflow scope, which no job's token holds)`
      - `ci-release: make it by hand, signed in as a person: gh release create v<x.y.z> --target <sha> --title v<x.y.z> --notes-file <a file holding CHANGELOG.md's [x.y.z] section>`
      - The pushed head is the event's `after` (HEAD when it has none). A release a person makes fires the `release` event itself.
  - A release that job's token makes starts no workflow.
    - So after a create, or on a re-run where a release commit the push brought already has its release, it dispatches.
    - It runs `gh workflow run <file> --ref <the event's repository.default_branch>` for every workflow whose top-level `on:` names both `release` and `workflow_dispatch` (`listensTo` in `ship/triggers.js`).
    - It adds `-f tag=v<x.y.z>` for one whose `workflow_dispatch` declares a `tag` input (`takesInput` in `ship/triggers.js`).
      - The tag is the newest version that run released or found released. Its `ci-release: started` line names the tag.
    - Each is tried whatever the one before answered.
      - A failure is `ci-release: dispatch of .github/workflows/<file> failed: <gh's first stderr line>`.
      - The job exits 1 once every one was tried.
    - It names a workflow on `release` alone in a `ci-release: warning:` line.
  - The heal rewrites the caller whenever it differs, so a hand edit lasts until the next heal (`standards/checks.js`).
- `workkit.js`:
  - Its verbs: `setup [--token | --login | --bot | --home | --cloud]` · `update [--auto]` · `doctor` · `publish` · `brief [--local]` · `log [-n N] [--follow]` · `tower` · `enable` · `decline` · `heal` · `state` · `note` · `test [paths] [--filter=<text>]` · `tools` · `convert [paths...]` · `prove` · `supervise -- <command>` · `watch [--end] [suite|run|<pid>]`.
  - And: `public intake|mirror|close` · `ship items|release|watch|cut|plan|publish|deploy` · `review covers|mark` · `triage mark` · `checkpoint safe` · `proof red` · `changelog lint`.
  - Its first line is `#!/usr/bin/env node`, so the Node it runs on is the first `node` on PATH. Giving one at the kit's floor is the machine's job; the kit looks for no other.
    - On Windows cmd and PowerShell reach it through `~/.local/bin/workkit.cmd` (the `workkit.cmd` row), Git Bash through the link.
  - The floor check comes first, in syntax an older Node still reads (`workkit/floor.js`).
    - The floor is the root `package.json`'s `engines.node`, 22.22. A Node below it prints `workkit: this Node is <version>; the kit needs 22.22 or newer` on stderr and stops, with no other Node searched for.
    - The code is 2 for `review covers` and `proof red`, whose 1 means stale or green, and 1 for any other command.
    - An engine copied without its kit's root has no `package.json` there, and no floor is checked.
  - Then `main` (`workkit/main.js`) runs the list guard, the command log and the route, in that order.
    - The guard refuses a first word with no entry in `COMMANDS` (`workkit/command-list.js`) before anything runs, its log included: `unknown command <word>`, an empty line and the map on stderr, exit 1. `help`, `-h`, `--help` and no word print the map on stdout, exit 0.
    - A command the log names runs again under it as a child (the `lib/command-log.js` entry); a call made inside a logged command is in that log already, and routes here.
    - The route loads each verb's file where it runs it, so one missing file stops only the commands that need it.
  - A program the command starts is its child, started by the running Node (`process.execPath`); its output and exit code are the command's.
    - That is every verb file of a verb with subcommands, `standards.js` for `enable`, `decline`, `heal` and `state`, `tower/start.js`, `prove.js`, `supervise.js`, `watch.js` and `note.js`.
    - A Ctrl-C at the terminal reaches the child too; HUP and TERM are passed on to it; an INT sent to the command's pid alone is not.
  - A verb with subcommands follows one rule: `workkit <verb> <sub>` runs `<verb>/<sub>.js`, but `checkpoint safe`, which runs `checkpoint/mark.js` (`workkit/verbs.js`).
    - An unknown or missing subcommand exits 1 with one line naming the ones there are.
  - A kit missing one of the command's own files ends with `workkit: the kit is incomplete: <path> is missing` and 1. A program it starts that is missing gives the line of the step that guards it, naming the `.js` file (`site: publish.js is missing at <path>; the kit is incomplete`), else Node's own `Cannot find module` error and 1.
    - The programs of each `<verb> <sub>` and of `enable`, `decline`, `heal`, `state`, `prove`, `supervise`, `watch` and `note` are guarded in the routing table: `<verb>: <file>.js is missing at <path>; the kit is incomplete` (`<verb> <sub>:` for a subcommand) as an error, and 1.
  - A reader that closes early (`workkit log | head`) ends the command quietly with 141.
  - The command starts loud whatever its caller set (`QUIET=0`); `update --auto` quiets itself.
- `workkit/`:
  - CJS, each file one concern, each step `fn(kit, ...args)` answering a number: the step's code, or a count of lines that need attention. Only `workkit.js` and `main.js` end the process.
  - `floor.js`: `floorOf()` (the floor off the root `package.json`, `[22, 22]`), `floorLine(version, floor)` and `floorCode(argv)`, in syntax an older Node still reads.
  - `main.js`: `main(argv)`, the guard, the command log and the route; `dispatch(kit, argv)`, the route alone, which the command log runs in its own process for a call it writes no log for (a repo command outside a repo, a log that cannot be made).
  - `kit.js`: `kitOf(overrides)`, the one context every step takes: the variables, the system (`platform`), the home, the engine and the kit's root, the kit's own files, the machine addresses, `interactive`, the secrets' names and bounds, and `run`, the answers one run carries between steps.
    - `nodeRun(kit, file, args, options)` starts a Node program of the kit with the running Node on this terminal and answers its code; `nodeRead` does the same with its two streams read.
    - `homeEnv(kit)` and `homeRun(kit, args, options)` start a verb of `home.js` in the caller's voice: its stream, its indent and its quiet.
    - `missingLine(step, file)` is the line a step prints for a program of the kit that is not there: `<step>: <file name> is missing at <path>; the kit is incomplete`. `homeMissing(kit, step)` is that line for `home.js`.
    - `flagged(code)` is a step's code as one count.
    - A program's output as a shell's `$(...)` takes it, its trailing newlines dropped, is `chomp(text)` of `hooks/mods/text.js`.
  - `command-list.js`: `COMMANDS`, the kit's one list of its commands, each `{ command, permission }` with a permission of `allow`, `ask` or `none`, and its three readers.
    - `commandsWith(permission)` answers that permission's commands in the list's order; `commandListed(word)` whether an entry's first word is `<word>`.
    - `commandVerbs(word)` answers the second word of each entry whose first word is `<word>`, in the list's order: the ship's verbs and the command log's names are read through it, so no other file reads an entry's shape.
    - It requires nothing, so the guard reads it before any other piece loads.
    - The ship's verbs are entries one by one (`ship items` to `ship deploy`), so each rule is read off it and a deploy gets a rule of its own.
    - A new command needs its entry here, or the guard refuses it.
  - `help.js`: `HELP`, the map, and `usage(stream)`.
  - `verbs.js`: `route(kit, verb, args)`, the routing table of every command that hands its whole run to a program of the kit: the seven verbs with subcommands, `tower`, `enable`, `decline`, `heal`, `state`, `prove`, `supervise`, `watch` and `note`.
  - `links.js`: the pointers the command keeps on the machine, and `machineLinks`, the one order `update`, the wizard and `setup --cloud` make them in.
    - That order is the engine's address (`standards.js --engine-link`, its lines re-said), the `workkit` command and its PATH line, on Windows `workkit.cmd`, the `gh` shim, npm's `script-shell`, then the kit's allow and ask rules (`keepAllowRules` in `allow.js`).
    - `linkCommand(kit)` is the command link alone, which `standards.js --command-link` runs; `renderCmd(template, { engine })` is `workkit.cmd`'s text.
  - `npm-shell.js`: npm's `script-shell` pointed at the kit (`scriptShell(kit, mode)`), the Windows executable built from `script-shell.cs` (`scriptShellExe`), and `windowsPath(p)`, a path's Windows form.
  - `allow.js`: the kit's allow rules (`ALLOW_RULES`, at `permissions.allow`) and ask rules (`ASK_RULES`, at `permissions.ask`) in the global `~/.claude/settings.json`, setup's step (`keepAllowRules`) and doctor's lines (`reportAllowRules`).
    - `ALLOW_RULES` is `Bash(workkit <command>:*)` for each `allow` entry of `COMMANDS`, then `Bash(npm publish:*)`; `ASK_RULES` the same for each `ask` entry. A `none` entry gets no rule.
    - `RETIRED_ALLOW_RULES` (`Bash(workkit ship:*)`) is taken out at every run.
  - `schedule.js`: the 9am schedule's drift (`cronDrift`), its update (`updateCron`) and its first install (`installCron`), through `jobs/install.js`.
  - `install.js`: the plugin, the gh login, the tower pointer, this repo's state and its opt-in offer.
  - `site.js`: the publish question and the domain, and `settingsOf(kit)`, the machine settings file's path, which the token handover names too.
  - `token.js`: the token handover (`handoverToken`).
  - `secrets.js`: the cloud brief's secrets ([The cloud brief's secrets](#the-cloud-briefs-secrets)).
  - `pty.js`: `runUnderPty(kit, command, capture, stdio)`, a command under a pseudo-terminal for the token mint (below).
  - `mint-pty.exp`: the Expect script that pty runs the mint under at a terminal.
  - `identity.js`: the bot identity's sign-in and install steps and doctor lines.
    - It asks through `askYes`, opens the install page through `openUrl` and waits through `poll` (`lib/flows.js`).
  - `setup.js`: the wizard, its flags, its `--cloud` form, the home steps, the git hooks line, and `cloudNa`, the not-applicable line `update` and `doctor` print too.
  - `update.js`: `update` and `update --auto`.
  - `doctor.js`: `doctor`, every report in its order under its four sections, and the closing line; `doctor-machine.js` holds its checks of this machine, `roster.js` the roster's line.
  - `commands.js`: `publish`, `brief`, `test`, `tools` and `convert`, each handing its run to a program; the last two run the kit's own `packages/core/bin/workkit.js`.
  - `log.js`: `log`, the hooks log's last 40 lines, or `-n N`, and `--follow` printing each line added after.
    - It prints one skip line when there is no log yet.
- `lib/`:
  - Three are shell seams the hooks, the shims and the starters source, each with its own entry: `platform.sh`, `participation.sh` and `slug.sh`.
  - `runs.js` is the Node home of a detached run (with `run-lock.js`, `lock.js`, `attach.js` and `detach.js`).
    - `supervise.js`, `prove.js`, `script-shell.js` and the CI watch (`ship/watch.js`) call its `run` in process.
    - `watch.js` calls no `runs.js`: it reads and follows a run through `attach.js`, `run-lock.js` and `run-paths.js`.
  - `command-log.js` is the command's, with an entry of its own.
- `lib/platform.sh`:
  - Sourced by `standards.sh`, `publish.sh`, `script-shell.sh` and `jobs/morning.sh`, and by the shims and git's hooks alike.
  - It is the shell twin of `test/lib/platform.js`, and of `lib/run.js` on the Node side.
  - A shape sits here beside the spelling it is built on.
  - Its functions, each below.
  - `wk_jq`, since jq on Windows is a native program whose stdout is in TEXT MODE.
    - So a value read bare carries a `\r` into whatever is compared or written next.
    - Every jq call in the kit's shell (the `gh` shim, `lib/participation.sh`, `lib/slug.sh`) goes through it.
    - jq's own exit status comes back, so a predicate (`jq -e`, `jq empty`) answers what it always answered.
  - `wk_native_path`: the native spelling of a path, which is git's own, by `nativePath`'s rule (`lib/platform.js` below): the identity off Windows, `\` made `/` for a path already spelled for Windows, `cygpath -m` for any other.
    - Every kit shell line prints a path for a person in it, so Windows output never mixes `/d/a` and `D:/a`.
    - It is the one spelling a machine-roster key is written and looked up under.
    - So `C:/Users/x` and the Git Bash `/c/Users/x` cannot become two keys for one repo.
    - Its Node twin is `nativePath` in `lib/platform.js`, which the heal keys the roster through.
  - `wk_sha1`: the one digest (`shasum` or `sha1sum`).
    - A machine with neither is refused loudly, rather than keyed to an empty string.
  - `wk_keyed_path <folder> <anchor>`, beside it: the path `<folder>/<sha1 of anchor>`, 1 when no digest comes out: the keyed-name step of `wk_marker_path`.
  - `wk_marker_path <dir> <anchor>`: the one derivation of a marker's path, `<markers dir>/<dir>/<sha1 of anchor>`, through `wk_keyed_path`.
    - It serves the `gh` shim's journal; a log's marker path is keyed in Node (`logPathOf` in `lib/run-paths.js`).
    - The review and triage markers and the suite and package records are keyed in Node, by `markerPath` in `hooks/mods/markers.js` (the records: the `lib/records.js` entry).
    - The checkpoint marker is keyed by its session id instead, every character but a letter or a digit as `_` (`checkpointMarkerPath` in `hooks/mods/markers.js`), so a harness names it without the digest.
  - `wk_markers_dir`: that base, `markers/` in `wk_user_dir`'s folder, out of reach of a system temp cleaner.
  - `wk_sweep_markers`: the kit's own cleaner. Every shell marker writer calls it; the two record writers in `lib/records.js` and the marker verbs' `writeMarker` run its Node twin, `sweepMarkers` in `lib/lock.js`.
    - It removes each regular file one folder under the base whose mtime is older than `MARKER_KEEP_DAYS` (7 days, set here).
    - It never enters a folder there.
  - `wk_user_dir`: the shell's one spelling of the machine folder (`WORKFLOW_HOME` else `~/.workkit`), the shims' and the seams' alike; its Node twins are `userDir` in `hooks/mods/log.js` and `user-dir.js`.
  - `wk_is_cloud`: whether this is a claude.ai/code cloud session (`CLAUDE_CODE_REMOTE` is `true`).
    - The `gh` shim reads it.
    - Its Node twin is `isCloud` in `lib/cloud.js`, which `workkit setup --cloud`, `update` and `doctor` read.
  - `wk_node`: the path of the first node whose `--version` reaches `WK_NODE_FLOOR`.
    - `WK_NODE_FLOOR` is 22.22, set here: the kit's one lowest Node, the `engines` floor of the root `package.json` and of `packages/core/package.json` alike. The command reads the floor off the root `package.json` itself (`workkit/floor.js`).
    - It tries, in order: `$WORKKIT_NODE`, `node` on PATH, `~/.nvm/default-bin/node` (the dotfiles pin, on a Mac and on Windows), and nvm's newest `~/.nvm/versions/node/v*/bin/node`.
    - It gives nothing and 1 when none fits.
    - It is the node the `gh` shim's gate, the `git` shim's judge, the git hooks' judge and `wk_settings_enabled` (`lib/participation.sh`) run under.
  - `run_at_floor <prefix> <code> <file> [args]`: `<file>` exec'd under `wk_node`'s pick, or one `<prefix>: no node at or above <floor> is installed` line and exit `<code>`.
    - `script-shell.sh`, `standards.sh`, `publish.sh` and `jobs/morning.sh` start their Node files through it.
  - The locks are Node's alone, the plain mutex and the run lock: `lib/lock.js`, below.
- `lib/run.js`:
  - CJS, requiring nothing beyond Node, the Node twin of `lib/platform.sh`.
  - workkit-core ships it as `workkit-core/run`; its prepack copies it to `run.cjs`.
  - `spawnSync`, `spawn` and `execFileSync` take `child_process`'s arguments and give its results and errors.
    - Off Windows they are its own calls.
  - `onPath(name, { platform, env })` is the engine's one `command -v`: the program a bare name names on PATH, null when none. On Windows it is the launch's own search below; elsewhere the first executable file.
    - The suites have their own, the test library's `onPath` (`packages/core/test/lib/on-path.js`).
  - `keyOf(env, name)` is the key `env` holds `name` under in any letter case, the first in sorted order, undefined when none: how `enterMachine` (`jobs/lib/machine.js`) writes the PATH Windows spells `Path`.
  - On Windows `launchOf(cmd, args, options, { platform, parentEnv })` answers the real launch `{ file, args, options }`.
    - A bare name is searched on the given env's PATH (else the parent's) dir by dir, each entry trimmed of its quotes.
    - It tries the name, then `.exe`, `.com`, `.cmd`, `.bat`.
    - An extensionless file counts only when its first line starts `#!`.
    - A `#!` naming node (`#!/usr/bin/env node`, or a path ending `/node` or `/node.exe`, in any letter case) runs under `process.execPath`.
    - Any other runs through Git Bash. The script path comes first either way.
  - Git Bash is found as `script-shell.cs`'s `FindBash` finds it.
    - It is the first `bash.exe` on PATH outside `%SystemRoot%` and `%LOCALAPPDATA%\Microsoft\WindowsApps` (by prefix, any letter case), where WSL's live.
    - Else it is `..\bin\bash.exe` beside the first `git.exe`.
  - With Git Bash found nowhere, a bare name's `#!` hit is passed over for the next candidate.
    - But `bash` itself, or a `#!` file named by path, fails loudly naming Git Bash, its code `ENOENT`.
    - `launchOf` throws it.
    - `spawnSync` answers child_process's own result for a start that failed: the error in `error`, `pid` 0, `status`, `signal` and `output` null.
    - `execFileSync` throws it with that result on it, as child_process does.
    - `spawn` hands back a child that emits it.
  - A `.cmd` or `.bat` runs through `ComSpec` as `/d /s /c "<line>"`.
    - The program is unquoted. Every `()][%!^"<>&|;,*?`, backtick and space in it is escaped with `^`.
    - That is because an escaped quote opens no quoted run, and a space would split the command word (`C:\Program Files`).
    - Each argument is quoted, then every `()%!^"<>&|` in it is escaped with `^`.
    - So an argument can neither end early nor chain a command.
  - An npm cmd-shim (a `.cmd` under `node_modules\.bin`, cross-spawn's rule) or a file named `npm.cmd` or `npx.cmd` in any folder and any letter case (together `NPM_CMD_SHIM`) gets each argument's escaping twice.
    - Its `%*` parses the line again. Any other `.cmd` or `.bat` gets it once, since a batch file that reads `%1` itself would see the extra carets.
  - Every argument and the program name (`argv0`, unless the caller passes one) go through `windowsQuoted`, verbatim.
    - So Git Bash never globs or splits one.
  - A given env lacking one of `WINDOWS_KEPT` takes it from the parent.
    - Those are `ComSpec`, `SystemRoot`, `PATHEXT`, `TEMP`, `TMP`, any letter case.
  - A name the env spells in more than one case (`Path` and `PATH`) is read under the key Node hands the child, the first in sorted order.
  - A name found nowhere is left as given, so the start fails with ENOENT.
  - The platform is read once at load, so a test that fakes `process.platform` never hands a real program the win32 launch.
  - Every shipped file that starts a program requires it, or is handed its starter by a caller that does (`ended` in `lib/proc-state.js`).
  - `test/scripts/run-home.test.js` fails any other `child_process` import but one and a list:
    - the published workkit-core runner's `packages/core/test/run.js`, for one reason: the fork of its suite workers, which run.js does not have;
      - its `packages/core/test/lib/spawn.js` starts through run.js, which `kit-module.js` loads: the kit's file in the kit's checkout, else the packed `run.cjs`;
      - its `packages/core/test/lib/members.js` starts each member's `npm` through the starter `packages/core/test/run.js` hands it, so it imports none;
    - the root `test/` files still on the check's list, which only shrinks.
- `lib/participation.sh`:
  - Sourced by `script-shell.sh` and by the shims and git's hooks alike.
  - `wk_is_repo_root <dir>`: it asks `.git` with `-e` and never `-d`.
    - A worktree's and a submodule's `.git` is a FILE, and a `-d` reading skips a repo that works perfectly.
  - `wk_opted_in <root>`: 0 when the repo turned workkit on.
    - That is `<root>/.workkit/settings.json`, a file whose own `enabled` is `true`, through `wk_settings_enabled`.
      - It reads the key through the node `wk_node` finds, which asks `repoFlag` in `hooks/mods/gate.js`, so a nested `enabled` (`manager.enabled`) changes nothing; a text match only where there is no node.
    - No file, an empty one, `{}` or one with no key is off, the default. The machine's file has no say.
    - It is the shell side's one opt-in test, the twin of `settingsOptedIn` in `hooks/mods/gate.js`.
    - `wk_session_judges` and `script-shell.sh`'s repoint ask it; the capture command's `participating` (`note.js`) asks its Node twin.
  - `wk_setting <root> <dotted.key>`: one setting from the merged view.
    - The view is the kit's `defaults/settings.json`, then `$(wk_user_dir)/settings.json`, then `<root>/.workkit/settings.json`, none with an empty root.
    - They merge key by key in jq as `loadSettings` in `hooks/mods/settings.js` merges them, `enabled` the root's own alone.
    - A string prints raw, null as nothing, and anything else as JSON.
    - The defaults are found at `defaults/settings.json` two folders above `participation.sh` itself (`${BASH_SOURCE[0]%/*}/../../`).
    - That holds because every caller sources the file by absolute path.
    - Defaults missing or not an object give an error naming the file, and 1.
    - The site options are read in Node: `home/options.js`, the command's site step (`workkit/site.js`), `publish.js` and the jobs read them through `settingsAt` or `siteOption` (`lib/settings.js`) with a null root.
  - `wk_session_judges <root>`: 0 when a Claude session's checks rule in that root.
    - That is `CLAUDECODE=1`, `HOOK_DISABLE` not `1`, and `wk_opted_in`.
    - It is the one gate of the git hooks (`githooks/hook.sh`), the `git` shim (`gitshim/git`) and the `gh` shim's session gates (`identity/gh`).
    - Its Node twin is `sessionJudges(env, settingsText)` in `hooks/mods/gate.js`, the gate of the full-suite hold (`lib/hold.js`).
  - What the kit means by its own hooks folder, for the hooks' chain and the git hooks read below; the heal's Node half is `lib/participation.js`.
    - So a hook loads nothing of the heal's.
    - `wk_githooks_kit <root> <folder>`: 0 and the kit root printed when the folder's physical path ends `/workflow/githooks` and holds executable `pre-commit` and `commit-msg` and a `judge.js`.
    - A relative folder is read against the root, as git reads it.
    - `wk_githooks_spelled <folder>`: 0 for a spelling ending `/workflow/githooks` or `/workkit/githooks`.
    - `wk_githooks_kitlike <root> <folder>`: the predicate the hooks' chain asks, and the heal asks its Node twin.
    - It is 0 when `wk_githooks_kit` accepts the folder.
    - It is 0 too when the folder is spelled like a kit's and does not exist (a plugin update's leftover, a dangling link).
    - So an existing folder of the repo's own that merely ends `/workflow/githooks` is not kit-like.
    - The twins, rule for rule: `githooksKit`, `githooksSpelled` and `githooksKitlike` in `lib/participation.js`.
  - `git_hooks_installed <root>`: 0 and the folder printed when `core.hooksPath`, read with `--path` so a `~/` spelling is expanded, names a kit's hooks folder by `wk_githooks_kit`; 1 for any other value or none.
    - It asks git alone and starts no node, so an install-time script in a repo whose hooks are set starts none.
    - `script-shell.sh`'s re-point asks it first; `workkit setup` and `doctor` make the same read in Node for their This repo line (`gitHooksLine` in `workkit/setup.js`).
    - Where it fails, the re-point sets the hooks through `standards.sh --git-hooks <root>`, and setup through `standards.js --git-hooks <root>`.
- `lib/slug.sh`:
  - Sourced by the `gh` shim.
  - `wk_slug_from_remote <url>` is `owner/repo` out of a remote in every form git writes one, the SSH shorthand and the HTTPS URL.
    - It also reads one out of a local path in EITHER separator.
    - Git stores a remote exactly as it was typed, and a path typed natively on Windows comes back with backslashes.
    - The trims and the regex are `slugFromRemote` in `../slug.js`, shape for shape.
    - So the roster and the home repo's project list can never disagree about what a repo is called.
  - `wk_repo_slug <dir>` is that rule over a working tree's origin.
    - The hooks module reads it as `repoSlug` in `hooks/mods/optin.js`, over `hooks/mods/slug.js`'s copy of `slugFromRemote`.
    - That copy is the one `safety:release-taken` names the repo in its github-release bounce through.
    - `wk_is_kit_checkout <dir>` asks it whether a tree is a clone of workkit itself.
    - Its Node twin, `isKitCheckout` in `lib/repo.js`, is the rule the engine's address and `cloneOutranks` (`lib/platform.js`) read.
  - `wk_roster_path <owner/name> [<match>]` runs it the other way.
    - It gives the machine roster's enabled folder whose origin is that slug, matched without regard to case, or 1.
    - Given a `<match>` function, it gives the first enabled folder it accepts instead (the `gh` shim's `names_public`).
    - The hooks module follows it as `rosterPath` in `hooks/mods/optin.js`.
    - That is how `safety:proof-guard`, `workflow:snapshot` and `workflow:public-mirror` find the repo a flip names.
- `lib/tree-hash.js`:
  - The hooks module reads the records through `hooks/mods/suite.js`, and takes a tree id through `node lib/tree-hash.js`, the index's with `-i` as its only flag, with no bash between.
  - The one home of the tree ids the records hold, CJS: `treeId(root, pkg)` and `indexTreeId(root)`, which `script-shell.js` and `prove.js` require, and beside them `copyIndex(root, dir)` and `writeTree(root, index)`, which `prove.js` requires.
  - `node tree-hash.js <root> [<pkg>]` prints the working tree's id, or a package's own.
    - It runs `git add -A` into a scratch index in a new temp folder, removed after.
    - That index is seeded from a copy of `<git dir>/index`, never `$GIT_INDEX_FILE`, its times kept, since git's racy check reads them: a file edited in the index's own second is re-hashed.
    - So untracked files count, and ignored ones never. Only changed files are re-hashed, and the real index is never touched.
    - Then `.workkit` is dropped from the scratch index (`git rm -r -f --cached`), and the `write-tree` taken.
    - So a write under `.workkit/` (a log, a marker, `settings.json`) never re-keys a record.
  - A package's id also drops each folder `excludedFor` in `lib/workspaces.js` answers: the members it neither holds, sits in nor depends on.
    - `.` or no `<pkg>` is the whole tree, and so is a workspace read that fails, said in its `workspaces:` line.
    - Which members it leaves out, so which code the id covers, is the id rule in `docs/hooks.md` § `safety:proof-guard`, its package id bullet.
  - `-i` is the real index's id the same way, from a scratch copy of it.
    - `copyIndex(root, dir)` is that copy alone, at `<dir>/index`, its path answered; it honours `$GIT_INDEX_FILE` in a commit hook, absolute or from the root.
    - `writeTree(root, index)` is the tree of that index less `.workkit`, the file rewritten. `prove.js` takes the copy's whole tree and the record's id through the two.
  - The id goes to stdout. A call it cannot answer exits 1 with nothing there: `tree-hash: a repo root is required`, `tree-hash: -i takes no other flag or package`.
- `lib/records.js`:
  - The records' rules in `hooks/mods/suite.js` bound to the disk, CJS, the way `lib/settings.js` binds the settings loader.
  - The suite record's first line is the `git write-tree` id of the tree its writer proved, less `.workkit/`.
    - Its second line is `ms=<n>`, the wall time in milliseconds of the run that wrote it (`suiteRecordText`). The gate holds it against `tests.budget`.
    - Every read matches the first line alone, so a record with no second line still proves its tree.
    - It lives in `~/.workkit/markers/claude-suite-marker/<sha1 of the repo root>` (`suiteRecordPath`, through `markerPath` in `hooks/mods/markers.js`).
    - `writeSuiteRecord(root, tree, ms)` writes it afresh; an empty tree is refused, nothing written.
  - The package record is its sibling: the packages a green `npm test` other than the bare root run proved.
    - It has its own file, `~/.workkit/markers/claude-package-marker/<sha1 of the repo root>` (`pkgRecordPath`), never the suite's.
    - It holds one line per package, `<id> <pkg>`: the package folder relative to the root (`.` for the root), after its own tree id hashed before the run.
    - `writePkgRecord(root, tree, pkg)` works under the record's lock, `<record>.lock`, taken by `takeLock` in `lib/lock.js` (the folder, then its `claim` create-only).
    - It keeps every line whose package is not `<pkg>` and appends `<tree> <pkg>` (`pkgRecordText`), moved onto the record from `<record>.tmp.<pid>`, so overlapping package runs each keep their line.
  - Each write sweeps the markers folder, removing every regular file one folder under it older than 7 days (`sweepMarkers` in `lib/lock.js`, `wk_sweep_markers`'s twin); a lock folder there is left alone.
    - The package record sweeps before its write; the suite record after it, through `writeMarker`.
  - `suiteHolds(root, tree)` and `pkgHolds(root, tree, pkg)` are the reads, through `suiteProved` and `pkgProved`; a record that cannot be read reads as no record.
  - The suite record is the engine-agnostic contract between whatever runs a repo's root suite and the gate.
    - It has two writers. `script-shell.js` is npm's adapter, recording the working tree a root run started on.
    - `prove.js` records the index's tree, proved in a copy.
    - Each writes the id it hashed BEFORE the run, and only when the tree hashed after the run is the same, so an edit made while it runs is never proved.
    - Neither writes a record for a run with `CI` set, the rule `docs/project-state.md` § The proof states.
    - Its readers are `safety:commit-gate`, through `suiteProved` in `hooks/mods/suite.js`, and the full-suite hold (`lib/hold.js`), through `suiteHolds`: the hold with the working tree's id, or the real index's for `workkit prove`.
  - `script-shell.js` is the package record's one writer; `safety:proof-guard` is its one reader, at the flip to `status:qa`, through `pkgProved` in `hooks/mods/suite.js`.
- `lib/proof-dir.js`:
  - `proofBase()` is `proof/` in the kit's cache folder (`cacheDirOf` in `hooks/mods/log.js`), `~/.cache/workkit/proof`, where every proof run folder lives.
    - `HOME` moves the cache folder; `WORKFLOW_HOME` does not, since on a machine where `~/.workkit` is a link into a repo a copy under it would sit inside that repo.
  - `proofDir()` makes a new run folder, `<proofBase>/<id>` with `<id>` six random characters, and answers it; null when none can be made.
    - `workkit prove`, `workkit proof red` and `workkit ship publish` (when the folder differs from HEAD) each make theirs through it, so `HOME` moves the copy and `TMPDIR` does not.
    - The copy's path stays short (43 bytes under a default macOS home) and has no crowded parent.
    - It first removes each run folder there last changed more than a day ago, since no system cleaner reaches the cache folder.
    - One holding `live` is left: a `--live` run that could not restore keeps the live files there.
    - One it cannot remove is left, and never fails the run; a removed copy's worktree entry is left for git's own prune.
  - `proofClaudeHome(dir)` makes the empty `<dir>/claude-home` that `workkit prove` hands its suite and `workkit proof red` its copy's command as `WORKFLOW_CLAUDE_HOME`, so nothing run in a copy reaches the machine's Claude home; null when it cannot be made.
- `lib/tree-copy.js`:
  - The Node home of a tree copy, CJS, which `lib/snapshot.js`, `prove.js`, `proof/place.js` and `ship/publish.js` share.
  - `copyTree(src, root, dest, only)` copies every entry of `src` but `.git`, or only the paths in `only` whose parent `dest` holds.
    - It leaves out each package's `node_modules` the live repo `root` holds (`heldModules`) and the kit's paths inside it; the list and the walk: `../docs/hooks.md` § Platforms.
    - Each platform's copy and its flags: `../docs/hooks.md` § Platforms.
  - `copyEntry(from, to)` copies one entry in Node: a folder walked, a file's mode and times kept, a link (a dangling one too) made again as a link and never followed, its type set, never guessed: a junction for a folder with an absolute target, else a folder link, else a file link. `proof/place.js` copies its paths through it too.
  - `fillCopy(src, root, dest, only)` is that copy, then each package's `node_modules` the live repo holds made a real folder wherever the copy holds its parent and lacks it.
    - Each live entry is linked in absolutely; a workspace link points at the same path inside the copy; a scope folder and `.bin` are filled one level down.
    - On Windows a folder's link is a junction, which needs no privilege.
  - `heldModules(root)` is each package's `node_modules` that exists: one beside a `package.json` git lists, tracked or untracked and not ignored, outside every `node_modules`.
  - `worktreeAdd(root, dest)` adds a detached worktree of HEAD with nothing checked out, tried three times a second apart against a racing add or prune.
  - `checkOut(copy, tree)` checks a tree or commit out into a worktree the add left empty (`read-tree`, then `checkout-index -a`); false when either fails, git's words on stderr.
  - `fillIgnored(root, dest)` fills the copy from the live repo with only the paths an ignore pattern matches there, through `fillCopy`, so an untracked or unstaged file stays out; none fills nothing.
    - It lists them with `status --ignored=matching`, never refreshing the index, and throws `could not list the gitignored files of <root>` when git cannot.
    - A failed fill throws `could not fill the copy's gitignored files from <root>`, the fill's own words its `cause`.
    - `prove.js` and `ship/publish.js` fill their copies through it.
  - `worktreeRemove(root, dest)` removes it, deleting the folder and pruning the list when git cannot; false when the prune fails too.
  - Each throws its step's own words, which its caller puts in its line.
- `lib/snapshot.js`:
  - The red-proof snapshot, CJS, as exports (`take`, `add`, `stale`, `drop`, and `workingPaths`, the working diff's list) and as the command `workflow:snapshot` runs: `node snapshot.js take <root> [issue]... | add <root> <issue>... | stale <root> [repo] | drop <root>`.
    - `workingPaths` has two callers beside the snapshot's own: `proof/red.js` and `review/covers.js`.
  - Its folder is `snapshotPath` in `hooks/mods/snapshot.js`, keyed by the root as git's top level spells it; what each mode does: `../docs/hooks.md` § `workflow:snapshot`.
  - Exit codes: the step's own; `stale` 0 stale, 1 live, 2 when `gh` cannot answer (`buildingList` in `hooks/mods/gh.js`); 64 with a `snapshot:` line for a usage fault; 129, 130 or 143 for a `take` ended by HUP, INT or TERM.
- `lib/workspaces.js`:
  - A library, CJS, with no command form: `lib/tree-hash.js` requires `excludedFor` for a package's id.
  - `membersOf(root)` is `[{ name, dir, deps }]`.
    - `dir` is relative to the root, from the root `package.json` `workspaces` expanded in one call of `lib/expand-workspaces.js`'s `expandWorkspaces`.
    - `deps` is the member names its `depNamesOf` reads across the dependency fields.
    - No `workspaces` field is `[]`.
  - `npm query .workspace` is never used: it answers `[]` until `npm install` has run.
  - `excludedFor(root, pkg)` is the `dir`s of the members outside `pkg`'s own id, the code it can see, sorted.
    - The rule: `docs/hooks.md` § `safety:proof-guard`, the package id bullet.
    - A `pkg` that is no member (a `functions/` folder) is read by its own `package.json`'s dependency fields.
    - `.` is `[]`.
  - Anything the plan refuses is `[]` and one stderr line, `workspaces: <plan.js's message>; <pkg> keyed to the whole tree`.
    - The plan refuses with `PlanError`: a pattern it does not expand, a `package.json` that does not parse.
- `lib/expand-workspaces.js`:
  - CJS, requiring nothing beyond Node, so workkit-core can ship it: its prepack copies it in as `expand-workspaces.cjs`, as it does `lib/run.js` and `lib/proc-state.js`.
  - `expandWorkspaces(root, workspaces, notes)` is the absolute member folders: a literal folder, or `dir/*`'s folders that hold a `package.json`.
    - A `dir/*` that matches nothing pushes a `publish-plan:` note onto `notes`.
    - Any other pattern, and a literal member with no `package.json`, throw `PlanError` with the plan's own line.
  - `ship/plan.js` and `lib/workspaces.js` load it, and workkit-core's runner reads a root's members through it (`docs/tests.md` § The kit's runner).
  - `patternShape(pattern)` is what one pattern means, `children` (`dir/*`), `folder` or `other`, and `workspacePatterns(value)` the patterns a `workspaces` value declares; `expandWorkspaces` and `safety:release-taken` (`hooks/mods/release-taken.js`) both read through them.
- `lib/hold.js`:
  - The full-suite hold, CJS, required in process by `script-shell.js` and `prove.js`, so neither starts a shell for it.
  - It is the rule of the spec's § The proof run where the root suite runs, never read off a command's text.
  - `suiteHold(root, readTree)` resolves true to run and false to refuse, the reason on stderr as `suite-hold:` lines.
    - `script-shell.js` asks it on the bare root run with `treeId` (the working tree).
    - `prove.js` asks it with `indexTreeId` (the real index).
    - `readTree` is called only once the run is judged, each before its CHANGELOG check and its detach.
    - So a refusal runs no suite and writes no record, and its caller exits 1.
    - On the script shell's path a root `pretest` has already run, since npm runs it first through `exec sh`.
  - A reader that answers no id, or throws, skips the proved-tree check with one stderr line, never a judgment of an empty tree:
    - `suite-hold: the tree could not be hashed, so the proved-tree check did not run; the building hold still judges`.
  - It judges only where `sessionJudges(env, settingsText)` (`hooks/mods/gate.js`, the twin of `wk_session_judges`) says a Claude session's checks rule:
    - `CLAUDECODE=1` (a Claude session; the owner's terminal is never judged);
    - `HOOK_DISABLE` is not `1`;
    - and `<root>/.workkit/settings.json` opts the repo in (`settingsOptedIn`).
    - Every other run goes on, with no `gh` call.
  - Both gates are read from the run's own environment, which whoever runs npm sets per command.
    - So `HOOK_DISABLE=1` there is a per-run escape the owner uses, never an agent.
  - Then, in order:
    - A tree the suite record already holds (`suiteHolds` in `lib/records.js`) refuses with `suite-hold: this tree is already proved:`.
      - It names the record's path (`suiteRecordPath`) and asks for the narrowest test.
    - A root whose `origin` names no repo (`repoSlug` in `hooks/mods/optin.js`, the twin of `wk_repo_slug`) runs, with no `gh` call.
    - One `gh issue list --state open --label status:building` from the root (`buildingList` in `hooks/mods/gh.js`, read by `issuesAt` in `hooks/mods/proof.js`) refuses when it lists any issue.
      - The line is `suite-hold: the full suite runs once, at the commit, after every item in the tree is parked and passed;`.
      - It names each issue as `#N (status:building)`.
      - It says that work has to finish (tests green, its `Proof:` comment, its own park), never a relabel, `HOOK_DISABLE` or a cleared `CLAUDECODE`.
      - It asks for the narrowest test.
    - A `gh` that is missing or cannot answer lets the run go, with one `suite-hold:` note on stderr.
  - The stage label alone holds a run, never `agent:claimed`, since an `agent:ok` item keeps that claim through the park.
  - Every run is judged by the root it runs in, which npm has already resolved.
    - A `cd`, `--prefix` or `-w` lands it in its own repo.
    - So a repo that never opted in is never judged.
  - Not held:
    - a run of the root script's text that skips npm (it writes no record either);
    - a machine whose npm is not wired to the wrapper (the commit gate refuses its code commits).
- `lib/body.js`:
  - `bodyEnd(prefix, cleanup)` sets a detached Node body's end, CJS.
    - After the call the process always prints `<prefix>: exit <code>` as its last line, `cleanup` run before it.
    - A HUP, INT or TERM ends nothing at once: the body ends as it would once its command has ended, with the first signal's code, 129, 130 or 143 (`signalCode` in `lib/detach.js`).
    - It answers an `AbortSignal` aborted at that signal, so a body starts no command after it.
  - `endTraps()` is those traps alone, `{ stop, code }`: `stop` aborted at the first signal, `code()` its code or null. `bodyEnd` and `script-shell.js`'s run under a supervisor set them through it.
- `lib/runs.js`:
  - A detached run, CJS. In process, `run(job, { launch, endRun })` takes `{ log, lock, root, argv }` and resolves `{ rc, held, code, look, int }`: the exit code, a live holder's pid with 3, the code the command recorded, a look, an interrupt. `supervise.js`, `prove.js`, `script-shell.js` and `ship/watch.js` call it so.
    - Its `rc`: the run's own code; 125 on a look; 130 on an interrupt; 3 with `held` set for a live holder; 1 when the lock or the run cannot be made.
  - `run` takes `<lock>` (`takeRunLock`), with the supervisor's pid written inside as `pid` (`writePid`).
    - The tag's pid is this Node process's own and the pid file's the supervisor's, each as Node reads it, so on Windows a Windows pid with no Git Bash translation.
    - Until the supervisor's pid is written, a HUP, INT or TERM retires the lock by its mark (`retireLock`), no pid in it yet, and ends the process 129, 130 or 143, so the next call takes it at once. An INT ends it only once `run` has handed its caller `int`.
    - It launches through `node detach.js` in a process of its own, passing `--root` on, so the run is checked, with `WK_RUN_LOCK` set to `<lock>` so the run's own command inherits it.
    - That launcher is gone once it printed the supervisor's pid, so the supervisor has no live parent: no end of a process tree by parent links (a tool cutting off the call, `taskkill /T`) reaches the run through this call.
    - A launch that fails (a bad `tests.check` is 2) retires the lock by its mark, prints `detach: could not start <cmd> (log <log>)` and answers the launcher's code.
    - Then it attaches (`attachRun`) from the log's first byte, whose answer is its own.
    - Once the pid is written, a HUP or TERM ends only this call: the run goes on to its done file, and the lock stands until a later call finds it over.
  - INT, a human's Ctrl-C on the call that started the run, ends the whole run and answers 130 with `int` true.
    - The tail stops; the end request is written and waited on (`askEnd`), so the supervisor ends the run's processes, a child in its own session included, and the log ends with its request line.
    - Once the done file holds a code, it leaves the record, so a second call attached to the run gets 143.
    - A run still going when the wait runs out is ended by process group (`endRun`).
    - Then it drops the lock, unless that end failed: the run still goes, so its lock stays.
  - Under a supervisor already (`WORKKIT_SUPERVISED=1`, which `detach.js` sets), `run` starts no second supervisor: it runs `<cmd>` in the foreground (`runForeground`), its code in `code`.
  - It also exports `endOnInt(lock, pid, { endRun })`; the launcher and the end of a run's processes are injectable, the real ones by default.
- `lib/run-paths.js`:
  - The repo's log folder is `logs.dir`, a path from the root, default `.workkit` (`logDirOf` in `hooks/mods/commit-gate.js`, so the gate's bounce names the same `suite.log`).
    - Each `.` and `..` in it is walked, so `./logs/` reads as `logs`, and `.` is the root itself; an empty value reads as `.workkit`.
    - An absolute value (`/`, `\` or a drive letter first), or one whose `..` leaves the repo, is `workkit: logs.dir must be a folder inside the repo, written from its root (got <value>)` on stderr, and 1.
    - Every caller of a log path stops on that line: a root or narrowed `npm test`, `workkit prove`, `supervise` and `watch` exit 1, `workkit ship watch` 4 (no answer).
  - `logPathOf(root, name, id)` is where a log of that name goes: `<root>/<log folder>/<name>` when git ignores it there, else `~/.workkit/markers/claude-<name>/<sha1 of the repo root>`.
    - Its place comes from `logPlaceOf(settings, name, id)` beside `logDirOf`, the rule with no read: the log's place from the root, and its marker folder. The gate's suite log and this file both go through it, each asking git whether the place is ignored.
    - An `<id>` keeps one of several runs apart: `.<id>` ends the name in both places. So a log never changes the tree hash.
    - The command log names its repo logs through it.
  - `runPaths(root, which, slot)` answers `{ log, lock }` for `which` of `suite`, `run`, `ci` or `test` (a `test` takes the slot's pid), keyed by the root as `git rev-parse --show-toplevel` prints it, the key `script-shell.js` uses.
    - The log is `suite.log`, `run.log`, `ci.log` or `test.log.<pid>`, placed by `logPathOf`; a bad `logs.dir` throws `LogsDirError`, its message the line that names the key.
    - The lock is the `claude-suite-lock`, `claude-run-lock`, `claude-ci-watch-lock` marker path, or `claude-test-lock`'s with `.<pid>` after it; `lockPathOf(root, which, slot)` answers it alone.
  - `testSlots(root)` is the pid of each narrowed run whose lock folder stands, live or not, through `slotsAt` in `lib/run-lock.js`, the one listing of a repo's slots.
  - `clearSlot(root, pid)` removes a slot's log and its lock's record, once a call has read its end.
    - `removeSlot({ log, lock })` is the same removal at paths `runPaths` already answered, done at once, so `script-shell.js` finishes it before a Ctrl-C's exit on the loop's next turn.
- `lib/attach.js`:
  - `attachRun(log, lock, pid, offset, { signal, view })` tails `<log>` to stdout from byte `<offset>` (0), so a later verb attaches to a run already going.
    - Its view is `viewOf()`, the painted or the plain view, made at the call unless one is given: `watch.js` writes the log's last lines through its own view first, so one painter paints both.
    - The log is plain text. When the kit's color gate says yes, each whole line is painted on its way to stdout by the painter, `packages/core/test/lib/paint.js` beside this engine, required in process with `FORCE_COLOR=1`; otherwise stdout gets the log's bytes.
      - The gate is `colorOn` in `lib/voice.js`, the kit's one color gate, on stdout: `WORKKIT_COLOR=0`, `NO_COLOR` or a dumb `TERM` is no, `WORKKIT_COLOR=1` stands in for a terminal.
      - A kit copy without the painter (the engine alone) is the plain view, and so is a call whose own Node is below the kit's floor (`WK_NODE_FLOOR`, read from `lib/platform.sh`), since the painter is an ES module. A painter that is there and fails to load throws.
      - A line split across reads waits for its end; what is left is painted when the call ends.
      - A painted view whose stdout is gone (its reader went away) ends the tail: `detach: the painted view of the run ended, so this call stops; the run goes on, and workkit watch follows it`, the lock kept for a watch, and 1.
      - A plain view whose reader went away goes on to the run's end: the code comes back and the lock drops.
    - It drops the lock and returns the code the command recorded.
    - That code is read once, from the done file, in the poll that first finds it.
    - A `look` file beside the done file, with no done file yet, is the supervisor asking for a look.
      - It prints the look's evidence, then `detach: the run goes on; read <log>, then run workkit watch to keep waiting or workkit watch --end to end it (exit 125)`.
      - With `WK_WATCH_NAME` set by the caller (a narrowed run's pid), both calls in that line carry it: `workkit watch <pid>`, `workkit watch --end <pid>`.
      - It removes the look file, keeps the lock, answers `look=1` and 125, with the run still going.
    - Before it drops the lock it leaves `<supervisor pid> <code>` in `<lock>.done` (`leaveRecord`), a file beside the lock folder, written whole and renamed.
      - Every call attached to one run writes the same line, and Windows refuses a rename onto a file in use.
      - So a write that fails is done once the record holds that line; otherwise it is tried again for two seconds, then its error is thrown.
    - A call that finds the lock or the done file gone, its supervisor's pid gone too, returns the code that record holds for its own pid (`recordedCode`).
      - First it reads the log again from where it left off, since the run may have ended after the poll's own read: so it shows the log's last lines.
      - So of two calls attached to one run, the one that finds the lock already dropped still gets the run's code, whatever the command printed.
      - No record, or another run's, is `detach: the run of supervisor <pid> ended without recording an exit code; its output is in <log>`, and 1.
    - A done file that holds no number is `detach: the done file held no exit code (<text>)`, the lock dropped, and 1.
    - The code it answers is empty whenever the runner itself failed (no lock, no start, no done file), so a caller can tell the command's own 1 from the runner's.
  - `runForeground(log, lock, argv)` is a run under a supervisor already: `<cmd>` runs here, its stdout and stderr each copied to stdout and to `<log>` as they arrive, and its code comes back once every holder of that output is gone.
    - `<cmd>` starts through `runHere`: a file with no `#!` line is started again by `sh -c`, which finds it as a shell does (on PATH for a bare name) and runs it as a script, as bash does, and a start that fails, thrown or as an `error`, is one `detach: <cmd>:` line in both places and 127 (not found) or 126 (found, cannot run), never a crash.
    - It holds `<lock>` for the command's length, unless `<lock>` is the enclosing run's own (`WK_RUN_LOCK`, the two paths compared resolved, and on Windows without regard to case). A lock another live run holds is 3, as ever.
    - A HUP, INT or TERM is the command's to answer: this process never ends before its command, and always writes the done file and the record and drops the lock.
    - Its lock holds a `foreground` file, the enclosing run's lock path, before the pid: no supervisor reads its end file. The pid is this Node process's.
    - Under the enclosing run's own lock it runs bare, on this process's own stdio: that run's log is already its stdout, so a doubly supervised run writes its log once.
    - When it took `<lock>` itself, at the end it writes the done file and the record, as a detached run ends, so a watch attached to `<lock>` gets the code.
    - Under the enclosing run's own lock it writes neither: that run's supervisor writes them.
    - So `workkit prove`, a narrowed `npm test` or a second `workkit supervise` inside a supervised run runs in that run, within the outer supervisor's reach.
- `lib/run-lock.js`:
  - The run lock, CJS, over `lib/lock.js`'s folder rules.
  - `takeRunLock(lock)` takes the lock through `claimDir(lock, tag)`, a tag of this process's own.
    - A folder that holds anything, or a lost claim, sends the taker to judge the lock that is there, through `retireJudged` with the run-over judge.
    - It answers `{ code: 0, mark }` holding the lock, `{ code: 3, held }` when a live run holds it, `{ code: 1 }` when it cannot be made.
    - It removes the record beside the lock when it takes the lock for a new run: the last run's record is no answer for the new one.
  - A lock a live run holds answers 3 with nothing run.
    - Since a command may return 3 itself, `held=` is answered, the holder's pid, only then.
  - A lock whose run is over is taken over: its done file written, its pid gone, or no pid once its taker is gone or its wait has run out.
    - A lock with no pid file is judged by its taker, the process that took it: the pid that is the first field of the tag its claim names (`tagPid`).
      - A taker that lives is waited for, up to `WK_LAUNCH_WAIT` seconds (60; a value that is not a finite number of 0 or more counts as unset, `nonNegativeOf` in `lib/bounded.js`), while the lock has no pid file. Once the pid file is there, the lock is judged by it, so a launch slower than five seconds keeps its lock and the second call answers 3.
      - Still no pid file when that wait runs out: the run is over, and the take takes the lock, as for a lock with no taker. A live taker only makes the take wait longer, never fail, so a launcher ended before its pid write whose pid another process now holds blocks nothing.
      - A taker that is gone: the run is over, and the lock is taken at once.
      - No taker to read (no claim, an empty claim, a `gone` or `id.orphan` mark): no pid five seconds after the take is over.
    - The taker reads the mark before it judges, and retires the lock by that mark (`retireLock`). So of two takers on one old judgment, the second finds its mark gone and judges again, and never removes the first one's new lock.
    - A lock holding a `gone.<tag>` mark is taken over so too, by that mark, once its remover is gone: a caller that ended between its rename and its removal leaves nothing stuck.
    - While that remover lives, the taker waits for that `gone` mark to go, up to five seconds, and that wait costs none of its tries. Whatever stands once the mark is gone (no folder, or a new lock another taker made meanwhile) is judged on the next pass, so an ordinary removal never makes a take fail, and a new live run still answers 3.
    - Only the same `gone` mark still there after the wait is `detach: could not take the lock <lock>`, 1.
    - A folder with no mark is adopted (`adoptLock`): an empty one, an older kit's lock, and files a `mkdir` that answered 0 left.
    - So a KILL before the supervisor's pid is written, which no handler sees, leaves a lock with no pid and a taker gone, which the next call takes at once.
    - With a done file, it waits up to two seconds for the directory to go, since its own foreground is collecting it.
  - The lock is dropped only by its owner (`dropRunLock(lock, pid)`, through `retireJudged`).
    - The normal end, the interrupt and the supervisor-gone path each read the mark, then retire the lock by it only while `<lock>/pid` still holds this run's pid.
    - The owner finds its own mark through `claim`; a folder with no mark that still holds its pid is adopted, never left behind.
    - So a run that took it over keeps it.
  - `writePid(lock, pid)` writes the pid whole through a rename, so a second run never reads a half-written one.
  - `runLive(lock)` is the supervisor's pid while `<lock>` holds a pid file, no done file, and that pid is alive; null otherwise. The take asks it whether a lock's run is going.
  - `runHeld(lock)` is the pid while `<lock>` holds a pid file and that pid is alive or its done file is written: a run whose answer no call has collected yet. `watch.js` chooses its run by it.
  - `pidAlive(pid)` (`lib/lock.js`'s): whether a pid answers a zero signal, any refusal read as gone; off Windows a process that ended and waits for its parent to collect it is not alive (`ended` in `lib/proc-state.js`, handed `lib/run.js`'s `spawnSync`).
    - An entry gone since the signal reads as ended; one that cannot be read, or a `ps` that prints no line, leaves the signal's answer.
  - `endRun(pid)`: a detached run's supervisor ended with what it started.
    - Elsewhere than Windows the supervisor leads its own group: INT so the body logs its own code, then TERM and KILL, each 1.5 seconds after the last while the group lives.
    - On Windows its process tree, through `endTreeOf` in `lib/tree.js`. A table reader (PowerShell or Git Bash's `ps`) that cannot start, runs past 60 seconds, exits nonzero or prints a table it cannot read, an unset `SystemRoot`, a refused signal (`could not signal <pids> (<message>)`), or a process left after the forced end is its one stderr line and a failed end.
  - `askEnd(lock, pid)` writes `<lock>/end`, the supervisor's end request, while `<lock>/pid` holds `<pid>` and `<pid>` is alive, then waits up to `WK_END_WAIT` seconds (30; a value that is not a finite number of 0 or more counts as unset, `nonNegativeOf` in `lib/bounded.js`).
    - While `<lock>/ending` stands, the supervisor's answer that it is ending the run (`lib/detach.js`), the wait has no end of its own: it goes on while `<pid>` lives, and answers as below.
      - An `ending` file that goes again (the end failed) puts the wait back on its `WK_END_WAIT` clock, counted from the request.
      - So 1 is a supervisor that never answered, or whose end failed: one that is ending its run is waited for, however long its end takes.
    - With another pid or none there it is 0 at once, nothing written; the lock is read before `<pid>`'s life is looked at.
    - With `<pid>` gone already it writes nothing and answers as for a supervisor gone during the wait (below), so the lock stays as it was.
    - It is 0 once the done file is written or `<lock>/pid` holds another pid or none, 1 when the wait runs out. It prints nothing.
    - A supervisor gone ends the wait at once. The lock is read once more first, the done file before the pid, since the run may have ended and its lock been dropped between the looks.
      - A done file there, or a lock that no longer holds `<pid>` (dropped, or taken by another run), is 0.
      - A lock that still holds `<pid>` with no done file is 2: the supervisor is gone and left no answer.
    - `watch.js`'s `--end` waits through it too.
  - `slotsAt(base)` is each slot whose lock folder `<base><slot>` stands, in name order, live or not.
  - `sweepSlots(base)` removes each of those whose run was cut off, through `retireJudged`: its done file over a day old (a run whose answer no call collected), or a `gone` mark at any age. A live remover's slot stays. It answers the slots it removed.
- `lib/lock.js`:
  - The lock folder's rules, CJS, the one home of the run lock's.
  - `claimDir(dir, tag)`: true only for the one caller that makes `<dir>` and then creates `<dir>/claim` create-only, since a `mkdir` may answer 0 to two racing callers.
    - With a tag, the run lock's form: a folder that holds anything is another caller's, false. In an empty one it writes `id.<tag>`, creates `claim` create-only holding `<tag>`, and writes `id.<tag>` once more, since a removal still running in that folder may have deleted it. A lost claim takes its own `id.<tag>` back, false.
  - A run lock folder holds two things for the lock's whole life: `claim`, holding the taker's tag, which decides who made the lock; and that taker's mark file, `id.<tag>`.
    - A tag is no other take's on the machine: the pid of the process that made it, a count of the tags it made, and a random part, dot-separated (`lockTag`). `tagPid(tag)` reads the pid back; a first field that is no number (`orphan`, `x`) is null.
  - `lockMark(dir)` is the lock's mark, in this order: the `id.<tag>` that `claim` names, when that file is there; else the `gone.<tag>` file (a removal under way); else `id.orphan` (an adopted folder); else null.
    - Any other `id.*` is the leftover of a taker that lost the claim: ignored, and gone with the folder.
  - `retireLock(dir, mark)` is the one removal of a run lock that holds files: it renames that exact `id.*` or `gone.*` mark to `gone.<its own tag>`. Only then it deletes the lock's other files, then `claim`, then its `gone` file, then the folder. `claim` is not a mark it takes. An empty folder holds no lock, and goes by `adoptLock`'s removal.
    - So a removal cut off mid-way leaves a folder that still holds its `gone` mark, or an empty one, never files with no mark.
    - A rename is atomic, so of two callers that name one mark, one wins. The other, its mark no longer there, gets false with the folder as it was, and judges the lock again from the start.
    - A `gone.<tag>` mark belongs to the removal that made it: `retireLock` answers false, the folder as it was, while the pid in its tag lives. A tag whose first field is no number (`gone.x`) counts as a remover that is gone. So two removals never run in one folder, and a slow remover never deletes files of a lock made after it.
  - `adoptLock(dir, seen)` takes a folder with no mark once its run is over, never removing it as it is. `<seen>` is the folder's file names as the caller read them with the absent mark, before it judged; with none given they are read at the call.
    - An empty folder (a taker that ended right after its `mkdir`) is removed, which fails once anything is in it.
    - A folder with files and no mark is an older kit's lock (`claim` empty or alone), or what a `mkdir` that answers 0 for a folder already there can leave. The caller creates `id.orphan` create-only and looks again.
    - When a mark other than `id.orphan` has appeared, or the folder holds anything but exactly `<seen>` and `id.orphan`, it removes its own `id.orphan`, false. A folder made in the old one's place always differs: a new taker's first file is its own `id.<tag>`.
    - Else it retires the lock by `id.orphan`, like any mark, also when another adopting caller made that file.
  - `retireJudged(dir, judge)` is the steps every remover shares: it reads the mark first (with none, the file names too), then asks `judge(dir)`, and on its `true` (the lock is over) retires the lock by that mark, or adopts it against those names. It is the one place that reads `<seen>`.
    - It answers `true` when the folder went, `false` when another caller was first. Any other answer of the judge means not over and comes back with nothing removed.
    - A `gone.<tag>` mark whose remover lives is answered `null` at once, the judge never asked and nothing touched.
    - The take's judge answers a live holder's pid; every other yes or no of `lib/lock.js` and `lib/run-lock.js` is a boolean.
    - So a caller acting on an old judgment never removes a lock made after it: that lock holds another mark.
    - The callers: the take's takeover and the owner's drop, a foreground run's too, and `sweepSlots`; a signal before the pid and a failed launch retire by the run's own mark.
  - `takeLock(dir)` and `dropLock(dir)` are the plain mutex: its parent made, then `claimDir(dir)` tried 50 times 100 ms apart, the caller going ahead either way; the claim dropped before the folder, so a taker that claims it between the two keeps it. The package record's write and the heal's state step take their locks so.
  - `stateLockPath(userDir)` is the state mutex's path, `<user dir>/.state.lock`: the one spelling the heal's state step, the home slug's write, the command's site writes and the Discussions cache take it by.
  - `sweepMarkers(home)` is `wk_sweep_markers`'s twin: every regular file one folder under the markers folder (`markersDir` in `hooks/mods/markers.js`) older than 7 days removed, a folder there never entered.
  - `writeMarker(file, home, text)` is the one writer of a marker and of the suite record: `<text>` at `<file>` (empty by default), its folder made first, then `sweepMarkers(home)`.
    - Its callers: `review/mark.js` and `triage/mark.js`, with no text, `checkpoint/mark.js`, with the time in milliseconds, and `lib/records.js`'s `writeSuiteRecord`, with the record's text.
- `lib/proc-state.js`:
  - A process's state, CJS, requiring nothing beyond Node, so workkit-core can ship it: its prepack copies it in as `proc-state.cjs`, and its `alive` and `groupLives` read through it.
  - `procStat(pid)` is the fields of `/proc/<pid>/stat` after the command name, `[state, ppid, pgrp, ...]`: null once the entry is gone, undefined when it cannot be read.
  - `ended(pid, spawnSync)` is whether `<pid>` has ended and waits for its parent to collect it. Never on Windows.
    - With `/proc`: an entry gone, or a state starting with `Z`. An entry that cannot be read is not ended, since it may be a living process.
    - Elsewhere (macOS) `ps -o stat= -p <pid>`, started through the caller's `spawnSync` from `lib/run.js` and ended after 60 seconds: ended only when `ps` ran and printed a state starting with `Z`.
- `lib/detach.js`:
  - `node detach.js <log> <done> [--root <root>] -- <cmd> [args...]`, which `lib/runs.js` runs as a process of its own.
  - `signalCode(signal)` is the one code a shell gives a command a signal ended (an unknown name throws).
    - `exitOf(code, signal)` is a child's end as that code: its exit code, else `signalCode` of its signal. Every Node file that waits on a child reads it.
    - `startFailed` (127) is the code of a child that never started, beside it: the supervisor's, the jobs', the installer's, the script shell's, `prove`'s, the CI watch's, the red proof's, `runHere`'s, `bounded`'s and the token mint's pty.
    - `notRunnable` (126) is the code of a command found that cannot run, which the red proof and `runHere` give apart from `startFailed`.
    - `codeOf(res)` is a `spawnSync` result read as that code: `startFailed` when it has no code and no signal, else `exitOf`. The jobs and the installer read a sync child's end through it.
  - `END_SIGNALS` are the three signals that end a run's caller (HUP, INT, TERM), and `INT_CODE` the code of an interrupted call.
  - The rule it runs (the checks, the verdicts, the evidence, the ends and every line they write): `../docs/tests.md` § The checks.
  - With `--root` the launcher first reads that root's `tests.check` (`checkMinutes` in `hooks/mods/settings.js`); a bad value exits 2 with nothing run.
  - The launcher truncates `<log>`, drops a stale `<done>`, and starts a supervisor copy of itself (`--supervise`, the minutes passed as `--check`) with `detached: true` and ignored stdio.
    - It prints its pid and exits 0. A bad argument list is 2.
  - The supervisor leads its own session (the Mac has no `setsid`), so the death of whatever started it changes nothing.
  - On macOS it starts `caffeinate -i -w <its own pid>` (`awakeCommand`). Other platforms start nothing.
  - It runs the command with stdout and stderr written to `<log>`, and `WORKKIT_SUPERVISED=1` set on it.
    - That mark is what a `test` event (`script-shell.js`) and `run` (`lib/runs.js`) read, through `isSupervised(env)`, so nothing under a supervisor detaches again.
    - The log is opened for writing, never append-only: a Git Bash child cannot write to the append-only handle Node makes on Windows.
    - The supervisor's own lines go through that same handle, at the command's offset.
  - Then it writes `<code>` to `<done>` through a temp file and a rename.
    - A command killed by a signal records 128 plus its number.
  - With `--root` it checks the run, each verdict from `judge` in `lib/pulse.js` (`FROZEN_CHECKS`, `LOOK_CHECKS`, `WORK_FLOOR`).
    - Each read of the processes is `treeOf` in `lib/tree.js`, `SAMPLE_MS` apart at most and `MIN_SAMPLES` to a check.
    - On Linux `treeOf` reads `/proc/<pid>/stat`, in hundredths; elsewhere `ps`.
  - A frozen run's tree is ended (`endTreeOf` in `lib/tree.js`), and `<done>` gets 124 (`FROZEN_CODE`).
  - A look is the evidence written whole to a `look` file beside `<done>`, for `attachRun` to print.
  - An `end` file beside `<done>` is read every second (`END_POLL_MS`) and ends the run's tree; `<done>` gets 143.
    - Without `--root` too, so every supervised run can be ended so.
  - Every end, on request or for a frozen run, first writes an `ending` file beside `<done>`: the answer `askEnd` waits on for as long as the supervisor lives.
  - An end that rejects with the command alive writes no `<done>`, removes the `end` and `ending` files, and leaves the end poll and the checks running.
  - On Windows `treeOf` is null, so nothing is checked; `endTreeOf` reads two process tables and ends each process of the tree it finds once, forced (`process.kill(<pid>, 'SIGKILL')`).
    - A read of both tables takes seconds there, so between reads it asks each signalled pid through `process.kill(<pid>, 0)` every `POLL_MS`, until all are gone or `GRACE_MS` has passed since the last signal, then reads again. It resolves when a read finds no member: a tree that goes at its signal costs two reads.
    - What bounds the whole end: two reads for a run that goes at its signal, `GRACE_MS` after the last signal for one that does not, each read given 60 seconds. `workkit watch --end` and Ctrl-C wait 30 seconds (`WK_END_WAIT`) for the supervisor's `ending` answer, then for as long as it lives, so this bound is theirs too.
    - The Windows table is one PowerShell call, run from `System32\WindowsPowerShell\v1.0` under `SystemRoot`, never through PATH, its script through `-EncodedCommand`.
      - The script is a WMI query (`[wmisearcher]`) on `Win32_Process` for `ProcessId`, `ParentProcessId` and `CreationDate` alone, its JSON array written by hand.
      - It uses no cmdlet: a cmdlet makes PowerShell load a module, which is slow under a home folder PowerShell has not seen.
    - Git Bash's table is `/usr/bin/ps -el` through `bash --noprofile --norc -c`. It keeps the parent link a Windows parent pid loses where one Git Bash program starts another.
    - A process is in the tree when it is the root, a Windows child of a member, or a Git Bash child of a member, the two tables joined on WINPID.
    - Windows hands a gone parent's pid out again, so a member is its pid and its creation time together: a Windows child counts only when created at or after its parent and before any later holder of that pid. A member found gone takes no new child after the read that first finds it gone.
    - A root the Windows table lacks is a tree already gone, and nothing is signalled. A process still alive 10 seconds (`GRACE_MS`) after the last signal rejects the end, naming it.
    - A reader that cannot start, runs past 60 seconds (`READ_MS`), exits nonzero or prints a table it cannot read rejects the end on one line naming the program. Of a nonzero exit's stderr, that line keeps the first line only.
    - A known limit there: a process a Git Bash member starts while a read is under way can be missed. Its Windows parent is already gone, and its Git Bash parent is ended before the next read, so the end resolves with that process alive.
- `lib/git.js`:
  - `repoRoot(cwd)` is the git top level of `cwd`, trimmed. It is null outside a repo, or for a folder that is not there.
  - `headSha(cwd)` is HEAD's full sha, or null outside a repo or before its first commit.
  - Their callers each keep their own reaction to null:
    - `public/lib.js` throws its `PublicError`;
    - `changelog/changelog-links.js` prints `changelog-links: not a git repository.` and exits 1;
    - `ship/cut.js` refuses the run on a null `repoRoot`, and its `runUrl` reads a null `headSha` as no run, naming the repo's Actions page;
    - `ship/deploy.js` refuses the run;
    - `ship/publish.js` reads its afterPublish hooks from its `--dir` itself on a null `repoRoot`, and refuses a folder that differs from HEAD on a null `headSha` (`publish-plan: could not make a copy of HEAD to publish from (the repo has no commit); nothing was published.`, exit 1);
    - `lib/io.js`'s `top` answers it as is;
    - `prove.js` stops with `prove: <root> has no commit to add a worktree of` on a null `headSha`;
    - `lib/snapshot.js` reads a null `headSha` as a repo with no commit: its take stops with `<root> has no HEAD commit`, and its working-diff list reads the staged list instead;
    - `review/covers.js` and `review/mark.js` stop with their `not inside a git repository` line, exit 2 and 1;
    - `triage/mark.js` keys its marker on the home folder instead.
  - `gitIn(root, args, options)` is `git -C <root> <args>` through `lib/run.js`'s `spawnSync`, its answer as `spawnSync` gives it.
    - Its defaults are `maxBuffer: GIT_MAX_BUFFER` and `windowsHide: true`; a caller's options win, and each passes its own stdio, encoding and env.
    - Its callers: `prove.js`, `lib/snapshot.js`, `lib/tree-copy.js`, `proof/red.js` and `proof/place.js`, for every git read of theirs but the two above; `ship/caller.js`'s status read; `ship/publish.js`'s status read (`changedCount`); `script-shell.js`'s status read; `.github/scripts/ci-release.js`'s workflows diff.
    - And the fetch and the path list of `.github/scripts/release-push.js`, and the two reads below.
    - And home's git calls (`home/*.js`) and the publish's (`publish.js`), but two that start git themselves: home's clone (`clone` in `home/repo.js`, `lib/run.js`'s `spawnSync` under the spinner) and the publish's waited calls (`gitWait`, through `waitFor` under the signal hold).
  - `hasCommit(root, rev)` is whether `rev` names a commit the repo holds (`git cat-file -e <rev>^{commit}`), false for any other answer.
    - Its callers: `.github/scripts/release-push.js` and `.github/scripts/ci-release.js`, for a push's `before`.
  - `textAt(root, rev, file)` is the text of `file` at `rev` (`git show <rev>:<file>`), or null when git cannot read it there.
    - Its callers: `ship/caller.js`'s `callerAtHead`, `review/covers.js`'s settings file at HEAD, `.github/scripts/release-push.js`'s two sides of a version file, `.github/scripts/ci-release.js`'s CHANGELOG at a commit, `home/committed.js`'s `file` for a tracked folder.
  - `localConfig(root, args)` is a local git config value in `root` (`git config --local <args>`), its trailing newlines dropped, or `''` when git has none.
    - Its callers: the heal's git hooks step (`standards/githooks.js`, `core.hooksPath` and the saved `workkit.hooksPath`) and the command's git hooks line (`workkit/setup.js`).
  - `commitIdentity()` is the `-c` pairs a kit commit runs under, so a machine with no git identity still commits: `user.name` is `GIT_AUTHOR_NAME`, else `workkit`, and `user.email` is `GIT_AUTHOR_EMAIL`, else `workkit@localhost`.
    - It is that fallback's one home; its callers: the publish commit (`publish.js`) and home's commit and push (`home/install.js`).
  - `GIT_MAX_BUFFER` is the most output one git read keeps, 64 MiB, ample for a repo's whole path list; `gitIn` and `ship/cut.js`'s `git log` read it.
  - `defaultBranch(root)` is the repo's default branch: GitHub's answer (`gh api repos/{owner}/{repo} --jq .default_branch`, run in `root`), else `origin/HEAD` less its `origin/`, else null, never a guess.
    - Its callers: the checks caller's rewrite (`changelog/job.js`), and the heal's checks and branch protection steps (`standards/checks.js`, `standards/labels.js`).
  - `hooks/register.js` keeps its own `gitTop`, since the hooks module spawns through `$.process.run`.
- `lib/say.js`:
  - `writeErr(text)` writes a text or Buffer to stderr whole, as it is.
    - It writes straight to the fd, so the text lands before the output of a child started after it.
    - It writes the whole text as bytes. On a full pipe that is not blocking, a write that answers `EAGAIN` waits 10 ms (`pause` in `lib/pause.js`) and goes on from the byte it reached, with no bound, as a blocking pipe has none; any other error throws.
    - Its callers: `sayAs`; `.github/scripts/ci-release.js` and `identity/rest.js`, which pass on gh's stderr; `.github/scripts/release-push.js`'s usage line; `lib/voice.js`'s lines; `standards/labels.js`'s public key error.
    - And the usage lines of `home.js` and `publish/build.js`, a failed step's tail (`publish.js`), the heal's lines (`home/install.js`) and the questions (`lib/flows.js`).
  - `writeOut(text)` is its stdout twin, the same whole write to fd 1; `lib/voice.js` prints a reporting line through it, and `home.js` a verb's value.
  - `drained(stream)` settles once everything written to the stream so far is handed on, so a line written straight to the fd next lands after it; its callers: the command's exit (`workkit.js`, stdout and then stderr), the red proof's last lines (`proof/red.js`) and the command log's secret marks (`lib/command-log.js`).
  - `sayAs(prefix)` is a writer of one `<prefix>: <text>` line on stderr, through `writeErr`.
    - A caller is a kit Node command, or a `lib/` file one requires, that prints its own `<prefix>:` lines on stderr.
  - `endOf(res)` is how a `spawnSync` child ended: `exited <code>`, `did not finish (<signal>)` or `could not be run, <error code>`.
    - It is the one phrasing of the ship's failure lines.
    - Its callers: `ship/hooks.js`, `ship/cut.js`, `ship/caller.js`, `ship/deploy.js`, `.github/scripts/ci-release.js`, and `plan.js`'s `npmEnd`, which puts `npm` before it.
  - `errLine(res, fallback)` is a failed child's first stderr line, else `fallback` (`endOf(res)` by default).
    - It is the why of a failure line.
    - Its callers: `ship/cut.js`'s gh view failure, `.github/scripts/ci-release.js`'s dispatch failure, `ship/publish.js`'s npm check, with `npmEnd` as its fallback.
  - `lastErrLine(res)` is its last-line twin: a child's last stderr line that is not empty, trimmed, else the empty string.
    - Its callers: `jobs/lib/task-scheduler.js` (the reason a refused `schtasks /create` ends its line on), `public/lib.js`'s `ghWrite` and `tower/api/server/writes.js`'s `detailOf`.
- `lib/read.js`:
  - `readOrNull(file)` is its text, or null when it cannot be read.
  - `readJsonOrNull(file)` is its parsed JSON, or null when it cannot be read or does not parse.
  - `present(p)` is whether anything is there, a dangling link included, the shell's `-e || -L`; `lib/tree-copy.js` and `proof/` read it, beside `isDir` in `lib/lock.js`.
  - `filesUnder(root, skipName)` is every plain file under `root` in name order, as `find -type f` lists them: a link is no file, a linked folder is never walked, and a name `skipName` answers true for is neither listed nor walked into.
    - A folder it cannot read, the root included, holds nothing: it never throws for one.
    - Its callers: home's seed and sync (`home/seed.js`), the export of a committed copy (`home/committed.js`) and the runner's sweep of `brief/` (`home/runner.js`).
  - Its callers each keep their own reaction to null:
    - `lib/settings.js` (the loader's read), `lib/io.js` (the io's `read`);
    - `identity/token.js` and `login.js`, `publish/site-repos.js`, `home/repo.js`, `lib/discussions.js`;
    - `review/covers.js`, and `.github/scripts/ci-node-version.js`, `ci-hooks.js` and `ci-test.js` (its `readJsonOrNull`);
    - and `tower/api/lib/repos.js`, `sessions.js`, `board.js` and `health.js`.
- `lib/settings.js`:
  - `settingsAt(root, user?)` is `loadSettings` in `hooks/mods/settings.js`, read through `readOrNull` in `lib/read.js`.
    - The files: the kit's `defaults/settings.json`, then `<user dir>/settings.json` or `user`, then `<root>/.workkit/settings.json`, none with a null root.
  - `faultsAt(root, user?)` is the `settingsFaults` of those same files (`identity/token.js`, `ship/hooks.js`).
    - That is one `{ file, key, line }` per layer or value the merge set aside.
  - `homeSlug(workflowHome)` is the `site.repo` a machine folder's merged settings name, null unless it is an `owner/name` string.
    - Its callers: `identity/token.js`, `public/lib.js`, `ship/hooks.js`, `publish/site-repos.js`, `home/options.js`, `tower/api/lib/repos.js` and `summaries.js`, `jobs/morning/brief/cc-news.js`, and the jobs' (`jobs/brief-dispatch.js`, `jobs/claude-nightly.js`, and `cloud-machine.js`, `brief-publish.js` and `marker.js` under `jobs/morning/`).
  - `siteOption(key, user)` is one `site.<key>` of the machine's merged settings as text: a string raw, any other value as JSON, `''` for null or none.
    - Its callers: the site options of `home/options.js` and the command's site step (`workkit/site.js`).
- `lib/write.js`:
  - `writeWhole(file, text, { mode })` writes through a temp file beside `file` and a rename, so a reader never sees it half-written.
    - A `mode` creates the temp file new at it, never wider even for a moment: the sign-in and the token cache write theirs at 0600.
    - Before the rename the temp file is set to exactly that `mode`, so the umask cannot narrow it, a failed set leaves the file as it was, and no caller sets it again.
  - `editJson(file, change, { create })` is a JSON file changed whole, the kit's one safe JSON edit.
    - The value is read through every link to its target and handed to `change`.
    - What `change` returns is written as two-space JSON and one newline, through `writeWhole` beside the target, the target's mode kept, so a link stays a link.
    - It answers true when written. A failure warns the shell's `settings:` line, leaves the file as it was and no temp file, and answers false.
    - With `create: true` a missing file starts as `{}`, and a failed edit takes it away again.
    - Its callers: the heal's state step (`standards/state.js`), for the opt-in, the decline, the roster and the version key's removal; the home slug's write (`home/options.js`), the `file:` specs' repoint (`home/repo.js`), the Discussions cache (`lib/discussions.js`), and the command's allow rules and site answers (`workkit/allow.js`, `workkit/site.js`).
  - `readJsonText(file)` is a JSON file's value as jq reads it: `{ value }`, null for a blank file, undefined when it cannot be read or does not parse.
    - `editJson` reads the old value through it, and the publish's preflight (`publish.js`) refuses a settings file it answers undefined for.
- `lib/voice.js`:
  - The kit's one voice ([Output](#output)), requiring only `lib/say.js`; the command, the heal, the jobs and the tower's logger build their lines from it.
  - `colorOn(stream)` is the one color gate: `WORKKIT_COLOR=0`, `NO_COLOR` or a dumb `TERM` is no, `WORKKIT_COLOR=1` stands in for a terminal, else the stream's `isTTY`.
    - `lib/attach.js` and `tower/api/lib/log.js` require it.
  - `ok`, `skip`, `info`, `warn` and `error(message)` print one line each, in the glyph, colors, `task:` split and indent of its level.
    - A reporting line goes to stdout, or to stderr under `WK_LOG_STDERR=1`; a warning and an error always to stderr. `skip` and `info` are silent under quiet.
  - `title(message)` and `section(message)` print a command's heading and a section's (an empty line first), in bold and bold cyan, and set the two-space indent for this process alone; `done(message)` is the closing line, `✨ <message>` in bold green. All three are silent under quiet.
    - `indent()` is the indent a line opens with: the one `title` or `section` set in this process, else `WK_LOG_INDENT`, else none. No program the process starts inherits the set one.
  - `plain(text)` is each line with its colors, its indent and its glyph taken off, so a relay re-says it under its own (the morning's runner step, the command's engine lines).
  - `ESCAPE` is the one pattern of a color escape, which `plain` takes off and `tower/start.js` strips before it judges a line. It is global, so it goes to `.replace`, never `.test`.
  - `warnLines(topic, text)`: each non-blank line warned, prefixed `<topic>: ` unless it opens with that already.
  - `wait(message)` prints `<indent>⏳ <message>...` once on stderr, nothing under quiet; the caller then runs its command. No frame, no cursor code.
  - `setQuiet(on)` is quiet for this process alone, read beside `QUIET=1` in the environment, and never in the environment of a program the process starts; `quiet()` is whether either holds.
    - Its callers: the publish's `--quiet` (`publish.js`), so the heal it starts prints what it prints for any caller, and `update --auto`.
  - `PALETTE`, `paint` and `said` are the escapes and a level's line before its indent, which the tower's logger prints through `console`.
  - Every variable is read at the call, never at load.
- `lib/spin.js`:
  - `spin(message, run, { line })` is the moving wait line ([Output](#output)): it calls `run()` and answers what it answers, a promise as a promise of the same value, and what it throws goes on.
  - `openDevice(device)` opens the terminal device a logged command names (`WK_COMMAND_TERMINAL`) for append, null for none or for a device that does not open.
  - `spinFd()` is the descriptor the frames draw on: `openDevice`'s on `WK_COMMAND_TERMINAL`, else 2. No other descriptor is read.
  - `framesOn(fd)` is the rule for frames: `WORKKIT_SPIN=1` always, `WORKKIT_SPIN=0` never, otherwise on a device `spinFd` opened, and on stderr only when it is a terminal.
  - `startFrames(fd, message, deadline)` is the drawer; `startSpinner(message, deadline)` opens, checks and starts it, and answers a stop that also closes an opened device, or null where no frames draw; a device it opened is closed too when the frames do not draw or cannot start. `poll` in `lib/flows.js` counts down through it.
- `lib/flows.js`:
  - `interactive(io)`, `askYes(prompt, fallback, io)`, `readLine(io)`, `enterToOpen(url, label, what, io)`, `opener({ platform, env })`, `openUrl(url, io)` and `poll(message, seconds, check, io)`: the questions a step asks at a terminal.
    - `interactive` is whether stdin is a terminal; `askYes` answers `true` or `false`, each question awaited.
    - `readLine` is one line read after whatever an earlier question left unread on the same stdin, trimmed; a last line with no newline is still the answer, and a closed stdin with nothing left is `''`.
    - `opener` is this machine's browser opener, `open` on macOS and `xdg-open` elsewhere, when it is on PATH, else null; `openUrl` and the token handover open through it.
  - `io` is `{ stdin, stderr }`, the process's own by default, so a case hands in a terminal of its own (`test/lib/io-streams.js`).
  - `poll`'s `check` may be async; its countdown draws through `startSpinner` (`lib/spin.js`), under the rule the frames follow.
  - Its callers: home's setup question (`home/wizard.js`), the categories' walkthrough (`home/services.js`), and the command's steps (`workkit/kit.js`, `install.js`, `site.js`, `secrets.js`, `token.js` and `identity.js`).
- `lib/platform.js`:
  - `nativePath(path, { platform })`, `inPluginCache(kitDir)` and `cloneOutranks(kitDir, linkedDir)`: the Node twins of `wk_native_path` (`lib/platform.sh`), and the plugin cache rule and the rule that a clone outranks it.
    - `inPluginCache` is whether a kit is the workkit plugin's copy in Claude's plugin cache: its manifest names `workkit`, and its physical path lies under the physical `<claude home>/plugins/cache/`.
    - `cloneOutranks` is that, and the folder a machine-wide link names a workkit clone (`isKitCheckout`), so a cached kit leaves the link as current. The engine's address, the git hooks step, the command's links, `doctor` and the job installer read them; the setup pester keeps its own read over the hooks module's io (`hooks/mods/standards.js`).
  - `nativePath` is the path unchanged off Windows. `platform` is the system it spells for, read once at load by default.
    - On Windows a path that starts with a drive letter, `:` and a separator, or with two separators, only has each `\` made `/`, with no program started, so a task's PATH without Git Bash still answers.
    - Any other path goes through `cygpath -m`; a failed `cygpath` throws, since an empty roster key is worse than none.
  - `claudeHome()` is the claude home's one Node reader, read at the call: `WORKFLOW_CLAUDE_HOME`, else `<HOME>/.claude` with `HOME` as the shell reads it, else `os.homedir()`.
    - `inPluginCache` and the heal's run object (`standards.js`) both call it.
  - `physicalDir(dir)` is a folder's physical path, or null when it is not one: the read `inPluginCache` makes of both folders, and the installer's of the home and the engine link (`jobs/install.js`).
  - `physicalPath(p)` is a path with its folder resolved through every link and its file name kept as written, null when the folder does not resolve.
    - So the kit's file reached through a linked folder is the kit's, and a link to the file itself, set in another folder, is not.
    - Its callers: the compare of npm's script shell setup and doctor make (`workkit/npm-shell.js`), and doctor's `gh` and `git` shim checks (`workkit/doctor-machine.js`).
- `lib/link.js`:
  - Requiring nothing beyond Node.
  - `link(target, address)` is the atomic link maker: a link made beside the address, then renamed onto it, so no other session sees a gap; true when the address now resolves to the target. It removes nothing, but on Windows, which renames nothing onto a folder link, a link there naming something else: it goes, then the rename is tried again.
  - `mvLink(from, to)` is a rename that replaces the name at `to`, never landing inside a folder a link there names.
  - `isLink(path)` is whether a path is a symlink, a dangling one included; `physical(path)` is its spelling through every link, or null.
- `lib/participation.js`:
  - `githooksKit(root, folder)` (the kit root, or null), `githooksSpelled(folder)` and `githooksKitlike(root, folder)`: rule for rule the `wk_githooks_*` of `lib/participation.sh`, which the heal's git hooks step asks.
  - `executable(file)` is whether a file is there and executable; the publish's switch step asks it of the clone's omega binary (`publish.js`).
- `lib/repo.js`:
  - `repoSlug(dir)` (`wk_repo_slug`: the origin's `owner/name`, or `''`), `isKitCheckout(dir)` (`wk_is_kit_checkout`) and `hasCorePackage(dir)`.
  - `hasCorePackage` is whether `<dir>/package.json` names `workkit-core` in its devDependencies, which the heal's test runner check asks.
    - It requires `isPlain` from `hooks/mods/settings.js` at the call, so the file loads with no `hooks/` beside it.
- `lib/discussions.js`:
  - `ready()`, `meta(slug, { refresh })`, `enable(slug)`, `CATEGORIES` and `BRIEF_CATEGORY` (`Brief`, one of the four).
    - `ready()` is `gh` on PATH. `meta` answers the cached or fetched meta as an object, or null with no `gh` or when the API could not answer; `enable` answers 0 turned on, 2 already on, 1 could not.
  - `resolveCategory(slug, name)` is the category a post lands in, `{ id, name, fellBack }`: a miss is refreshed once, then falls back to `General`, `Announcements`, then the repo's first category; null when the API could not answer or the repo has none.
  - `list(slug, category, since, limit)` is the posts in a category created at or after `since`, newest first, `{ title, createdAt, body }` each, or null; `create(slug, categoryId, title, bodyFile)` posts one, answering its URL, `''` for an answer with none, or null.
  - Each `gh` call goes through `spin` with its message and `{ line: false }`, and the cache is written through `editJson` under the state mutex.
  - Its callers: home's Discussions step (`home/services.js`), the summaries (`jobs/claude-nightly.js`), the brief's post (`jobs/morning/brief-publish.js`), and the `gh` check of the marker and the cloud brief (`jobs/morning/`).
- `lib/day.js`:
  - `today(now)` is the local calendar's date of `now` (this moment by default) as `date '+%Y-%m-%d'` prints it: the release heading (`ship/release.js`), the publish commit (`publish.js`), the jobs' log stamp (`jobs/lib/notes.js`), the tower's usage days (`tower/api/lib/telemetry/read.js`), and the summaries' and the brief's titled dates (`jobs/claude-nightly.js`, `jobs/morning/brief-publish.js`).
  - Its two-digit field is `pad` of `hooks/mods/log.js`, the one home of it; the jobs' log stamp (`jobs/lib/notes.js`) takes its time half from there too.
- `lib/interrupt.js`:
  - `holdSignals()` holds `END_SIGNALS` (`lib/detach.js`: HUP, INT and TERM) for the process and answers `{ run, interrupted, signalled, end }`.
    - `run(cmd, args, options)` starts a program in the background and answers as `spawnSync` answers; a signal caught meanwhile is handed on to it, and the run rejects with `Interrupted`.
    - `interrupted()` is the signal caught so far, or null, read after one turn of the event loop.
    - `signalled()` is a promise of the first signal caught, settled at once when one was caught already, for a caller that waits on it.
    - `end()` gives the signals back and raises the caught one again, so the process ends by it; on Windows, with no signal to end by, its code (`signalCode`) is the exit code, which the caller keeps.
  - `Interrupted` is the error a held run rejects with, its `signal` the one caught.
  - A sync child holds the thread, so a signal sent to the Node process alone lands once that child ends.
  - Its callers: the publish (`publish.js`), the build program (`publish/build.js`), the summaries (`jobs/claude-nightly.js`) and the morning (`jobs/morning.js`), whose scratch folder goes before the signal ends each, and the tower starter (`tower/start.js`), which waits on `signalled()` and never calls `end()`, so a signal ends it with 0.
- `lib/ports.js`:
  - `portPids(port, { platform })` is the ids of the processes listening on a TCP port, each once, as numbers; empty when the port is free or neither tool is there.
    - Off Windows it is `lsof -bti tcp:<port> -sTCP:LISTEN`, whose `-b` skips the stat of every mount a stalled network share blocks.
    - On Windows it is `netstat -ano`'s `LISTENING` TCP rows whose local address ends in `:<port>` on either stack, so `:18693` is not 8693. The platform is a seam, so that rule is held on every machine.
  - `endPid(pid, signal)` ends one of them through `process.kill`; on Windows the id is a Windows id and the end is forceful whatever the signal. A process already gone is passed over.
  - Its caller: the tower starter (`tower/start.js`), which takes its two ports back before it starts the halves.
- `lib/regex.js`:
  - `escapeRegex(text)` is the text with every regex metacharacter escaped: the escape `home/seed.js`, `ship/release.js` and `ship/triggers.js` build their patterns with.
  - A hook mod outside the load set of `hooks/register.js` may import it; one inside that set keeps its own copy, as `hooks/mods/test-reminder.js` does.
- `lib/scratch.js`:
  - `withScratch(run, prefix)` makes a folder under the temp folder (`prefix`, `workkit.` by default, before mkdtemp's tail), calls `run(scratch)` and hands back what it handed back.
    - The folder goes whatever `run` did, a throw included; an async `run`'s once its promise settles.
    - No folder made: null, and `run` is never called; each caller says its own line for that.
  - Its callers:
    - home's seed, runner, doctor and heal (`home/`, prefix `workkit-home.`), the index copy (`lib/tree-hash.js`), the publish (`publish.js`);
    - the morning (`jobs/morning.js`), the summaries (`jobs/claude-nightly.js`), the installer (`jobs/install.js`, and its Windows half `jobs/lib/task-scheduler.js`);
    - the command log (`lib/command-log.js`) and the command's schedule step (`workkit/schedule.js`).
- `lib/command-log.js`, the command's alone (`main.js` hands it a logged call):
  - `logName(argv)` is the name a call logs under, or null: `setup`, `update`, `doctor`, `publish`, `ship <verb>` for each ship verb of `COMMANDS` but `watch`, and `proof red`.
  - `logPath(kit, name, cwd)` is its file.
    - A machine command's is `<user folder>/logs/<name>.log`, `~/.workkit/logs/` (`userDirOf` in `hooks/mods/log.js`).
    - A repo command's is `logPathOf` (`lib/run-paths.js`) of the repo holding the folder the call was made in, its space a dash (`ship-plan.log`, `proof-red.log`); outside a repo it is null, and the command runs unlogged.
  - `runLogged(kit, name, argv, dispatch)` runs the command again as a child of the running Node, `workkit.js` with the same arguments, its stdin the call's own, and answers its code. `dispatch` is `main.js`'s own route, the unlogged run in the same process.
    - Its stdout and its stderr are pipes. Each chunk reaches the call's own stdout and stderr as it comes, byte for byte, and is appended to a raw file in a scratch folder (`withScratch`). A reader of the call's own that went away stops the passing on, never the log.
    - The child's variables: `WK_COMMAND_LOGGED` is the raw file's path; `WORKKIT_COLOR=1` where the call's stdout is a terminal, unless it is set already, so the color shows as it does without the log.
    - `WK_COMMAND_TERMINAL` is the terminal device's name where the call's stderr is a terminal: `/dev/tty` on a Mac and on Linux, `CONOUT$` on Windows (`terminalDevice(platform)`).
    - `WK_COMMAND_MARKS=1` says the logger reads a secret step's marks (below). The logger sets or removes these two itself, so neither is ever taken from the caller's own variables.
    - It sets no `FORCE_COLOR`, so a Node or Go tool the command runs (`npm` under `ship publish`, `gh`) sees a pipe and prints without its own color.
    - While the child runs, INT is held off: a Ctrl-C at the terminal ends the child, and the log is written; the code is then 130. HUP and TERM are passed on to the child, the log is written when it ends, and the logger exits 129 or 143 (`childEnd`, `lib/child-end.js`).
    - At the end `plainLog(raw)` is the raw file as a terminal leaves it: each line's text after its last carriage return, its color and title codes removed, a line of blanks empty, every line closed by a newline.
    - The line `workkit <name>: exit <code>` follows, and the file is written beside the log first, then moved onto it (`writeWhole`). So the next run replaces the last, and two runs at once never mix.
    - A log folder that cannot be made, or a raw file that cannot be written, is the one line `workkit: could not write <file>, so <name> runs without its log`, and the command runs unlogged in the same process, with its own code.
    - A log that cannot be moved into place is `workkit: could not write <file>`; the code is still the child's.
    - A bad `logs.dir` exits 1 on its line, the command not run.
  - A call made with `WK_COMMAND_LOGGED` set is never logged again (`main.js`), so a step of a logged run writes no file of its own, and a `workkit` call under a logged command is in the outer log.
  - The terminal steps (`ship cut`, `ship publish`, `ship deploy`) start a program handed the terminal, which may ask there: `npm publish`'s one-time password, the deploy script, the afterRelease, afterPublish and afterDeploy hooks.
    - Where the call's own stdout or stderr is a terminal, the logger starts that child with the terminal itself, no pipes, and its log holds the one line `workkit: <name> ran on the terminal and is not in this log` and the closing line.
    - Anywhere else (an agent's call, CI, a pipe) the run is logged whole.
  - `secretStep(kit, what, start)` is a step that shows a secret, kept out of the log wherever a log holds the call's streams, at a terminal or not, so no token or sign-in code reaches a file:
    - the token mint, `claude setup-token` under its pty (`workkit/secrets.js`);
    - the bot identity's sign-in, `identity/login.js` (`workkit/identity.js`).
    - Unlogged it runs as any step. Under a logged command its program runs on the terminal device as its stdout and stderr, and the log gets the one line `workkit: <what> ran on the terminal and is not in this log` in its place.
    - With no device (an agent's call, a cloud session) it runs on the call's own stdout and stderr. The command marks where the step begins and ends in each of its two streams; the logger passes those bytes on, keeps them out of the log, and removes the marks, a mark split across two chunks included. The log gets the same one line.
    - So `workkit setup --login` on a pipe still shows its one-time code, and `setup.log` holds no part of it.
    - Only with `WK_COMMAND_LOGGED` set and nothing reading the marks (`WK_COMMAND_MARKS` unset) is it skipped: `<what>: skipped; this command's output is not on a terminal`, its program not started.
    - The kit starts no `gh auth login`; it only names it.
    - The bot token client, `identity/token.js` in the `gh` shim, keeps the shim's streams: under a logged command its stderr is the log's pipe, so it offers no sign-in, and its line names `workkit setup --login`.
  - A spinner and the poll's countdown under a logged command draw on the terminal device `WK_COMMAND_TERMINAL` names (`spinFd` in `lib/spin.js`), so a spinner shows at the terminal and no frame enters the log.
    - With the variable unset, or a device that does not open, they draw on stderr, and only when stderr is a terminal, as an unlogged command does.
    - In Git Bash's own window a native Node sees no terminal at all, so no frames draw there; in cmd, PowerShell and Windows Terminal the device is `CONOUT$`.
- `lib/child-end.js`:
  - `childEnd(child, { reraise })` waits on a child as a shell waits on its foreground command, and answers `{ code, signal }`: its code (a signal's as 128 + its number), and the HUP or TERM this process caught.
    - While it waits, INT is held off (the terminal gave it to the child too), and HUP and TERM are passed on to the child.
    - A child that died by INT ends this process as by that INT, as bash does: its own INT handlers run, and with none it dies by the signal. `reraise: false`, the command log's own wait, answers that death as 130 instead, so the log is still written.
  - Its callers: `nodeRun` (`workkit/kit.js`), the command log, `workkit test`'s npm and the token mint's pty.
- `lib/bounded.js`:
  - `bounded(command, args, { bound, stdio, ...options })` runs one program to its end, stdin closed and both streams read by default, and answers `{ status, output, stdout, stderr, timedOut }`, `output` in the order the bytes came.
    - Past `bound` milliseconds its whole tree is ended (`endTreeOf`, `lib/tree.js`) and it answers 124, as `timeout` exits; a hang is a failure with no code of its own.
    - A failed start answers 127 (`startFailed`) with `<command>: <message>` in `output` and `stderr`.
    - A `bound` that is not a finite number above 0 throws a `TypeError` before anything starts.
  - `secondsOf(value, fallback)` is the rule a bound's variable is read by: a positive number of seconds, else the default, so a bound set wrongly (0, negative, junk, empty) is the default's.
    - Its readers: `WORKKIT_GH_TIMEOUT` (`kitOf` in `workkit/kit.js`, and the morning's marker read in `jobs/morning/marker.js`), `WORKKIT_JOB_TIMEOUT` (`jobTimeout` in `jobs/lib/machine.js`) and `WORKKIT_HOME_POLL_INTERVAL` (the categories poll in `home/services.js`, where 0 would check back to back).
  - `nonNegativeOf(value, fallback)` is the rule a wait's variable is read by: a finite number of 0 or more, else the default, so unset, blank or junk is the default's and 0 stays 0.
    - Its readers: `WORKKIT_PAGES_WAIT` (`kitOf` in `workkit/kit.js`), `WK_LAUNCH_WAIT` and `WK_END_WAIT` (`lib/run-lock.js`), `WORKKIT_CUT_RELEASE_TIMEOUT` and `WORKKIT_CUT_RELEASE_POLL` (`releaseWait` in `ship/cut.js`), and `WORKKIT_CI_WATCH_WAIT` (`ship/watch.js`, whose `WORKKIT_CI_WATCH_TRIES` is a whole number of 1 or more, else 6).
  - Its callers: the cloud brief's secrets listing (`workkit/secrets.js`), the bot identity's install lookup (`workkit/identity.js`), the token handover's reads (`workkit/token.js`), and the jobs' children through `bounded` of `jobs/lib/machine.js`, which adds the jobs' default bound.
- `public/`:
  - Each script calls `gh` by name, so the shim (and in the cloud `identity/rest.js`) answers it.
  - `intake.js`: each open public issue with no `status:` label becomes a private `status:inbox`, `type:idea` issue.
    - Its first body line is `Public: <url>`, the report quoted under it.
    - When a private issue, open or closed, already carries that line, it only finishes the public side.
    - The public issue gets the intake comment, if it lacks one, then `status:inbox`.
    - So a refused comment is retried on the next run.
  - `mirror.js` (`<N>...` or `--all`, every open linked issue): the public issue's `status:` label becomes the private one's.
    - Every other `status:` label is removed, with no comment.
  - `close.js` (`<version> <N>...`): one `gh issue close --comment`.
    - The comment is `Fixed in v<version>: <the issue's CHANGELOG entry>. Thanks for reporting it.`
    - One already closed is left alone.
  - `lib.js`: the key, the link line, the `gh` calls; `ship/items.js` makes its own through `runGh` and `ghJson`.
    - `runGh(args, { cwd, input })` runs `gh` by name, `input` its stdin when given; the heal's label and branch protection steps (`standards/labels.js`) call it too.
  - A repo with no `public` key does nothing.
  - A key that is no slug is one line on stderr, and the pairing off.
  - A failed issue is one warning line and exit 1; the rest still run ([`docs/project-state.md`](../docs/project-state.md) § Capture).
- `slug.js`:
  - `slugFromRemote(url)`: the same trims in the same order, and the same regex.
    - So the shell half and the Node half can never disagree about what a repo is called.
  - It is its own file because three callers want the answer and none of them owns it:
    - the tower's roster (`tower/api/lib/repos.js`, which requires it from here);
    - the morning brief's composer, through that;
    - and `changelog/changelog-links.js`, which puts a GitHub-only check in front of it because the links it builds are GitHub's.
  - Beside it, `splitRepo(repo)` splits `owner/name` into its two parts and throws on any other shape, for `identity/token.js`.
  - It requires nothing, so this folder stays self-contained.
- `user-dir.js`:
  - `userDir(home)` is the machine folder, `WORKFLOW_HOME` first.
    - The morning's summaries and upstream news read it so.
    - So do `identity/login.js` for the sign-in, and `identity/token.js` for the settings and the token cache.
  - `homeUserDir(home)` is `.workkit` under the home, with `WORKFLOW_HOME` never read.
    - The tower's roster and the site's slug list read it so.
    - That is why the cloud morning pins `WORKFLOW_HOME` to that folder.
  - `towerDir(dir)` is the tower clone, `tower/` in the machine folder (`userDir()` by default), its one spelling; the heal's state step, the tower's repo list and the capture command read it.
  - `WORKKIT_DIR` is the folder's name, `.workkit`, in a home and in every repo alike.
  - It requires nothing beyond Node.
- `identity/app.js`:
  - `CLIENT_ID`: the App's Client ID, a public value, the device flow's `client_id`.
  - `INSTALL_URL`: `https://github.com/apps/workkit-agent`, the App's page, the base `identity/install-page.js` builds the install page on.
  - The hosted token service's URL is the `identity.tokenUrl` setting, its default in `defaults/settings.json`.
  - Requires nothing.
- `identity/login.js`:
  - `signIn()` runs GitHub's device flow with the App's Client ID.
    - It asks `/login/device/code`, and prints the page and the code.
    - It polls `/login/oauth/access_token` at the server's interval, five seconds more on `slow_down`.
    - It reads the login from `GET /user`.
    - It writes `{ token, login }` to `loginFile()`, `~/.workkit/identity/login.json` (the folder 0700, the file 0600, through `writeWhole` of `lib/write.js`).
  - `readLogin` and `writeLogin` are the store.
    - `writeOwnerOnly(file, text)` is the owner-only write both the login and the token cache of `identity/token.js` go through: the folder 0700 (an existing one narrowed to it), then `writeWhole` at 0600.
  - `GITHUB_SERVER_URL` and `GITHUB_API_URL` override the two hosts.
    - `apiUrl()` is the second, which the install page reads too.
  - Run as `node login.js` it signs in.
    - `--open <opener>` also hands the verification page to that browser opener once, detached, before polling.
    - An opener that fails to start is one `could not open the browser` line on stderr, and the flow goes on.
  - `workkit setup --login` runs it.
    - So does the client, when a bookkeeping call at a keyboard finds no sign-in ([The bot identity](#the-bot-identity)).
- `identity/install-page.js`:
  - The install page is the page the client's not-installed refusal names.
  - `repoOwner(repo, { fetch, token })` is `{ login, id }` from one `GET /repos/<owner>/<repo>` at `apiUrl()`, or null when that read gives nothing.
    - That read follows an owner rename.
    - It is sent with the user's sign-in as the bearer, bounded at five seconds.
  - `ownerId(owner, { fetch })` is the id from the public `GET /users/<owner>`, sent with no bearer and bounded alike, or null.
    - It is the refusal's fallback, since the sign-in cannot see a private repo whose owner lacks the App.
  - `installPage(id)` is `INSTALL_URL` plus `/installations/new/permissions?suggested_target_id=<id>`.
    - No page without the id exists ([The bot identity](#the-bot-identity)).
- `identity/token.js`:
  - `tokenFor(repo)` returns the repo's App token: the cached one while it has more than five minutes left.
    - Else it asks the service for one, with the user's sign-in as the bearer, at `tokenUrlOf(settings)`.
    - That is `identity.tokenUrl` of the machine's merged settings (`settingsAt` in `lib/settings.js`), the kit's default the hosted service.
  - A failure is an `IdentityError` whose `code` is `not_signed_in`, `not_installed`, `no_write_access`, `service_refused` or `settings`.
    - `settings` is for a machine's settings file that is not a JSON object, or that holds an `identity` value that is no object (`faultsAt` in `lib/settings.js`).
    - Its message is that fault line and `; fix or remove it`, thrown before any request.
    - Injected `settings` are never checked.
  - Before the ask it reads the repo's canonical owner (`repoOwner`).
    - It asks once, under the canonical `<login>/<name>` when GitHub named it, else under the slug as sent.
    - The cache stays keyed by the slug as sent, so a cached token reads nothing.
  - Run as `node token.js <owner/repo>` it prints the token.
    - Or it exits 3 (not signed in), 4 (the App not installed on the repo) or 1 (anything else), with the message on stderr.
  - `--installation <owner/repo>` asks the same way and prints `installed` or `not installed`, the refusal on stderr.
  - `--probe <owner/repo>` prints the verdict alone, no install page, and makes no `ownerId` read.
  - `--status` prints `{ loginFile, signedIn, login, tokenUrl }`, the state setup and doctor report ([The bot identity](#the-bot-identity)).
- `identity/gh`:
  - It resolves the call's repo once (`repo_of`, `lib/slug.sh` sourced once).
  - Then it hands the call to `identity/gate.js` first, the owner's terminal calls included.
    - That is every call but `gh auth`, and one under `WORKKIT_IDENTITY_OFF=1`.
    - A `-` value of `--body-file`, `-F` or `--input`, or a field's `@-`, is pointed at one temp file holding stdin (removed on exit).
    - So the gate reads the body gh will send.
    - The gate's exit 1 is a bounce, its text already on stderr. The shim exits 1 before the real `gh` runs.
  - The gate's session half rules only where `wk_session_judges` (`lib/participation.sh`) holds for the cwd's git toplevel.
    - There the shim exports `WORKKIT_GATE_JUDGES=1` to it.
    - Everywhere else, outside a repo included, it leaves the variable unset, so only the leak scan runs.
  - The gate runs under the node `wk_node` (`lib/platform.sh`) picks.
    - With no node 22.22 or newer found, the shim says `gh: the workkit gate did not run (no node 22.22 or newer found)` on stderr and goes on.
  - Inside a Claude session, a bookkeeping call runs the real `gh` with the App's token in `GH_TOKEN` for that one process, or not at all.
    - That holds for a call on a rostered repo.
    - It holds too for one on the public repo an enabled rostered one names as its `public`.
    - That match is `names_public`, the one `wk_roster_path` runs over each roster repo's committed settings.
  - Everything else runs the real `gh` untouched.
  - It keeps no copy of the credential rules: it relays the client's exit code and message.
  - In a cloud session the kit's issue, label, auth, pr and release verbs go to `identity/rest.js` instead.
    - No token is fetched there ([The bot identity](#the-bot-identity)).
  - With `CLAUDECODE=1` every one of those last steps (the owner's `gh`, the bot's, `rest.js`) runs as a child, rather than in place of the shim.
    - On exit 0, when the gate printed a journal line, the shim appends it to the gh journal.
    - The journal is `wk_marker_path claude-gh-journal <root>`, with `<root>` the cwd's git toplevel, else the cwd.
    - `journalPath` in `hooks/mods/markers.js` is its Node twin.
    - It appends the line, then sweeps the markers (`wk_sweep_markers`), and then exits with the child's code.
    - A journal that cannot take the line is one stderr line, never a failed call.
  - Without `CLAUDECODE=1` the last step is an `exec`, except when a stdin temp file waits to be removed.
- `identity/gate.js`:
  - `classify(argv, repo)` reads the call from its argv:
    - the verb, and the subcommand by `subAt`;
    - the repo;
    - the issue and pull request numbers among the positionals, an issue URL's included;
    - the `--add-label`/`--label` and `--remove-label` values, the title, the body files;
    - an `api` call's method and endpoint.
  - `subAt` is the rule's one Node home, which `rest.js` calls too. Its bash twin is `bot_verb` in the shim.
  - It gives one step `{ sub, number, add, remove }` per number the call names.
    - An `issue create` is one step carrying `title`.
  - It gives the call's kind.
    - A write is `issue`, `pr` or `label` with a subcommand outside `list`, `view`, `status`, `checks`, `diff`, `checkout`, and no `-h`/`--help`.
    - Or a write is an `api` call whose method is not GET or HEAD.
    - The method is `-X`/`--method`, else POST when it sends a field or `--input`, else GET.
    - A `graphql` call is a write only when a field carries `mutation`.
  - An `api` write to `repos/<o>/<n>/issues/<N>` or its `labels` reads its `-f`/`-F`/`--field`/`--raw-field` values:
    - `state=closed` is a `close` step. With `state_reason` `not_planned` or `duplicate`, it is one that builds nothing.
    - `labels[]=`/`labels=` is an `edit` step adding them.
    - A DELETE of `labels/<name>` is an `edit` removing it.
    - The endpoint's own `<o>/<n>` is the repo.
  - `main` runs the leak scan on every call.
    - The scan is `leakVerdict` in `hooks/mods/issue-guard.js`, over the argv joined by newlines and every body file's text, with `leakFacts` for the cwd.
    - The one call it skips is one whose whole job is sending a value to GitHub's encrypted store (`sendsToStore`).
    - That is the `secret` and `variable` verbs, and an `api` write to an Actions secret or variable endpoint.
  - With `WORKKIT_GATE_JUDGES=1` (the shim's `wk_session_judges` answer) it runs the gates on an issue's steps too:
    - a close (not `--reason "not planned"`, not `--duplicate-of`), or a flip adding `status:qa` or `status:complete`, through `proofVerdict` (`proof-guard.js`);
    - a flip adding `status:specced` through `specVerdict` (`spec-guard.js`);
    - an `issue create` with a title through `findingsVerdict` (`findings-guard.js`);
    - each with its facts from `lib/io.js`, whose run starts a child named `node` under the gate's own Node (`process.execPath`), so the tree id needs no node on PATH.
  - The repo is `WORKKIT_GATE_REPO`, the one the shim resolved, so no `--repo` is ever unreadable.
  - Every `gh` read runs `WORKKIT_REAL_GH`: the real gh the shim found, in git's spelling of its path.
    - That spelling is `wk_native_path`, the one Node starts on Windows.
    - In a cloud session (`isCloud` in `lib/cloud.js`) an `issue`, `label`, `pr` or `release` read goes through `rest.js` over it, as the shim hands those verbs.
  - A block goes to stderr and exits 1.
  - On a pass a notice goes to stderr, a line each verdict, as `githooks/judge.js` does, and it exits 0.
  - A write prints the journal line on stdout (`journalLine`):
    - `<epoch ms>\t<verb>\t<sub>\t<owner/name>\t<numbers>\t<labels added>\t<labels removed>\t<cwd>`;
    - the lists comma-joined, a tab or line break inside a field a space;
    - an `api` write's subcommand is the `close` or `edit` it makes, else its method lowercased.
  - A failure before a verdict is one stderr line and exit 1, so the call does not run.
- `identity/rest.js`:
  - `run(argv, { gh, repo })` serves the kit's issue, label and auth verbs.
    - Through `verbs()` it serves the pr and release ones of the two files below.
    - It serves them as `gh api` calls through the real `gh` (its path in `WORKKIT_REAL_GH`, the repo in `GH_REPO`, both from the shim).
    - It prints gh's own output, and returns the exit code.
    - A failed `gh api` call's output and code are relayed as they came.
  - A call no verb names, or one asking `-h`/`--help`, runs the real `gh` as it came.
  - It exports the helpers the two files share: `api`, `getJson`, `send`, `parse`, `repoOf`, `fieldsOf`, `pick`, `printJson` and the rest, with `GhFailure` and `UsageError`.
    - They are set before its main run, so they are whole when `verbs()` requires the files at the call.
  - The verbs, fields and flags it serves are [`docs/cloud.md`](../docs/cloud.md) § gh in a session.
- `identity/rest-pr.js`:
  - A table in `rest.js`'s verb shape, built on its helpers, since the cloud proxy refuses the GraphQL the real `gh pr` speaks.
  - A PR is named by number, `#N`, URL or branch.
    - When none is named it is the current branch's open PR (`git rev-parse --abbrev-ref HEAD`), a detached HEAD refused.
  - `pr checks` reads the head sha's check runs and commit statuses, with gh's buckets and exit codes (1 a failure, 8 a pending one).
    - `--watch` reads again every `--interval` seconds.
  - `pr merge` is one PUT with the one method asked.
    - `--delete-branch` then DELETEs the head ref of a same-repo PR. A fork's is left, as gh leaves it.
    - A refused delete leaves the merge standing, with exit 0 and no local branch touched.
    - It prints `gh: merged #<n>; branch <name> left, this cloud session cannot delete branches` on stderr.
- `identity/rest-release.js`:
  - `release view` reads the tag's release or the latest. A 404 is gh's `release not found`.
  - `release create` is refused before any call, exit 1, since the proxy refuses every release write.
    - The line: `gh: a cloud session cannot create a release (the proxy refuses release writes); CI's release job makes it when the release commit reaches the default branch`.
- `home.js`:
  - `node home.js <verb> [argument]`, each verb with its code:
    - `setup [force]`: 0, or 1 for a forced run that stopped; `doctor` and `runner-doctor`: the count of lines that need attention;
    - `slug`, `host`: the value on stdout, an empty line for none, 0; `set-slug <slug>`: 0, or 1 for a failed write;
    - `state`: one word, `unset`, `absent`, `clone` or `other`; `ready`: 0 only for `clone`;
    - `catch-up <prefix>`: 0 or 1; `seed-runner`: 0 changed, 2 current, 1 nothing written; `commit-push <subject>`: 0 or 1.
  - Any other argument is the usage line and 64.
  - Its stages: the login, the private repo, the clone into `~/.workkit/tower`, seeding the tower project into an empty one, its install, Discussions, Pages, the clone's own heal, the doctor lines.
  - The readers of the site options every caller shares live in `home/options.js`:
    - `slug()` for the repo (`homeSlug` of `lib/settings.js`);
    - `siteHost()` for the custom domain, with its scheme and any trailing slash off;
    - `siteSidebar()` for the sidebar groups `publish/build.js` merges.
  - The publish reads `siteHost()` for the CNAME and the path prefix, and `setup`'s token handover reads it through `node home.js host` (`homeValue` in `workkit/secrets.js`) for the published site's URL.
- `home/`:
  - CJS, each required by `home.js`, by its neighbours or by the publish, and none run by itself.
  - `options.js`: the constants (`PAGES_BRANCH`, the seed's source `towerApp()`, the kit `kitDir()`, the machine's `settingsFile()`, which `publish.js` reads too), the site options and the clone's state.
  - `repo.js`: the repo's one name (`HOME_REPO_NAME`, `workkit`), the login, the repo, the clone, the manifest transform.
  - `stamp.js`: the version stamp (`STAMP`, `.workkit-version`) and the downgrade check.
  - `committed.js`: the reads of a folder's committed copy, with `git` alone: `tracked` (whether a repo tracks it), `exportOf` (the folder to read: HEAD's copy exported into a scratch folder, the folder itself where no repo tracks it, `''` for a failed export), `source` (`exportOf` with a failure warned, `could not export the committed files`) and `file` (one file's text by the same rule).
    - The seed, the runner, the doctor, the heal, the stamp and the build all read through it.
    - `exportOf` catches a failed `git` alone; any other error is thrown.
  - `seed.js`: the project's seed and sync, both reading the app's committed files through `committed.js`.
    - `manifestsOf(home)` lists the root `package.json` and each target's, a dot-named folder skipped: the seed's repoint and the publish's install check.
    - Its lists: `TOWER_APP_EXCLUDE`, `TOWER_APP_KEEP` and `TOWER_APP_RETIRED`.
  - `runner.js`: the cloud brief's runner; `runner-files.js`: its list, `[source, destination]` pairs.
  - `install.js`: the install, the catch-up, the commit and push, the clone's heal.
  - `services.js`: Discussions and Pages.
  - `wizard.js`: the home half of `setup`.
  - `doctor.js`: the doctor lines.
  - A function that printed a value hands it back as a string, one with two codes a boolean, one with more the number.
    - The sync hands back `{ code, manifests }` and the category check the missing names, so each second answer comes back with its call.
- `publish.sh`:
  - The starter: it finds a node at the kit's floor through `run_at_floor` (`lib/platform.sh`) and hands `publish.js` every argument.
  - The suites and the publish's failure line name it by path; the `workkit` command and the morning job start `publish.js` itself, each under its own Node.
- `publish.js`:
  - `node publish.js [--quiet]`: 0, or 1 for a failed source push, install, mint or build.
  - `--quiet` is `setQuiet` of `lib/voice.js`, for this process alone; a `QUIET=1` already in the environment keeps the run quiet too.
  - It calls home's functions in its own process: the catch-up, the heal, the sync, the commit and push.
  - It heals the home repo (its labels and issue forms), and refreshes the roster on its default branch. Both run above the switch.
  - Then it builds the tower project in `~/.workkit/tower`, and pushes the output to the home repo's `gh-pages` branch.
    - The build and the push run only when `site.publish` says so.
    - A switch turned off takes the published site down.
  - The build is handed the path the site serves under, as `OMEGA_PATH_PREFIX` (the contract with omega#355).
    - It is `/` when `site.url` names a custom domain.
    - It is `/<name>/` from the slug otherwise, since a project site is not served at a root.
  - That covers the URLs the build EMITS. The ones the dashboard assembles at runtime are the app's own.
    - The app reads the same value back off the `data-omega-path-prefix` stamp the build leaves on the page (`tower/app/…/libs/tower/scope.js`).
    - So they land under the prefix too.
  - One file: the steps, and the flow that calls them.
    - The first step is the preflight: the settings file and the home clone, each a named skip.
    - The steps are functions in run order (`STEPS`), each handed the one run object, so every value a step sets is there for the steps after it.
    - A step that hands back a code ends the run with it; the worktree goes however the run ends.
  - An end signal (INT, TERM or HUP) does not cut the cleanup short: it is held (`holdSignals`, `lib/interrupt.js`).
    - The run stops at the step in hand; a wait under way (a git call, `build.js`) is handed the signal and stops there.
    - Then the cleanup runs: the temp worktree is removed and unregistered (`git worktree prune`), so a later publish never finds it still registered.
    - The cleanup is the publish's own three git calls: `worktreeRemove` of `lib/tree-copy.js` would load the hook layer, which a publish has no other use for.
    - Then the process ends by that same signal, on Windows by its code.
    - A signal sent to the Node process alone first waits for a sync child in hand to end: home's catch-up, commit and push, or heal.
- `publish/build.js`:
  - `node build.js <install|mint|build> <project dir> [path prefix]`.
  - `install` runs `npm install` inside the project.
  - `mint` runs the project's `omega manage --service=assets` at its brand root.
    - It fails when no `.omega/assets/logo` is left behind.
  - `build` first merges `site.sidebar` into a clone's sidebar, never on this checkout's own `tower/app`.
    - The merge is Node code (`spliceSidebar`): the rows land before the closing `]` of the app's links list, the file's comments kept.
    - Then it runs `npm --prefix <dir>/targets/web run build` with `OMEGA_PATH_PREFIX` set.
    - It fails when no `dist` is left behind.
  - The merged sidebar exists only for the build.
    - When the build ends, on success or failure alike, the app's copy is put back.
    - So the clone matches the app, and the next sync and mint see no change.
    - An end signal (INT, TERM or HUP) to the program is held (`holdSignals`, `lib/interrupt.js`): the step in hand ends, the app's copy is put back, then the program ends by that same signal (on Windows, by its code).
    - A signal sent to the Node process alone first waits for the npm or omega child in hand to end.
  - Its codes: 0; a failed program's own exit code, handed through; 1 for a program it cannot start, no logo or no `dist`; 2 for a usage error, whose line reads `usage: build.js <install|mint|build> <project dir> [path prefix]; <what was wrong>`.
    - A program it cannot start is named on stderr first, `build: could not start <program>`, so the tail a publish prints after a failure is never empty; a caller that silences the program silences this line too.
  - Every path it prints, in its own lines and in its sidebar warnings, goes through `nativePath` (`lib/platform.js`).
  - It exports `install(dir)`, `mint(dir)` and `build(dir, prefix)`, each handing back the code.
    - `publish.js` runs it as a program for the home clone, its output in the step's log, and setup's install (`home/install.js`) calls its `install` there too.
    - `.github/workflows/pages.yml` runs `node workflow/publish/build.js` for this checkout's `tower/app`.
- `publish/site-repos.js`:
  - One `owner/name` list per machine, under `machines`.
    - This machine's comes from the same roster the tower reads, keyed by the first label of the machine's hostname, lowercased.
  - Their union as `repos`, plus the home repo under `home`.
  - It is written to the home repo's default branch, never beside the public pages.
  - A roster it cannot read raises, rather than writing the empty list a machine with nothing registered would.
- `script-shell.sh`:
  - npm runs every script as `script-shell.sh -c "<script>"`. The setup step that names it is below.
  - Any script but the `test` event and the install-time ones is a plain `exec sh`, first and before anything is sourced.
  - A `prepare`, `install` or `postinstall` event runs its script with `sh` and keeps its exit code.
    - Then it re-points the git hooks (`install_repoint`), and exits with that code.
    - So a script that set `core.hooksPath` itself (husky's `prepare`), or failed, still leaves ours set.
    - The re-point runs in a repo that opted in (`wk_opted_in`), whoever runs npm.
    - It asks `git_hooks_installed` (`lib/participation.sh`) first, so hooks already set start no node, and runs `standards.sh --git-hooks <root>` when that fails.
    - It runs that mode with `WK_LOG_STDERR=1` and no indent, so its one line, on stderr and flush left, is its only output.
  - A `test` event is `script-shell.js`, started with npm's own arguments through `run_at_floor` (`lib/platform.sh`).
    - With no node at the floor it prints `script-shell: no node at or above 22.22 is installed` and exits 1, before the script runs.
  - On Windows npm starts `script-shell.exe` instead, which hands the same call to this file under Git Bash.
- `script-shell.js`:
  - npm's `test` event, as `script-shell.js -c "<script>"`; its detached bodies are this file again, `--suite-body <root> -c "<script>"` and `--test-body <root> <pkg> -c "<script>"`.
  - A run outside a git repo, with no `npm_package_json`, or of a package outside the root runs the script plain with `sh`, its code back and no record.
    - A HUP, INT or TERM to the call is passed on to that script.
  - A `test` event runs as the root suite only when two things hold:
    - it is bare;
    - the package npm is running (`npm_package_json`) sits at the git root of the run's folder.
  - npm hands a narrowed run (`npm test -- <file>`) its script text with the arguments appended.
    - So only the bare `npm_lifecycle_script` is the whole suite.
  - Every other `test` event is a package run.
    - That is a narrowed run anywhere, or a nested package's or workspace member's (`-w`) bare run.
    - It runs detached under the supervisor through `run` (`lib/runs.js`) in process, as this file again with `--test-body <root> <pkg>`, passed `--root <root>`.
    - Its slot is its own, named by this call's pid, the Node process's own on every platform (`runPaths(root, 'test', pid)` in `lib/run-paths.js`), so several run at once in one repo.
    - Once its own slot's paths are read (a bad `logs.dir` prints its line and exits 1 before this), every narrowed run removes the repo's slots left behind: each lock `sweepSlots` (`lib/run-lock.js`) retires, then its log and record (`clearSlot`).
      - Which slots those are: `sweepSlots`, the `lib/run-lock.js` entry.
    - Its stdout and stderr both reach the call on stdout, tailed from the log, and its stdin is closed. The last line is `script-shell: exit <code>`, and the call exits with the script's own code.
    - The slot's log and lock go once the call reads the end, and when Ctrl-C ends the run (exit 130), unless that end failed: then the lock stays, and the log with it.
    - A look (exit 125) leaves them, and its line names the call's pid (`WK_WATCH_NAME`): `workkit watch <pid>` follows it again.
    - Under a supervisor already (`WORKKIT_SUPERVISED=1`), the package run runs here in the foreground instead, never detached again.
      - A HUP, INT or TERM to it ends nothing at once: once the script has ended the call exits 129, 130 or 143, with no record.
    - It hashes the package's own id, the code it can see, as `treeId(root, pkg)` (`lib/tree-hash.js`).
    - The rule: `docs/hooks.md` § `safety:proof-guard`, the package id bullet.
    - `<pkg>` is the package's folder relative to the root, `.` for the root and its whole tree.
    - It runs the script with `sh`, and on exit 0 hashes the same id again.
    - An unchanged id writes the package's line `<id> <pkg>` to the package record (`writePkgRecord` in `lib/records.js`).
    - A changed one writes nothing, said in one `script-shell:` line.
    - With `CI` set, or under the runner's `--filter=<text>`, a green run writes nothing and exits 0 (`docs/project-state.md` § The proof), on its one line:
      - `script-shell: the run passed, but CI is set, so no record was written; run it again without CI`;
      - `script-shell: the run passed, but --filter left cases out, so no record was written`.
    - The `--filter` flag is read only in what npm appended after the package's own script text (`npm_lifecycle_script`), bare or quoted, so a script's own `--filter=` for another tool still records. Its line comes before the `CI` line.
    - So a narrowed root run records `.` on the whole tree, and a `-w` or nested run records the member on its own id.
    - A package run skips the hold and the CHANGELOG lint. Both belong to the bare root run only.
  - That run is first judged by the full-suite hold with the working tree's id: the `lib/hold.js` entry.
  - Then it takes the commit gate's cheap check.
    - Every tracked `CHANGELOG.md` (`isChangelog`) that `git status --porcelain -z` shows modified goes through the linter (`linterPath` in `hooks/mods/changelog-guard.js`) as `--added-only`, run under this file's own Node (`process.execPath`).
    - `-z` makes a path with a space read as it is.
    - A failing entry exits 1 with `script-shell:` and the gate's own message (`lintText` in `hooks/mods/commit-gate.js`), before any suite starts and with no record written.
    - A tree with no modified CHANGELOG runs no lint.
    - With no linter the check stands aside, as the gate's does.
  - The root suite then runs detached through `run` (`lib/runs.js`) in process, in its own session, on the suite's log and lock (`runPaths(root, 'suite')`).
    - It runs as this file again, with `--suite-body <root>`.
    - Under a supervisor already (`WORKKIT_SUPERVISED=1`) it runs in the foreground, the suite's one lock still held for its length.
      - A HUP, INT or TERM to the call ends nothing at once: once the suite has ended the call exits 129, 130 or 143.
    - That body hashes the tree, runs the script with `sh`, and on exit 0 hashes again.
    - An unchanged tree writes the proved-tree record (`writeSuiteRecord` in `lib/records.js`) with the run's wall time; a changed one writes nothing.
    - With `CI` set, a green run writes nothing and exits 0, also when its tree changed during it or could not be hashed, and prints only the `CI` line (`docs/project-state.md` § The proof): `script-shell: the suite passed, but CI is set, so no record was written; run npm test again without CI`.
    - A red run prints no `CI` line.
  - Its stdout and stderr go to the suite log, truncated per run, which the foreground tails to stdout.
    - The log is `suite.log`, placed as `logPathOf` places it (the `lib/run-paths.js` entry).
    - The body's last line is always `script-shell: exit <code>` (`bodyEnd` in `lib/body.js`); a HUP, INT or TERM ends it at its next step, with 129, 130 or 143 and no record.
    - The suite writes to that file, never to a terminal. So a colour or reporter choice that looks for a terminal sees none, and the file is plain; the tail paints it for a terminal (`lib/attach.js`).
  - npm's exit code is the script's, with one exception.
    - A green run exits 1 when its tree cannot be hashed (on either side of the run), or its record cannot be written.
    - A changed tree, a green run with `CI` set, an unhashable tree and an unwritable record are each one `script-shell:` line in the log.
    - Each such line reaches the terminal on stdout through the tail, like every body line.
  - A kill of the shell that ran `npm test` leaves the suite running to its record.
    - So a cut-off agent reads the log for the result.
  - An INT, a human's Ctrl-C, ends the suite, a child in its own session included, and exits 130 with no record (`lib/runs.js`).
  - The run is passed `--root <root>`, so its supervisor checks it (`lib/detach.js`), a frozen suite ending 124 and a look 125 as `docs/tests.md` § The checks says.
  - A second root `npm test` while one runs starts nothing.
    - It prints `script-shell: a root npm test is already running (pid <pid>); its output is in <log>` on stderr, exit 1.
  - Another engine proves a tree by an adapter of its own that writes the same record.
  - On Windows the detached suite outlives the wait of the `script-shell.exe` that started this file.
- `script-shell.cs`:
  - On Windows npm starts its shell as a plain program, so it can start neither a `.sh` nor a `.cmd`.
  - `workkit setup` builds it into `~/.workkit/script-shell.exe` with the compiler every Windows ships.
    - The compiler is `%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`.
    - A human `setup` or `update` rebuilds it when it is missing or older than this source.
    - `--auto` builds nothing, and `doctor` only warns.
  - It takes the first `bash.exe` on `PATH` (quotes trimmed) outside the Windows folder and `%LOCALAPPDATA%\Microsoft\WindowsApps`, where WSL's live.
    - Else it takes the one beside `git.exe`'s own folder (`..\bin\bash.exe`).
  - It names the wrapper as `script-shell.sh` under the engine address.
    - The address is `WORKFLOW_CLAUDE_HOME`, else `HOME` plus `.claude`, the engine's order, then `workkit`.
    - `USERPROFILE` stands in for a start without `HOME`.
  - It runs bash with the wrapper and npm's own arguments, and returns its exit code.
  - It decides nothing about recording: that is `script-shell.js`'s, which the wrapper starts.
- `prove.js`:
  - The ship runs it instead of the root `npm test` when the folder holds work the commit leaves out.
    - That is when, after staging, `git diff --quiet` fails or `git ls-files --others --exclude-standard` prints a file.
  - The command starts it as its child, with the Node it runs on; a Node below the floor gets the command's floor line, exit 1 (§ The one command).
  - Any argument prints `prove: takes no arguments (usage: workkit prove)`, exit 2.
  - With `CI` set it stops before the copy, since its only product is the record and a run with `CI` set writes none (`docs/project-state.md` § The proof).
    - It prints `prove: CI is set, so no record would be written; run workkit prove again without CI` on stderr, exit 1, and runs no suite.
  - Run at the repo root with no arguments, it adds a detached worktree of HEAD outside the repo, at `copy` in a run folder of its own (`proofDir` in `lib/proof-dir.js`, `~/.cache/workkit/proof/<id>`).
    - The add goes through `worktreeAdd` in `lib/tree-copy.js`, the shared add that tries three times against a racing one.
  - It checks the whole index's tree out into it (`checkOut` in `lib/tree-copy.js`).
    - That is `write-tree` on a scratch copy of the index (`copyIndex` in `lib/tree-hash.js`).
    - So the real index is never written, nor blocked by a held `index.lock`.
    - The record and the before/after compare use the same copy's id less `.workkit/`, through `writeTree`.
  - It fills the copy from the live folder with only the paths an ignore pattern matches (`fillIgnored` in `lib/tree-copy.js`).
    - That is the fill red-proof uses, its relink of each package's `node_modules` included on every platform.
    - So an untracked or unstaged file stays out of the copy.
  - A copy whose tree is not the index's runs nothing.
  - The suite runs there as `npm test --script-shell=<sh>`, the `sh` `onPath` finds.
    - So the copy writes no record of its own.
    - Its `WORKFLOW_CLAUDE_HOME` is an empty folder in the run folder (`proofClaudeHome`), beside the copy, so a start in the copy never points the machine's engine address at it; the rest of the env is the caller's.
  - On green, with the copy's tree unchanged, the index's tree is recorded for the real repo (`writeSuiteRecord` in `lib/records.js`).
  - The working folder and the index are never changed.
  - The copy is removed on every exit (`worktreeRemove`, the shared removal beside the add), and its run folder with it.
  - It shares the root run's log and lock (`runPaths(root, 'suite')` in `lib/run-paths.js`), its body run through `run` (`lib/runs.js`) in process as this file again with `--body <root>`.
    - So one full run goes at a time. A second prints `prove: a root suite run is already running (pid <n>); its output is in <log>`, exit 1.
    - Its closing line is `prove: exit <code>` (`bodyEnd` in `lib/body.js`); a `detach:` line follows it after a frozen or requested end.
    - It is passed the root too, so it is checked as `docs/tests.md` § The checks says; a frozen run (124) leaves no record and its run folder gone.
    - A body a HUP, INT or TERM reaches ends at its next step, cleaned up the same way, with 129, 130 or 143.
  - A red run prints so, and exits with the suite's code.
  - Every other way no record is written exits 1 with one `prove:` line:
    - `CI` set, no test script, no npm, an unwritable index tree;
    - a failed add or fill, a changed copy, an unwritable record.
  - Before the detach, the full-suite hold judges it against the index's tree: the `lib/hold.js` entry.
  - `npm` and the `sh` it hands npm are found by `onPath` in `lib/run.js`, the engine's one `command -v` (the suites have their own, `packages/core/test/lib/on-path.js`): with no `npm`, `prove: npm is not on PATH`, exit 1.
- `supervise.js`:
  - `workkit supervise -- <command> [args...]` runs any command the way the root `npm test` runs: detached, read by the supervisor, its output tailed to the call.
    - A lane or a build started in the background goes through it (`../docs/agents.md` § Watching a run).
  - The command starts it as its child, with the Node it runs on; a Node below the floor gets the command's floor line, exit 1 (§ The one command).
  - A call with no `--` or no command prints `usage: workkit supervise -- <command> [args...]`, exit 2.
  - Outside a git repo it prints `supervise: not inside a git repository`, exit 1.
  - A command that is supervised itself (an `npm test`, `workkit test`, `workkit prove`, another `workkit supervise`) still runs under it.
    - The command sees `WORKKIT_SUPERVISED=1`, so it runs in the foreground inside this run and starts no second supervisor (`runForeground` in `lib/attach.js`).
    - So `workkit supervise -- npm test -- <files>` is one supervised run, and `workkit supervise -- workkit supervise -- <command>` exits with the command's code.
    - A root `npm test` under it still holds the suite's one slot.
  - It runs `supervise.js --body -- <command> [args...]` through `run` (`lib/runs.js`) in process, passed the root.
    - The body runs the command in the folder the call was made in, and exits with its code.
    - The body's last line is always `supervise: exit <code>` (`bodyEnd` in `lib/body.js`).
    - The command is a program, started as `runHere` (`lib/attach.js`) starts one: a file with no `#!` line is started again by `sh -c`, found as a shell finds it and run as a script; one that cannot start is one line naming it and a shell's code, `detach: <cmd>: command not found` and 127, or `detach: <cmd>: cannot be run (<reason>)` and 126 for a file that is not executable or a folder.
    - A shell builtin is no program, so `workkit supervise -- exit 3` is `command not found`, 127.
  - It has its own log and lock (`runPaths(root, 'run')` in `lib/run-paths.js`), beside the root run's.
    - The log is `run.log`, placed as `logPathOf` places it (the `lib/run-paths.js` entry).
    - So one supervised run goes at a time per repo, beside the suite's own.
    - A second prints `supervise: a supervised run is already running (pid <N>); its output is in <log>`, exit 1.
  - The call exits with the command's own code, 124 after a frozen end, or 125 on a look with the run going on (`docs/tests.md` § The checks).
  - An INT ends the whole run, a child in its own session included, and exits 130 (`lib/runs.js`); a kill of the calling shell leaves it running to its end.
  - Its entry in `COMMANDS` (`workkit/command-list.js`) is `none`, so the kit keeps no rule for it: it runs any command, so Claude Code checks the call the way it checks any command.
- `watch.js`:
  - `workkit watch [--end] [suite|run|<pid>]` attaches the call again to the repo's live run.
    - The command starts it as its child, with the Node it runs on; a Node below the floor gets the command's floor line, exit 1 (§ The one command).
    - Any other argument prints `usage: workkit watch [--end] [suite|run|<pid>]`, exit 2.
    - Outside a git repo it prints `watch: not inside a git repository`, exit 1.
  - With no name it follows the suite's run when that run is live, else the supervised one, else the one live narrowed run, each run's log and lock `runPaths`' (`lib/run-paths.js`).
    - `suite` names the suite's run, `run` the supervised one, and a pid a narrowed run (`testSlots` lists them), the pid its look line names.
    - Live is `runHeld` (`lib/run-lock.js`): a pid file in the lock, and the pid alive or the done file written.
    - So a run that ended with no call attached, after a look, still counts as live until a call collects its answer.
    - With no live run, or the named one not live, it prints `watch: no run is live in <root>`, exit 1.
  - It never guesses between live runs.
    - A follow with no name, no suite run and no supervised run, but several live narrowed runs, follows none.
    - `--end` with no name counts only the runs still running (`runLive`), the suite's, the supervised one and each narrowed one, but a run held in the foreground (below), which ends with the run that holds it. With more than one it ends none.
    - With none still running, it takes a run that finished with its answer uncollected.
    - Each refusal prints `watch: <count> runs are live; name one:` and the call for each, `workkit watch [--end] <name>` joined by `, or `, exit 2.
  - A run inside another run's supervisor holds its slot in the foreground, with no supervisor of its own: a root `npm test` inside `workkit supervise` holds the suite's, a `workkit supervise` inside a root `npm test` or `workkit prove` the supervised one's.
    - `runForeground` (`lib/attach.js`) marks its lock so: a `foreground` file holding the enclosing run's lock path (`WK_RUN_LOCK`).
    - `--end <name>` on a lock so marked writes no `end` file and waits on nothing: it prints `watch: workkit watch --end <name> cannot end a run held in the foreground inside another run; <how>`, exit 1.
    - `<how>` is `workkit watch --end run ends it` when the marker names the supervised run's lock, `workkit watch --end suite ends it` when it names the suite's, and otherwise `end the run that started it`.
    - The marker's path is folded from a Git Bash spelling (`shellDirOf` in `hooks/mods/markers.js`), then compared with each lock by `samePath` (`lib/attach.js`): resolved, and on Windows without regard to case.
  - A narrowed run's slot is cleared (`clearSlot`) once the call reads its end or ends it, and only when the call that started it is gone. A look keeps it.
    - The call is the pid naming the slot, the Node process of `script-shell.js`, asked through `pidAlive` on every platform.
  - It prints the log's last 20 lines up to a size measured first, then tails it from that size through `attachRun` (`lib/attach.js`), both through one view (`viewOf`): no line shows twice, and each whole line is painted when `colorOn` says yes.
    - It ends at the run's end, a frozen end or the next look, with the same exit codes as the call that started the run.
    - A run that ended already gets its answer at once: the last 20 lines, the run's code as the exit, and the lock dropped, so a second `workkit watch` prints the no-run line.
    - Ctrl-C ends the call only: the run goes on, and its lock stays held.
  - `--end` writes the `end` file in the run's lock folder, the supervisor's end request, and waits through `askEnd` (`lib/run-lock.js`).
    - Once the done file is written, it prints the log's last line (the supervisor's closing line) and exits 0.
    - When it finds the done file it collects the answer through `attachRun` too, so the lock drops, and a call still attached reads the code from its record.
    - A run that ended already prints `watch: the run ended already (exit <code>)`, drops the lock and exits 0.
    - Once 30 seconds have passed since the request, a supervisor that never answered (no `ending` file) or whose end failed (its `ending` file gone again) prints `watch: the run did not end; its supervisor is pid <N>`, exit 1. One that is ending its run is waited for while it lives.
    - A supervisor gone that left no answer (`askEnd`'s 2) prints `watch: the run's supervisor (pid <N>) is gone and left no answer`, exit 1.
    - On a narrowed run it clears the slot only when the call that started it, the slot's `script-shell.js` Node process, is gone; a call still attached to the run clears its own slot and exits 143.
  - The kit's allow rule `Bash(workkit watch:*)` (its `allow` entry in `COMMANDS`, made a rule in `ALLOW_RULES`, `workkit/allow.js`) covers the verb, so it runs as its own Bash call: the rule matches the bare call alone.
- `githooks/`:
  - The heal (`standards/githooks.js`) sets them as `~/.claude/workkit/githooks`, through the engine link.
    - Where the link is missing, it sets this folder itself.
  - `script-shell.sh` sets them back after a repo's install-time script.
  - They are the sixteen hooks git runs from the hooks folder on commit, merge, rebase, checkout, rewrite, apply, push, gc, send-email and index write:
    - `applypatch-msg`, `pre-applypatch`, `post-applypatch`, `pre-commit`, `pre-merge-commit`, `prepare-commit-msg`, `commit-msg`, `post-commit`;
    - `pre-rebase`, `post-checkout`, `post-merge`, `pre-push`, `pre-auto-gc`, `post-rewrite`, `sendemail-validate`, `post-index-change`.
  - Git's `reference-transaction` and `p4-*` hooks are not carried.
    - So a repo's own copy of those stops running under this path.
  - Each is the same body, functions only with `main "$@"` last.
    - It hands its own file name (`${BASH_SOURCE[0]##*/}`) to `hook.sh`'s `wk_githook_run`.
    - It finds the kit root in two steps: `cd -P` into its own folder, then `cd -P ../..`.
    - So `..` is taken from the physical folder: Git Bash collapses `..` in a Windows-spelled path before it reads the link.
    - And a hook reached through the link loads this kit.
  - Only `pre-commit` and `commit-msg` judge. They see the real staged tree and the real message, never a command's text.
    - The hook runs `judge.js <hook> <root> [<message file>]` only where `wk_session_judges` (`lib/participation.sh`) holds for the repo root.
    - It runs under the node `wk_node` (`lib/platform.sh`) picks.
    - Its non-zero exit ends the commit with that code, its bounce on stderr.
    - With no node 22.22 or newer found, it says `<hook>: the workkit judge did not run (no node 22.22 or newer found)` on stderr and goes on.
  - Then comes the chain, whatever the session and for every hook.
    - So every other hook (`pre-push`, `post-commit`, git-lfs's) passes through to the repo's own.
    - It runs the hook of the same name in the folder `workkit.hooksPath` names (read with `--path`).
    - That folder is passed over when it is kit-like (`wk_githooks_kitlike`, `lib/participation.sh`), so a hook never chains to itself.
    - Else it runs the one in the git dir's `hooks/`.
    - Either is exec'd with the same arguments, so a bounce from either ends the commit. None is exit 0.
  - `judge.js` builds its facts from the real machine (`lib/io.js`), in the hook's own environment.
    - So `git` answers from the commit's index (`GIT_INDEX_FILE`) under `-a`, a pathspec, `git -C`, `sh -c` and `-F` alike.
  - `pre-commit` runs `preCommitVerdict` (`hooks/mods/commit-gate.js`).
  - `commit-msg` reads the message file as git's `-m` and `-F` cleanup leaves it (`messageOf`).
    - Every line is kept, `#` lines included.
    - Only everything from the `--verbose` scissors line down, and the blank lines at either end, are dropped.
    - Then it runs, in this order: `commitMsgVerdict`, `commitLanguageVerdict`, `commitAttributionVerdict` and `releaseCommitVerdict` (`hooks/mods/release-taken.js`).
    - `commitLanguageVerdict` is `hooks/mods/commit-language.js`, skipped in a repo with no origin.
    - `commitAttributionVerdict` is `hooks/mods/commit-attribution.js`, run only when `attributionOff` (`hooks/mods/settings.js`) reads `commit.attribution` false in the repo's merged settings.
  - A deny exits 1; notices print and exit 0.
  - `git commit --no-verify` and `-c core.hooksPath=` skip both hooks.
    - That is the accepted bypass, which no code watches for and the agent instructions forbid (`docs/hooks.md` § `safety:commit-gate`).
  - `git lfs install` refuses a hooks folder that already holds hook files.
  - `git lfs update --force` would overwrite the kit's shared folder for every repo.
  - A repo turning lfs on after the heal runs `git lfs update --manual`.
    - That prints the hook lines to put into its own `.git/hooks`, where the chain runs them.
  - `judge.js tree-guard -- <argv...>` is the `git` shim's ruling on one git call (`gitshim/` below), from the same file.
- `gitshim/`:
  - `git` is the `git` shim, bash, the one file in the folder.
  - It is never linked. The hooks module's `classic.SessionStart` puts the folder first on a Claude session's PATH (`../docs/hooks.md` § `safety:tree-guard`).
  - It finds the real `git` as `identity/gh` finds the real `gh`: the first on PATH after its own folder, every folder met at or before it skipped.
  - A call naming none of `checkout`, `switch`, `restore`, `stash`, `clean` and `reset`, whose verb is one of git's own, is an `exec` of the real git with nothing started first.
  - Any other verb is followed as an alias chain (`expand_alias`), up to five hops, the global options leading each alias skipped.
    - A chain that reaches a judged verb is judged as that verb. A `!` alias, a git verb or no alias ends it, and git runs.
    - A chain deeper than five hops is refused where the shim judges: `tree-guard: BLOCKED this command: the git alias <name> is a chain deeper than five hops ...`, exit 1, git not run.
    - The limits: `../docs/hooks.md` § `safety:tree-guard`.
  - For a judged verb it asks the real git for the root, git's global options kept, then `wk_session_judges` (`lib/participation.sh`).
  - Where that holds it runs `githooks/judge.js tree-guard -- <argv...>` under `wk_node`: exit 0 runs git, any other code is the refusal, its text on stderr.
  - Everywhere else, and with no node to run the judge (one stderr line), it runs git.
  - `WORKKIT_ALLOW_DISCARD=1` in its environment is the owner's escape, said on stderr.
- `changelog/job.js`:
  - Required by the heal (`standards/checks.js`, `changelog.js`, `labels.js`), CJS.
  - `safety:commit-gate` runs it as a program, `node job.js <mode>` (`rewrite [template]`, `copies`, `names <file|-> [copy]`); any other call prints the usage line and exits 64.
    - Its own lines open `changelog-job:`.
  - The copies' two names (`LINTER_COPIES`), the `copies` mode's lines.
  - Whether a text names a copy (`namesLinterCopy(text, copy)`): a mention outside a comment line.
    - It is the one definition the heal and the gate both ask.
    - The heal asks it over a workflow folder (`workflowsRunCopy(root, copy)`): 0 yes, 1 no or no folder, 2 for a folder or file that could not be read, which the heal reads as keep.
    - Its walk is its own (`filesOrThrow`), which throws on a folder it cannot read, where `filesUnder` (`lib/read.js`) reads one as empty.
    - The gate asks it through `names`, over the workflow texts on stdin (`-`): 0 named, 1 not, 2 a file that could not be read, which it holds on by name.
  - The template's address (`TEMPLATE`).
  - The rewrite (`checksRewrite(template, root)`, the program's `rewrite [template]`).
    - It is the template with the repo's default branch in place of `__DEFAULT_BRANCH__`, whatever the file held. So no file is read.
    - That branch is `defaultBranch` (`lib/git.js`), the one read branch protection shares.
    - It is GitHub's answer, else `origin/HEAD`'s, else a failure, never a guess.
    - On a failure the rewrite exits 2, naming `git remote set-head origin -a` on stderr; an unread template exits 1.
  - The heal writes the rewrite.
  - The gate proves a committed `checks.yml` blob is exactly it, a first caller included, and holds where the rewrite fails.
- `ship/release.js`:
  - It sets `version` in every version file carrying one; a file with no version is left alone.
    - `package.json`, every workspace member's `package.json` at the old version, and their `package-lock.json` spots move through one npm call.
    - The call is `npm version <x.y.z> --no-git-tag-version --package-lock-only`.
    - A member at the old version is a lockstep member. A member at another version is left alone.
    - The call gets `--workspace=<folder>` per lockstep member, and `--include-workspace-root` when the root carries the version.
    - It runs the package's version scripts, and makes no commit or tag.
    - In a workspaces repo npm then syncs only the lockfile, never `node_modules`.
    - It fetches nothing when the lockfile already lists every dependency. One that lags `package.json` makes it ask the registry.
    - With no lockfile, `--no-workspaces-update` skips the sync, so none is made.
    - `.claude-plugin/plugin.json` moves by text, every other byte and its line endings kept.
    - An npm failure puts back every file npm may have written, and refuses before the rest is written. So a rerun starts clean.
  - It then runs the `changelog-links.js` backfill, through its own functions.
  - Then it moves every `[Unreleased]` entry whose issue is not in `--keep` under a new `## [x.y.z] - <today>` section.
    - The section sits directly below the emptied heading.
    - Categories are kept, and an emptied one dropped.
  - The command: `workkit ship release <x.y.z> [--keep N,M] [--dir <root>] [--dry-run]`.
  - It prints `released x.y.z (<each file bumped>): N entries moved, M kept under [Unreleased]`.
  - Under `--dry-run`, writing nothing, it prints `dry run: would release x.y.z (<each file bumped>): N entries to move, M kept under [Unreleased]`.
  - It names on stderr any moved entry it could not link, and any `--keep` number matching no entry.
  - It refuses with one `release:` line, writing nothing, on any of these:
    - a non-semver or unchanged version;
    - neither file carrying a version;
    - no `[Unreleased]` heading;
    - a release that would move nothing;
    - a stray line among the entries;
    - a pending caller (`ship/caller.js`'s `callerPending`), under `--dry-run` too: `release: .github/workflows/checks.yml has changes that are not committed; commit the caller before the release commit; nothing was written.`
  - It never commits, tags or pushes.
- `ship/plan.js`:
  - The command: `workkit ship plan [--dir <root>]`. It publishes nothing.
  - It is the library `release.js`, `publish.js` and `lib/workspaces.js` require.
    - It gives the first two how they name npm's end: `npmEnd`, `lib/say.js`'s `endOf` after `npm`.
    - It passes on `lib/expand-workspaces.js`'s `expandWorkspaces` and `PlanError` for `release.js`.
    - For `lib/workspaces.js` it gives `readJson` and `depNamesOf` (the dependency fields, `optionalDependencies` among them).
    - `safety:release-taken` (`hooks/mods/release-taken.js`) imports `skipReason`, the rule for which packages publish.
  - Its lines and refusals speak as `publish-plan:`.
- `ship/publish.js`:
  - It publishes what HEAD holds, never work the commit left out.
    - A folder equal to HEAD (no tracked file changed, staged or not, and no untracked file git does not ignore), or a root in no git repository, publishes in place.
    - A folder that differs makes one detached worktree of HEAD in a new run folder (`proofDir` in `lib/proof-dir.js`), checked out and filled with the repo's gitignored files as `prove.js` fills its copy (`checkOut` and `fillIgnored` in `lib/tree-copy.js`).
      - Those files (a build output, `node_modules`) come from the folder, so a build output no publish script rebuilds is the folder's, not HEAD's.
      - The filled copy's tree must still be HEAD's (`treeId` against `indexTreeId` of the copy, `lib/tree-hash.js`); a file HEAD's ignore rules do not ignore, filled by the folder's, refuses it.
    - It prints `publish-plan: the folder differs from HEAD (<N> paths), so this publishes from a copy of <sha7>.` on stderr (`1 path` for one), then runs the plan, the npm check and every publish there; a `--dir` member maps to its own path inside the copy.
    - The copy and its run folder are removed on every return, a failed publish included; a worktree git still lists after the removal prints `publish-plan: git still lists the removed worktree <copy> (run git -C <root> worktree prune).`
    - A copy it cannot make or fill exits 1 with `publish-plan: could not make a copy of <sha7> to publish from (<why>); nothing was published.`, never falling back to the folder.
  - It prints the plan `plan.js` prints, then publishes it in order from the root.
  - It asks npm first whether each version is already out: a `skipped` line, and the run goes on.
  - It stops at the first failed publish, naming what was and was not published.
  - A run that published at least one package and exits 0 then runs the afterPublish hooks (`ship/hooks.js`) of the repo `--dir` sits in.
    - They are read from its git top level, so a run from a member folder reads the root's `.workkit/settings.json`.
    - They run at the real repo root, a publish from a copy included.
    - One failing prints `publish-plan: <N> published; an afterPublish hook failed.` and exits 1.
  - A run that publishes nothing, or fails, runs none.
  - It never runs `prepare`.
- `ship/cut.js`:
  - It runs from inside the repo, at its root (`repoRoot` in `lib/git.js`).
  - The repo's `checks.yml` `release` job (`release.yml`, `.github/scripts/ci-release.js`) makes `v<x.y.z>` when the release commit reaches the default branch.
    - That is the same on a machine and in a cloud session.
  - The cut first checks that `.github/workflows/checks.yml` at HEAD, the file CI ran, holds a top-level job named `release` (`ship/caller.js`).
    - The disk is read only to choose the line when HEAD's has none.
  - Then it checks that the CHANGELOG has an `[x.y.z]` section with entries.
  - Then it waits for `gh release view v<x.y.z>` to answer, and runs the repo's afterRelease hooks (`ship/hooks.js`).
  - A release already there answers at once.
  - Only gh's "release not found" keeps it waiting (`isReleased`).
    - Any other `gh release view` failure (auth, network, API) throws `ReleaseViewError` and ends the cut at once, exit 1, no hook run.
    - The line is `ship-cut: gh release view v<x.y.z> failed: <gh's first stderr line>`.
    - CI's scan says the same as `ci-release:`.
  - Before any wait, a version with no `chore(release): <x.y.z>` commit and no release yet stops the cut, exit 1, no hook run.
    - The line is `ship-cut: v<x.y.z> has no release commit; nothing for CI to release`.
    - One released before it had a release commit still runs its hooks.
  - The wait asks every `WORKKIT_CUT_RELEASE_POLL` seconds (10), for `WORKKIT_CUT_RELEASE_TIMEOUT` seconds in all (600, the `<n>` of its failure line); a value that is not a finite number of 0 or more counts as unset (`nonNegativeOf` in `lib/bounded.js`).
    - Every version of the cut shares that one budget.
  - It first waits for every earlier version with a release commit but no release.
    - It walks down from the newest earlier one to the first released. None released waits for nothing.
    - It passes over one whose release commit carries the `Release: none` trailer a `no release` ship leaves.
    - It waits for them oldest first, each followed by its hooks.
    - Each wait comes after `ship-cut: v<x.y.z> has a release commit but no release; waiting for CI to release it at <sha7>`.
    - An earlier one with no CHANGELOG section, a wait that ends with no release, or a failed hook stops the cut there with its line.
  - It also exports what CI reads:
    - `sectionBody`: the CHANGELOG's `[x.y.z]` section, from its heading to its last entry;
    - `sectionBody` finds it through `changelog/lint.js`'s `parseEntries` and `sectionHeadingAt`, the heading walk `ship/release.js` shares;
    - `noSection`;
    - `missingBefore(root, commits, version)`: the walk above, which CI runs too, so the two release the same versions;
    - `releaseCommits(root, revs)`: the release commits the revisions reach, newest first, one per version;
    - each such commit has a subject exactly `chore(release): <x.y.z>`, and is marked when it carries `Release: none`;
    - `isReleased` and its `ReleaseViewError`.
  - Its own lines are `ship-cut:` on stderr:
    - a version that is not semver, or none, is the usage line, exit 2;
    - a version whose own release commit carries `Release: none` is exit 0, no wait and no hook;
    - that line is `ship-cut: the chore(release): <x.y.z> commit carries Release: none, so there is no v<x.y.z> to wait for and no hook ran`;
    - no `release` job at HEAD nor on disk (or no file) is `ship-cut: .github/workflows/checks.yml has no release job; run the standards heal (workkit heal) and commit the caller`, exit 1;
    - no `release` job at HEAD but one on disk is `ship-cut: .github/workflows/checks.yml has a release job on disk but not in the last commit; commit the caller and push it, then run the cut again`, exit 1;
    - both come before the wait and before any `gh` call;
    - a repo with no HEAD commit has no caller at HEAD, so it gets one of the two caller lines above;
    - no `[x.y.z]` section with entries or a folder outside a repo is one line, exit 1;
    - no release within the wait is `ship-cut: no release v<x.y.z> after <n>s; check the release job: <url>`, exit 1, no hook run;
    - that url is HEAD's `checks.yml` run (`gh run list --commit`), else the repo's Actions page;
    - a hook failing prints `ship-cut: v<x.y.z> was released; an afterRelease hook failed`, exit 1, the release standing.
- `ship/deploy.js`:
  - It runs `npm run deploy` when the root `package.json` has `scripts.deploy`.
  - Else it runs `npm run release` when it has only `scripts.release`.
  - It runs through `lib/run.js`'s `spawnSync`, output passed through.
  - On exit 0 it runs the repo's afterDeploy hooks (`ship/hooks.js`).
  - It asks nothing itself: the owner's yes is the ship skill's Step 6, and Claude Code's ask rule prompts at the call as well.
  - Its own lines are `ship-deploy:` on stderr:
    - neither script (or no `package.json`) is `ship-deploy: no deploy or release script`, exit 0, no hook run;
    - the script failing is `ship-deploy: npm run <name> exited <code>`, exit 1, no hook run;
    - a hook failing is `ship-deploy: the deploy ran; an afterDeploy hook failed`, exit 1.
  - An argument is the usage line, exit 2.
  - A `package.json` that does not parse, or a folder outside a repo, is one line, exit 1.
- `ship/hooks.js`:
  - `EVENTS` (`afterRelease`, `afterPublish`, `afterDeploy`) and `runHooks(root, event)`.
    - `cut.js`, `publish.js` and `deploy.js` call it once their step succeeds. It returns 0 or 1.
  - It reads the repo's merged settings (`settingsAt` in `lib/settings.js`).
    - The layers: the kit's defaults, each event `[]`, then `~/.workkit/settings.json`, then the repo's tracked `.workkit/settings.json`.
  - It also reads what that merge set aside (`faultsAt`, filtered by `faultsUnder`).
  - It runs nothing unless the repo's own file says `"enabled": true`.
    - A repo without it runs none silently, while no layer declares hooks for the event.
    - A repo without `"enabled": true` whose merged settings declare hooks for the event prints a line, the command's own exit code standing.
    - The line: `ship-hooks: <event>: hooks run only where .workkit/settings.json says "enabled": true`.
  - The commands are `"hooks": { "<event>": [{ "command": "<shell command>", "local": true }] }`, `local` optional.
    - Each runs through `bash -c` from the repo root, in order, its output passed through.
    - Each comes after a `ship-hooks: <event> [i/n] <command>` line.
    - Any language runs, since each is a shell command.
  - An entry marked `"local": true` needs a machine.
    - A cloud session (`CLAUDE_CODE_REMOTE=true`) runs none of it, and runs the entries after it.
    - It prints `ship-hooks: <event> [i/n] <command> skipped: local only, this is a cloud session`.
  - Every `ship-hooks:` line goes to stderr, so the command's stdout stays its own.
  - An enabled repo with none for the event prints `ship-hooks: no <event> hooks`, 0.
  - A command exiting non-zero prints `ship-hooks: <event> <command> exited <code>`, 1, the later ones not run.
    - One ended by a signal prints `... did not finish (<signal>)`, 1 the same.
    - One that could not start prints `... could not be run, <error code>`, 1 the same.
  - These are one `ship-hooks:` line naming the fault, 1, nothing run:
    - a repo file that does not parse;
    - in an enabled repo, either of two shape faults:
      - a `hooks` in any layer that is no object;
      - a `hooks.<event>` of the wrong shape: not an array, an entry with no non-empty string `command`, or a `local` that is not `true` or `false`.
- `ship/watch.js`:
  - The command starts it as its child, as `supervise` and `watch` start; a Node below the floor gets the command's floor line, exit 1, before its usage is read.
  - It expands a sha shorter than 40 characters to the full commit id, since `gh run list --commit` matches only that.
    - It uses `git rev-parse --verify --quiet <sha>^{commit}` from the repo root.
    - A full sha is used as given.
  - Then it finds the sha's runs (`gh run list --commit`), each `gh` call started through `lib/run.js` and its JSON read in process.
    - An empty list is asked again six times, ten seconds apart.
    - `WORKKIT_CI_WATCH_TRIES` and `WORKKIT_CI_WATCH_WAIT` override both.
  - With none, it may look for a PR, when some workflow's top-level `on:` names `pull_request`.
    - A sha that is the tip of the checked-out branch asks `gh pr list --head <branch> --state open`.
    - CI that never runs on that branch's push may run on its PR.
    - With an open PR it prints `ci-watch: waiting for PR #<n>'s run for <sha>` and asks again the same way.
    - Still none is 3 and `ci-watch: run not queued yet for <sha> (PR #<n>)`.
  - It watches every run with `gh run watch --exit-status`, and answers in one exit code:
    - 0 green, one `ci-watch: green: <workflow> <url>` line per run;
    - 1 red, `ci-watch: RED: <workflow>, job <failing job>: <url>` and the last 40 lines of `gh run view --log-failed`;
    - it is red only when `gh run view --json conclusion,jobs` says the run finished.
  - With no run after the retries:
    - 0 and `ci-watch: no CI configured for push`, when no workflow under the repo's `.github/workflows/` names `push` in its top-level `on:` (`listensTo` in `ship/triggers.js`);
    - 3 and `ci-watch: run not queued yet for <sha>`, when one does.
  - A usage error is 2.
    - So is a short sha the clone cannot resolve, with a line on stderr before any `gh` call.
    - That line is `ci-watch: <sha> is not a commit this clone knows; fetch it or pass the full sha`.
  - gh failing is 4 with the line:
    - a `gh run list` that failed or answered no run list (an answer that is not a JSON list is gh failing, never an empty list);
    - a `gh pr list` that failed (`ci-watch: gh pr list --head <branch> failed: <its first error line>`);
    - a `gh pr list` that answered no PR list (`ci-watch: gh pr list --head <branch> answered no PR list: <its first line>`);
    - a watch that exited non-zero on a run gh cannot then show as finished (GitHub unreachable, the login refused).
    - That is no answer rather than a red.
  - The watch runs detached through `run` (`lib/runs.js`) in process, as this file again in its `--watch-body <sha>` mode under the same node.
    - So a kill of the invoking shell leaves it going to its answer.
    - Its output, stdout and stderr alike, goes to the CI log, truncated per call.
    - The log is `runPaths(root, 'ci')`'s (`lib/run-paths.js`): `ci.log`, placed as `logPathOf` places it.
    - A bad `logs.dir` is `logDirOf`'s line and exit 4, no answer, nothing watched.
    - The output reaches the terminal on stdout through the tail, every line above included.
    - Its first line is `ci-watch: watching <sha>`.
    - Its last is `ci-watch: exit <code>` (`bodyEnd` in `lib/body.js`), the code the foreground exits with, but after an INT.
    - A signal to the body ends it once its `gh` call has ended, and it starts no `gh` call or wait after it.
  - A run that fails non-zero while that last line does not carry its code is the runner failing, never a red.
    - That is when the runner could not start, or the supervisor died.
    - It prints `ci-watch: the watch did not finish, so there is no answer; its output is in <log>` on stderr, exit 4.
  - A second watch while one runs starts nothing.
    - It prints `ci-watch: a watch is already running for <sha> (pid <pid>); its output is in <log>` on stderr, exit 5.
  - INT ends the watch through the end request (`lib/runs.js`), exit 130: the log ends with the request line, under `ci-watch: exit 143`.
- `ship/triggers.js`:
  - Both rules read the file in Node: carriage returns are dropped, single quotes read as double, and comment and blank lines are left out. A file that cannot be read answers false.
  - `listensTo(file, event)` reads `on:` in any of its YAML shapes: a scalar, a flow list, a block of keys or items.
    - An event nested deeper is never one.
    - `ship/watch.js` asks it for `push` and `pull_request`.
    - `.github/scripts/ci-release.js` asks it for `release` and `workflow_dispatch`.
  - `takesInput(file, input)` is true only for a key of `inputs:` under `workflow_dispatch:` under the top-level `on:`, each in block style.
    - The same key anywhere else (a step's `with:`, an input's property) never counts.
    - `.github/scripts/ci-release.js` asks it for `tag`.
- `ship/items.js`:
  - The line is `<stage> #<N> <proved|unproved> <title>`, qa first then complete, each by number.
  - `proved` is a comment line starting `Proof:`.
    - That is the pattern `safety:proof-guard` reads, `PROOF_RE` in `hooks/mods/proof.js`, read from there.
  - It reads gh's answer in Node (`ghJson` in `public/lib.js`), so it needs no `jq`.
  - Nothing at either stage prints `ship-items: nothing at qa or complete`.
  - A failed `gh` prints one `ship-items:` line on stderr and exits 1.
  - A usage error exits 2.
  - The command: `workkit ship items [--repo owner/name]`.
- `review/covers.js`:
  - The marker must be newer than every modified, staged and untracked path, and than the folder a deleted path left.
    - The one change it passes over is the heal's removal of the retired `version` key from `.workkit/settings.json`.
  - It prints `review-covers: covered` and exits 0, or `review-covers: stale: <why>` and exits 1.
  - A folder outside a repo, or a working diff git cannot list, exits 2 with one `review-covers:` line (`docs/hooks.md` § `safety:commit-gate`).
  - It and `review/mark.js` key the marker in Node (`markerPath` in `hooks/mods/markers.js`), so neither needs `shasum` or `sha1sum`.
- `proof/red.js`:
  - The command starts it as its child, with the Node it runs on; a Node below the floor gets the command's floor line, exit 2, since its 1 means green (§ The one command).
  - It runs the command against the named paths as the claim's snapshot holds them.
    - That is in a worktree copy (`copyPlace` in `proof/place.js`), or, with `--live` as the first word, swapped in the live tree (`livePlace`).
    - Either mode's run folder is `proofDir`'s (`lib/proof-dir.js`), under `~/.cache/workkit/proof`, removed on every exit but one: a `--live` run that cannot restore the live tree keeps it.
    - Each place answers the folder the command runs in and a `restore()` that leaves the live tree and the worktree list as they were.
    - In the copy mode the command's `WORKFLOW_CLAUDE_HOME` is an empty folder in the run folder (`proofClaudeHome`), as `prove.js` hands its suite; a `--live` command keeps the caller's.
    - In the copy mode its `npm_config_script_shell` is also the `sh` on PATH (`onPath`), so an npm there runs its script with plain sh, needs no wrapper behind that Claude home and writes no record, as in `workkit prove`; with no `sh` on PATH, and in `--live`, it is the caller's.
  - The command's stdout and stderr stream live, each on its own stream, and are kept for the reading.
  - Red exits 0, green 1, and any other stop 2 with a `red-proof:` line. A `--live` run a HUP, INT or TERM ends exits 129, 130 or 143 once its command has ended, the live tree restored.
  - The copy, the copy mode's end on a HUP, INT or TERM, the stop on a reader of stdout or stderr that closes, the load check, the summary check and the limits are `docs/agents.md` § Crew sizing; the names they run through are below.
  - The load check reads a missing module in its four spellings before it compares it with the named paths, a workspace link's through `physical` (which a named path is read through too), a bare specifier's through `modulePath`, and a scratch link's under the temp folder through `scratchNamed`, which reads it as a named path only when the copy lacks that path.
  - The failures it judges are `loadFailures({ out, err })` in `proof/reading.js`: each `{ spec, from }` of a `Cannot find module` or `Cannot find package` line.
  - It hands the summary file (`docs/tests.md` § The kit's runner) to the command, and `summaryOf({ out, err, file })` in `proof/reading.js` sums its lines.

## The one command

- `workkit.js` is the front door, a Node program; its entry, its floor check and its route are the `workkit.js` entry above.
- From zero on a new machine, the whole recipe is a clone and one line, run with a Node at the kit's floor (22.22) first on PATH:

```sh
git clone https://github.com/ITW-Creative-Works/workkit.git && cd workkit
node workflow/workkit.js setup
```

- `setup` installs the plugin from this kit when the `claude` CLI is present and does not have it.
  - A machine without that CLI gets a named skip, never a failure.
- It checks that `gh` is installed and authenticated.
- It points the engine's address at this folder (from a clone or the plugin cache).
- It points npm's `script-shell` at `script-shell.sh` through that address, so a root `npm test` records the tree it proved.
  - Unset is set. The kit's own shell reached through a linked folder reads as current.
  - A value someone else set is warned about and left, with the `npm config set script-shell` command named.
  - Or the warning names the `npm_config_script_shell` export, when the shell sets one.
  - The setting is made only when the wrapper exists behind the engine address.
  - With that link missing, a named skip leaves `script-shell` unset.
  - On Windows it first builds `script-shell.exe` from `script-shell.cs` into `~/.workkit`, with the compiler every Windows ships.
  - It then points npm at that, in git's spelling.
  - A machine without the compiler gets one skip line, and nothing is set.
- It adds each of the kit's allow rules and ask rules missing from `~/.claude/settings.json`, made from `COMMANDS` (the `workkit/command-list.js` entry).
  - Every other key is untouched, and a file already holding them all is never written.
- It installs the 9am schedule through `jobs/install.js`: a launchd agent on a Mac, a Task Scheduler task on Windows, and one skip line on any other system.
- It creates the home repo, and clones the tower project into `~/.workkit/tower`.
- It wires the cloud brief's secrets onto the home repo, where that brief runs and where it is delivered.
- It says whether this machine is signed in for the bot identity, signing in there at a keyboard.
- It says where the tower is started.
- It hands this machine's `gh` login token to the dashboard it just published.
- It offers to enable the repo the shell is standing in.
- It symlinks itself (`workkit.js`) to `~/.local/bin/workkit`, and the `gh` shim to `~/.local/bin/gh` beside it.
  - A link there that names anything else, an old `workkit.sh` included, is repointed; a real file there is left, with a warning to move it aside.
  - On Windows it also writes `~/.local/bin/workkit.cmd` from the `workkit.cmd` template, so cmd and PowerShell find the command; the file ends in CRLF and is rewritten only when its text differs.
  - `{{ENGINE}}` is the engine's address in its Windows form (`<claude home>\workkit`), so a plugin update that repoints the address needs no rewrite.
  - Where that directory is not on the PATH it prints the one `export` line to add; on Windows the line names the folder in its Windows form, to add in Windows' own settings.
  - It never edits a shell rc or a person's PATH.
- Every step checks before acting, so a second `setup` reports nothing to do.
- `setup` and `doctor` say all of that in titled sections, one blank line apart, in the order the steps run:
  - **This machine** (plugin, gh, the three links, the kit's allow and ask rules, the schedule);
  - **Home repo**;
  - **Cloud brief secrets**;
  - **Identity** (setup only; doctor's two identity lines sit under This machine and This repo);
  - **Dashboard site** (setup only);
  - **This repo**.
- Each title is a bold line opening with its emoji.
- `update --auto` prints neither the titles nor the blank lines.
  - A session-start injection stays terse, and the run's own quiet (`setQuiet`, `lib/voice.js`) is what silences them.
- The line shape, the levels, the color rule and the spinner are all [Output](#output) below.

| Command | What it does |
|---|---|
| `workkit help` | the map (also what a bare `workkit` prints) |
| `workkit setup` | the wizard above, the only path that installs a schedule for the first time; its This repo section, in an enabled repo, sets git's commit hooks when they are not set (`standards.js --git-hooks`), then says `git hooks: installed (<path>)`, or warns `git hooks: not installed; run workkit setup` when they still are not |
| `workkit setup --token` | the wizard's Claude-token step alone, forced: mint a `CLAUDE_CODE_OAUTH_TOKEN` and push it to the home repo however young the one there is: the flag IS the yes, so there is no age check and no question. Nothing else of setup runs. A token that went bad while young (a lapsed subscription) is what the age check cannot see |
| `workkit setup --login` | the wizard's sign-in step alone, forced: `identity/login.js` signs in to GitHub through the device flow, the browser opened to the device page, so the agent's bookkeeping posts as `workkit-agent[bot]`, replacing any sign-in already here. It runs the sign-in with or without a terminal. Nothing else of setup runs ([The bot identity](#the-bot-identity)) |
| `workkit setup --bot` | the wizard's App install step alone, forced; nothing else of setup runs ([The bot identity](#the-bot-identity)) |
| `workkit setup --home` | the wizard's home repo step alone, forced; nothing else of setup runs ([The home repo's lifecycle](#the-home-repos-lifecycle)) |
| `workkit setup --cloud` | the wizard for a cloud session (claude.ai/code, `CLAUDE_CODE_REMOTE=true`) |
| `workkit update` | re-runs the machine-side installs: the engine address, the two `~/.local/bin` symlinks (`workkit` and the `gh` shim) and on Windows `workkit.cmd`, npm's `script-shell`, the kit's allow and ask rules in `~/.claude/settings.json`, and the schedule |
| `workkit update --auto` | the quiet variant the standards hook runs; prints only what it changed |
| `workkit doctor` | reports drift, with the fix command for anything out of its reach |
| `workkit publish` | builds the tower project and pushes the site to the home repo's `gh-pages` branch; the daily job runs the same script after the brief |
| `workkit brief` | today's brief, asked for now: the same `gh workflow run brief.yml` dispatch the 9am schedule makes, through the same one function (`jobs/brief-dispatch.js`) and the same secret guards. A human is standing here, so a refusal names its reason and exits 1 rather than being logged and carried past, and a dispatch that lands prints where to watch the run |
| `workkit brief --local` | the rehearsal instead: `jobs/morning.js --now`, the full local morning with the brief composed and sent from this machine and never posted to the home repo. The other steps still run where they can: the summaries can post their Discussion, and the site publish fires when it is switched on |
| `workkit enable [repo]` · `workkit decline [repo]` | `standards.js --enable` / `--decline` under the one name |
| `workkit heal [repo]` | `standards.js` with no flag under the one name: the repo's heal, on the shell's own repo or the one named, run NOW: the session hook makes the same pass once a day, and this is how a repo gets it without waiting |
| `workkit tower` | runs the tower here: the JSON API (8693) and the dashboard (4300) together; replaces any previous instance on those ports, and one interrupt ends both |
| `workkit state [repo]` | `standards.js --state` under the one name: the repo's participation, one word on stdout (`enabled`, `disabled`, `declined`, `undecided`, `home`, `unreadable` or `nogit`) |
| `workkit note <text...>` | `note.js`, the capture command ([The capture CLI](#the-capture-cli)) |
| `workkit log [-n N] [--follow]` | the hooks log (`docs/hooks.md` § The hooks log): the last 40 lines, `-n <N>` that many, `--follow` keeps printing new ones |
| `workkit test [paths] [--filter=<text>]` | hands its arguments to this repo's `npm test`, run at the repo root, so the one recorder, npm's script shell, sees the run |
| `workkit tools` | prints every command this repo's suites name through `needs()`, one per line, sorted and unique, for a setup to install |
| `workkit convert [paths...]` | rewrites this repo's suites in the old shape in place onto Node's test functions, one `converted` or `left` line per file (`docs/tests.md` § The kit's runner) |
| `workkit prove` | `prove.js`, under a node at the kit's floor: the root suite on exactly the staged tree, in a copy outside the repo, recorded on green (refused with `CI` set), so a commit of it passes the gate while other work stays in the folder unstaged |
| `workkit supervise -- <command> [args...]` | `supervise.js`, under a node at the kit's floor: the command run detached under the supervisor, as the root suite runs, its output tailed to the call and kept in the run log; it exits with the command's code, or the code of a check's verdict (`docs/tests.md` § The checks) |
| `workkit watch [--end] [suite\|run\|<pid>]` | `watch.js`, under a node at the kit's floor: the call attached again to the live run, the suite's before the supervised one before the one narrowed run, or the one named (a narrowed run by its pid); `--end` asks the supervisor to end it, and with several runs live and no name it refuses, exit 2 |
| `workkit public intake` · `mirror <N>... \| --all` · `close <version> <N>...` | the public pairing, run from the private repo: `public/intake.js`, `public/mirror.js`, `public/close.js` (the `public/` row above); the triage drain runs the intake, `workflow:public-mirror` and the daily heal the mirror, the ship's close step the close |
| `workkit ship items` · `release <x.y.z> [--keep N,M]` · `watch <sha>` · `cut <x.y.z>` · `plan` · `publish` · `deploy` | the ship's steps, run by `workkit:ship`: `ship/items.js`, `ship/release.js`, `ship/watch.js`, `ship/cut.js`, `ship/plan.js`, `ship/publish.js`, `ship/deploy.js` (their rows above) |
| `workkit review covers` · `mark [full]` | the review tier and the review marker: `review/covers.js`, `review/mark.js`, under a node at the kit's floor |
| `workkit triage mark` | the triage marker: `triage/mark.js`, under a node at the kit's floor |
| `workkit checkpoint safe` | the checkpoint marker: `checkpoint/mark.js`, under a node at the kit's floor |
| `workkit proof red [--live] <path>... -- <command>...` | the verifier's red run: `proof/red.js`, under a node at the kit's floor |
| `workkit changelog lint <file> [flags]` | the CHANGELOG entry check: `changelog/lint.js` |

- **The commands that do work write a log**, one whole run per file, replaced by the next run (`lib/command-log.js`):
  - `setup` (every form), `update`, `doctor` and `publish` to `~/.workkit/logs/<command>.log`, since they may run outside any repo;
  - `ship items`, `release`, `cut`, `plan`, `publish` and `deploy` to `ship-<step>.log`, and `proof red` to `proof-red.log`, each placed as `logPathOf` places a log (`lib/run-paths.js`, `logs.dir`, [The two settings files](#the-two-settings-files)); outside a repo they write none;
  - `ship watch` keeps its `ci.log`, and `test`, `prove` and `supervise` their own logs; every other command writes none.
  - A file holds stdout and stderr as plain text, no color code and no spinner frame, and ends `workkit <command>: exit <code>`.
  - The call shows what it shows without the log: the same color and spinner, the same questions answered from its stdin, its own exit code. The one exception is a `gh` call with no sign-in, which offers none under a logged command (the `lib/command-log.js` entry).
  - A command run as a step of a logged one in the same call (`setup`'s and `update`'s publish) writes no file of its own; its lines are in the outer log.
  - A step that shows a secret or signs in (the token mint, the GitHub sign-in) runs on the terminal device, or on the call's own streams between marks the logger keeps out of the log, and the log holds one line saying so in its place (`secretStep`).
  - At a terminal `ship publish`, `ship deploy` and `ship cut` keep the terminal for npm, the deploy script and the ship hooks, and their log holds that line and the closing line; away from one they are logged whole.
  - A log is moved into place when its run ends, so a call cut off before then has no log of that run to read.

- `workkit setup --bot`:
  - It works in the repo it runs from, opted in or not.
  - At a keyboard it asks to install `workkit-agent[bot]` on the origin's owner as GitHub names it now (the canonical login, after a rename).
    - It opens the install page pre-selected on that owner, and polls until the install lands.
  - With no keyboard it warns with that page, as setup's This repo step does.
  - With the owner's id unreadable it warns the client's refusal, and opens nothing.
  - Not signed in, it says to run `workkit setup --login` first, and installs nothing.
  - Already installed, it prints the installed line and asks nothing.
  - It exits 1 unless the App ends installed.
- `workkit setup --home`:
  - It creates the private `<login>/workkit`, and makes `~/.workkit/tower` its clone.
  - Then it runs every later home step as setup runs it, asking nothing, with or without a terminal.
  - A stop before anything is written exits 1: no gh login, a repo it could not create, a clone that did not land.
- `workkit setup --cloud`:
  - It runs the gh login check, the engine's address, the `workkit` command and the `gh` shim (making `~/.local/bin`).
  - It sets npm's `script-shell`, and the kit's allow and ask rules in `~/.claude/settings.json`, as a human's `update` makes them.
  - Every other step is one `<step>: not applicable in a cloud session; <why>` skip line.
    - Those steps: the plugin, the schedule, the tower pointer, the home repo, the cloud brief's secrets, the sign-in, publishing, this repo's opt-in, the App's install.
  - It asks nothing, opens nothing and exits 0.
- `workkit update --auto`:
  - Off the cloud, it adds one warning line for a cloud secret that is missing or stale.
    - In a cloud session that step is one not-applicable line.
  - Off the cloud, it adds one when the machine is not signed in.
  - It says nothing about npm's `script-shell`.
    - Only a human's `setup` or `update` points npm at the wrapper.
    - An unset value is named by the commit gate's bounce instead.
- `workkit doctor`:
  - It reports on:
    - plugin, gh, the three links (the engine's address, the `workkit` command, the `gh` shim), npm's `script-shell`;
    - whether `~/.local/bin` is on PATH, and on Windows `workkit.cmd`: ``command: <file> is missing or differs; run `workkit update` `` when it is not the template's text;
    - the `git` shim: present and executable in the kit, and in a session the `git` the PATH finds first;
    - each of the kit's allow rules and ask rules missing from `~/.claude/settings.json`, and each retired one still in it;
    - schedule vintage, the roster count;
    - the tower clone's state (unset · absent · clone · other, plus ahead/behind/diverged);
    - whether that clone was written by a NEWER kit than this one;
    - whether the cloud brief's seeded runner still matches this kit, and the cloud brief's secrets;
    - the bot identity's sign-in, and whether `workkit-agent[bot]` is installed on this repo;
    - this repo's state and, in an enabled repo, its git commit hooks.
  - The hooks line is `git hooks: installed (<path>)`, or the warning `git hooks: not installed; run workkit setup`.
  - Every warning counts toward the closing tally, gh's included.
  - In a cloud session (`isCloud`, `lib/cloud.js`) some checks are each one not-applicable line, counted by nothing.
    - Those are the schedule, the home clone, its runner, the cloud brief's secrets and the sign-in.
    - The rest stay real checks.
- `workkit test [paths] [--filter=<text>]`:
  - A package.json with no `test` script is one error line and exit 1.
  - So is the verb started inside an `npm test`, where `workkit` should have been `workkit-core`'s bin.
    - That line is `workkit-core is not installed here: run npm install` (`docs/tests.md` § The kit's runner).
- `workkit tools`:
  - A `needs()` argument that is not a string literal is `✖ tools: <file>:<line>: needs() takes string literals only`, exit 1.
  - An argument to the verb exits 2.
  - It runs the kit's own `packages/core/bin/workkit.js` with the command's Node at the repo root, never the repo's installed package.
    - So it answers before `npm install`.
  - No `workkit-core` beside the engine is one error line and exit 1 (`docs/tests.md` § The kit's runner).
- `workkit convert [paths...]`:
  - It runs the kit's own `packages/core/bin/workkit.js` with the command's Node at the repo root, through the one helper `workkit tools` runs through too (`runCoreBin` in `workkit/commands.js`), its paths read from there.
  - A path naming no suite is `No suite matches <arg>`, exit 1, before any file is touched.
  - No `workkit-core` beside the engine is one error line and exit 1.
- **Upkeep is automatic.** Claude Code has no plugin-install hook, so the trigger is the one this kit owns.
  - The `workflow:standards` SessionStart hook's once-per-day run calls `workkit update --auto`.
  - It starts `node <engine>/workkit.js update --auto`, resolved beside the engine, never through the PATH or the symlink, which are exactly what may not exist yet.
  - A moved kit needs nothing, since the schedule reaches its job through the engine's address.
  - A job template that changed is corrected the next morning, instead of waiting for someone to remember the installer.
  - Two boundaries keep that safe:
    - **It only ever UPDATES a schedule a human already installed**: the installer's `--check` saying `not installed` is the one reading of the marker, the installed plist on a Mac and the kept copy of the task file on Windows. A machine with no schedule never gets one at session start.
    - **It creates no convention it did not find.** `~/.local/bin` is linked when the directory already exists; making it is a human's `setup`, or in the cloud `setup --cloud`'s or `standards.js --command-link`'s. The same restraint the engine's address shows toward `~/.claude`.
- **Setup is pestered for, never performed.** The same hook checks one thing above every gate it has: `~/.local/bin/workkit`, the command `setup` installs.
  - While that is missing (absent, dangling, or not executable), EVERY session is told to run `node <engine>/workkit.js setup` itself before other work, or `node <engine>/workkit.js setup --cloud` in a cloud session.
    - That holds in a participating repo or no repo at all.
    - The session hands the user only what it prints.
  - There is no daily cache, because a machine without setup has no schedule, no home repo, and no command.
  - The pester stops the moment the link exists, whoever made it.
  - `standards.js --command-link` makes the command link alone, for a bootstrap that runs no setup at all.
  - A cloud bootstrap that does run setup calls `workkit setup --cloud`, which makes the link itself.
  - It never runs anything itself.
- The drift question is answered by `jobs/install.js --check`, which renders and compares without asking a scheduler anything.
  - Most session starts never get that far: the hook's daily marker returns first.
  - The once-a-day run that does costs a few short shell invocations, and on a Mac a `plutil` lint, with no scheduler call and no network.
- Agents themselves never issue launchd or `schtasks` commands. Their path is `workkit doctor`, which reports and fixes nothing.

## Output

- One voice for everything the engine, the jobs and the tower say to a person:
  - a GLYPH says what kind of line it is;
  - the `task:` the line belongs to is bold;
  - the steps sit indented under the title or the section that opened them.
- `workflow/lib/voice.js` is its one home, which the command, the heal, the jobs and the tower's logger (`tower/api/lib/log.js`) build their lines from.
  - Its `colorOn(stream)` is the one color gate, which `workflow/lib/attach.js` requires for a run's terminal view.
  - The wait line is `lib/spin.js`'s, and the questions are `lib/flows.js`'s.

| Call | Opens with | Color on a terminal | Stream | Quiet |
|---|---|---|---|---|
| `title('<emoji> workkit setup in <dir>')` | the caller's emoji | bold | stdout | silent |
| `section('<emoji> This machine')` | a blank line, then the caller's emoji | bold cyan | stdout | silent |
| `ok('task: message')` | `✓` | glyph bold green, `task:` bold, message plain | stdout | speaks |
| `skip('task: message')` | `·` | the whole line dim | stdout | silent |
| `info('task: message')` | `›` | glyph cyan, `task:` bold, message plain | stdout | silent |
| `warn('task: message')` | `⚠` | glyph and message yellow, `task:` bold yellow | stderr | speaks |
| `warnLines('task', 'task: message')` | `⚠` on each non-blank line, each prefixed `task:` | as `warn` | stderr | speaks |
| `error('task: message')` | `✖` | glyph and message red, `task:` bold red | stderr | speaks |
| `done('message')` | `✨` | bold green | stdout | silent |
| `spin(message, run, { line })` (`lib/spin.js`) | a braille frame, or `⏳` off a terminal; with `{ line: false }` no `⏳` line | frame cyan, message plain, `(Ns)` dim | stderr, or the logged command's terminal device | the static form is silent |
| `enterToOpen(url, label, what)` (`lib/flows.js`) | the prompt, then `URL:` and a green `?` Enter gate | URL cyan, the no-browser line dim | stderr | speaks |
| `openUrl(url)` | nothing when an opener runs; else the no-browser line | dim | stderr | speaks |
| `askYes(prompt, 'y' \| 'n')` | the prompt, then `[Y/n]` or `[y/N]` by the default | plain | stderr | speaks |
| `poll(message, seconds, check)` | the dim `(enter)=check now, (s)=skip` hint, then a braille frame counting down, or `⏳` off a terminal | frame cyan, message plain, `(Ns)` dim | stderr, or the logged command's terminal device | speaks |

- The `task:` is the first word of a message that reads `<word>: <rest>` (`engine:`, `command:`, `schedule:`, `gh:`, `site:`).
  - The renderer splits it off and paints it.
  - A message with no such opening prints as it is.
- A level line carries its glyph and nothing else.
- A title, a section and the closing line carry an EMOJI the caller picks for what that part of the command does.
  - One per section name, the same one wherever that section appears.
- A command opens with its title, groups its steps under sections, and closes on the answer to "is there anything for me here?".
  - `done` when there is not, and a `warn` naming the count when there is.
- `title` and `section` set the two-space indent every level line under them carries, for their own process alone.
  - A program that prints neither (`standards.js`, `note.js`, the jobs) sets `WK_LOG_INDENT` itself, takes its caller's, or stays flush left.
- Color is a terminal's affordance and nothing else's. `colorOn` in `lib/voice.js` is the one gate.
  - It says no to a pipe, to `NO_COLOR`, and to a `dumb` TERM.
  - So a log file, a captured hook payload and a piped run get the same glyphs and the same words with no codes, byte for byte.
  - `WORKKIT_COLOR=1`/`0` overrides the tty question either way, which is how the suites read the styled shape back.
- Two variables bend the rest, and nothing else does.
  - `QUIET=1` in the caller, or `setQuiet(true)` in the process, silences the lines that only report, which is what `update --auto` and the session-start heal lean on.
  - Under quiet an action, a warning and a stop still speak.
  - `WK_LOG_STDERR=1` puts every level on stderr, for a caller whose stdout is a MACHINE answer (`standards.js --state`).
- A line relayed from another part of the kit goes through `plain` first, which takes the colors, the indent and the glyph off.
  - So the relay re-says it under its own glyph, rather than letting a line wear two.
- **A spinner on every awaited call.** `spin(message, run, { line })` in `lib/spin.js` wraps each awaited call and hands back what `run` answers:
  - each `gh` call, each `git clone` / `fetch` / `pull` / `push`;
  - the publish build, the Pages poll and the launchctl and `schtasks` waits.
  - On a terminal it animates omega's braille frames, with the elapsed seconds beside them, and erases the line when the call returns.
  - A worker thread draws the frames, so they move while the caller's thread waits in a sync call; the line is cleared before the answer reaches the caller.
  - It draws frames with `WORKKIT_SPIN=1` always, with `WORKKIT_SPIN=0` never, and otherwise only on a terminal: a suite sees the frames with no terminal through `WORKKIT_SPIN=1`.
  - Anywhere else (a pipe, a log file, a scheduler, the suites) it prints `wait(message)`'s one line, `⏳ <message>...`, once on stderr, nothing under quiet.
  - `{ line: false }` prints no `⏳` line when no frames draw, for a call whose stderr is sent away; the frames still draw.
  - Every slow call of home, publish, the build and the command goes through it, and so does the heal's read of the default branch (`standards/labels.js`). The poll's countdown (`poll` in `lib/flows.js`) draws through the same frames.
  - `wait(message)` alone prints only the static line, once, at a terminal too; its caller then runs the command.
  - The publish's `--quiet` is `setQuiet` of `lib/voice.js`: quiet for the publish's own process, never in the environment of a program it starts.
  - Under a command log the frames go to the terminal device the logger names (`WK_COMMAND_TERMINAL`), never into the log, and the poll's countdown does the same (the `lib/command-log.js` entry).
- Two things are deliberately not log lines:
  - a PROMPT (it carries no newline, because the answer is typed on it);
  - a program's stdout that is DATA (`standards.js --state`, the slug and the reason `jobs/brief-dispatch.js` hands `workkit brief`, a JSON payload).
- `jobs/install.js --check` is neither: its drift lines ARE glyph lines.
  - The caller reading them (`workkit update`) strips each one with `plain`, and re-says it under its own.
- Three things print plain glyphless lines by design:
  - The kit's own hooks, whose output is context for an agent rather than a terminal.
  - The engine's Node CLIs (`changelog/lint.js`, `changelog-links.js`, `release.js`, `cut.js`, `plan.js`, `publish.js`, `deploy.js`, `site-repos.js`), whose lines are read by CI, by a hook bounce or by the ship.
  - And the CHILDREN a command runs (`omega` under the tower, `npm` under the publish), which speak as themselves.

## The capture CLI

- `workkit note`, whose program is `note.js`, gets a thought out of a head and into a capture file with no session, no agent, and no network:

```sh
workkit note fix the tower poller
```

- The words after `note` join with spaces, so the call works unquoted.
- The bullet lands in the capture file of the repo the shell is standing in.
  - A walk UP from the current directory decides it, to the first ancestor that passes both tests:
    - it is a git repo root (a `.git` directory or file);
    - its `.workkit/settings.json` says the repo participates (`settingsOptedIn` in `hooks/mods/gate.js`), and its `.workkit` is not the machine folder.
- Standing outside one, there is no capture file to write to.
  - The note is filed as a `status:inbox` issue on the home repo instead.
  - Where there is no clone yet (or no way to reach GitHub), it hands the note back on stderr and exits 1.
  - It does so rather than buffering a thought no triage run reads.
- A missing capture file is created from `templates/capture.md`, so a hand-made file reads exactly like a seeded one.
- Existing content is only ever appended to.
- No words, or a note of blanks alone, prints `usage: workkit note <text...>` and one line of what it does on stderr, and exits 1.
- A note with bytes that are not UTF-8 keeps U+FFFD in its capture line and issue body; the issue's title drops them.
- Triage drains the capture files into issues.
  - The captures made outside a project are issues already, and triage's HQ pass drains those from any repo.
- It is reached through the one command, `workkit note`, which `workkit setup` links onto `~/.local/bin`.

## The CHANGELOG entry format

- An entry is one short paragraph pointing at the depth, never a second copy of the commit body.
- It is written during ordinary work as `- [#4](../../issues/4) - What changed.`
- The commit link and `Thanks [@who]!` are filled in at release time by `changelog-links.js`.
  - It matches entries to commits through the closing trailer they already carry (`Fixes #N`, or any keyword the commit gate reads).
- An entry written with its handle already in place keeps that one.
  - The backfill adds an attribution only where there is none.
- The rules and the reasoning live in [`docs/project-state.md`](../docs/project-state.md) → "CHANGELOG entries".
  - `changelog/lint.js` is where they are executable.
- The two guarding hooks run only where the plugin is installed.
  - So the format is also checked in CI, which every author passes through.
- The kit publishes a reusable workflow, `.github/workflows/changelog.yml`.
  - It checks the kit out beside the calling repo, and runs its `changelog/lint.js` over the caller's `CHANGELOG.md`.
  - It runs in the mode its header gives a push and a pull request.
- A participating repo's `changelog` job is the one line `uses: itw-creative-works/workkit/.github/workflows/changelog.yml@main`.
  - So no repo carries a copy of the linter, and a change to it reaches every repo on its next run.
- The heal removes a linter copy at `.github/changelog-lint.cjs` or `.js` whose line 2 carries the kit's `// Vendored` header.
  - A file without it, or one a workflow still runs, is reported and kept.
- It rewrites a `changelog` job that still runs such a copy into the one-line form.
- It swaps a retired header paragraph for the template's wherever it is found, even above a job already in that form.
- Both changes are left unstaged for the owner to commit.
- A repo with no `CHANGELOG.md` passes cleanly.

## Every heal runs

- Nothing in a repo records which heals it has had.
  - Every heal is idempotent, so `standards.js` runs all of them on each daily heal.
  - A heal with nothing to do writes nothing.
- A `version` key an older kit left in `.workkit/settings.json` is removed by the heal (`removeVersionStamp`, `standards/state.js`), the file otherwise untouched.
  - A failed edit warns, leaves the file as it was, and flags the run.
- What a script must not decide alone is the `workkit:migrate` skill's own scan, run when someone asks for it:
  - `PROGRESS.md`, `INBOX.md`, `TODO.md` and `plans/`, each still holding work items nobody migrated;
  - and a `CHANGELOG.md` history outside the entry format.
- The format of new entries stays judged at the edit, at the commit, in the root `npm test`, in CI and at the ship.

## The hook layer self-check

- Every hook but the three `tool.call` guard chains fails open by design.
  - A chain that crashes refuses the call: `docs/hooks.md` § Failure.
  - So a module that cannot load, or a missing tool, takes a safety layer offline with nothing watching.
- Once a day, the heal asserts the layer beside it (`workflow/standards/hooks.js`).
- The hooks module is loaded the way Claude Code loads it: `node --input-type=module` imports `hooks/register.js` by its file URL.
  - That pulls in every module under `hooks/mods/`.
- A module that fails to load warns `hooks: the hooks module fails to load:`, and marks the run unfinished.
  - The warning carries node's first stderr line that opens with an error name and a colon (`SyntaxError:`, `Error [ERR_MODULE_NOT_FOUND]:`).
  - Else it carries node's first stderr line.
  - No `register.js` beside the engine, or no `node`, checks nothing there.
- The tools the module and the guards in the shims call must be on the PATH: `HOOK_TOOLS` in `standards/hooks.js` (`jq`, `git`, `node`, `shasum` or `sha1sum`).
  - A missing one warns just as loudly, but never marks the run.
  - No repo can install it, and an unfinished run, retried every session, would nag forever.
- The summary line reads `hooks: the hooks module loads`.
- An engine installed with no hook layer beside it (no `hooks/hooks.json`) checks nothing and says nothing.
  - `WORKFLOW_HOOKS_DIR` overrides the location.

## The two settings files

- Same filename, one mental model, two owners, over one set of defaults.
  - The kit's `defaults/settings.json` holds every key with its default value.
  - Every reader sees the defaults, then the global file, then the repo's, merged key by key.
  - Where: `docs/project-state.md` § The model; `loadSettings` in `hooks/mods/settings.js`, `wk_setting` in `lib/participation.sh`.
- `enabled` is the one key read from the repo's file alone, default `false`.

| File | Owner | Holds |
|---|---|---|
| `<repo>/.workkit/settings.json` | the project (committed) | `{ "enabled": true }`: the repo's yes, the only one |
| `~/.workkit/settings.json` (`$WORKFLOW_HOME` overrides) | one developer, BY HAND | Seeded `{ "version": 1 }`, holding no setting |
| `~/.workkit/.repos.json` | the engine | `{ "version": 1, "repos": { "<absolute repo root>": "enabled" \| "declined" } }`: the machine's roster and this developer's declines |
| `~/.workkit/.cache.json` | the engine, disposably | `{ "homeCache": { … } }`: the cached GitHub node ids, and nothing else since the upstream-news cursor moved onto the board. Safe to delete: every reader rebuilds what it does not find |

- **`<repo>/.workkit/settings.json`**, the project's file:
  - `"enabled": false` is the project's deliberate no.
  - A file with no `enabled` key is off and offered.
  - An optional `"proof": { "rootOnly": ["<folder>"] }` names the packages the root run alone proves (`docs/project-state.md` § The proof).
  - An optional `"findings": { "file": true }` overrides the global key of that name for this repo, `false` included.
  - An optional `"commit": { "attribution": false }` has `safety:commit-attribution` refuse a commit message carrying a Claude attribution line (`docs/hooks.md` § `safety:commit-attribution`).
    - It is read over the global key of that name, and absent from both it reads as the kit default, `true`.
  - An optional `"docs": { "bullets": true }` has `docs:board-guard` refuse a write that leaves a doc with more paragraph lines, or more lines over 400 bytes, than its copy in the git index (`docs/hooks.md` § `docs:board-guard`).
    - It is read over the global key of that name, and absent from both it reads as false.
  - An optional `"docs": { "paths": ["<path>"] }` names the docs that check judges, paths from the repo root.
    - Its entry forms and the kit default are `docs/hooks.md` § `docs:board-guard`.
    - It is read over the global key of that name, and absent from both it reads as the kit default.
  - An optional `"tests": { "budget": <minutes> }` is how long the root `npm test` may take before the commit gate says so (`docs/tests.md` § The budget).
    - It is read over the global key of that name.
  - An optional `"tests": { "check": <minutes> }` is the time between a supervised run's checks (`docs/tests.md` § The checks).
    - It is read over the global key of that name, and absent from both it reads as the kit default, 5.
  - An optional `"logs": { "dir": "<folder>" }` names the folder this repo's logs go to, a path from the repo root, so a repo can keep them in its own `logs/` (`logDirOf` in `hooks/mods/commit-gate.js`).
    - It is read over the global key of that name, and absent from both, or empty, it reads as the kit default, `.workkit`.
    - Where a log is written, and the line a bad value stops the command with, are the `lib/run-paths.js` entry's.
  - An optional `"hooks": { "<event>": [{ "command": "<shell command>", "local": true }] }` declares the ship hooks for `afterRelease`, `afterPublish` and `afterDeploy`.
    - `workkit ship cut`, `publish` and `deploy` run them from the repo root once their step succeeds.
    - They run only where this file says `"enabled": true`.
    - An entry's optional `"local": true` marks one that needs a machine, which a cloud session skips with its line (`ship/hooks.js`).
  - The same shape under `"ciSetup"` and `"ciPostInstall"` is the repo's own CI setup, which the ship never runs.
    - The kit's `ci.yml` runs each `ciSetup` entry on the runner before the dependency install, and each `ciPostInstall` entry after it and before the tests, skipping a `"local": true` one.
    - Where: `.github/scripts/ci-hooks.js <event>`, through the one entry check in `ship/entries.js`.
  - An optional `"public": "<owner>/<repo>"` pairs this private repo with the public one its users file issues on (`docs/project-state.md` § Capture).
    - The heal makes the `status:` labels there and mirrors each linked issue's status.
    - The `gh` shim posts there as the bot, and `workkit public` runs the intake and the close.
    - workkit-agent[bot] must be installed on the public repo's owner too, or every public write is refused.
    - To install it: `workkit setup --bot` in a clone of the public repo, or the install page.
    - A value that is no slug is a heal warning, and the pairing stays off.
- **`~/.workkit/settings.json`**, the developer's file:
  - Every absent key reads the kit's default.
  - Any key set here holds for every repo that sets none.
  - Its `enabled` turns no repo on.
  - `{ "site": { "repo": "<owner>/<repo>", "publish": null, "url": null } }`: the site options.
    - They are the home repo the site publishes from, the all-or-nothing publish switch, and the custom domain.
    - An absent key reads as off and as no URL.
  - An optional `"identity": { "tokenUrl": "<url>" }` points the bot identity's client at another token service ([The bot identity](#the-bot-identity)).
    - Absent reads as the hosted one, `https://workkit.itwcreativeworks.com/token`.
  - An optional `"findings": { "file": true }` has an agent file each finding outside the issue in hand as a `status:inbox` issue rather than say it in chat.
    - Absent reads as false, and the repo file's key wins (`docs/project-state.md` § How big is one issue).
  - An optional `"commit": { "attribution": false }` refuses a Claude attribution line in the commit messages of every repo that sets none (`docs/hooks.md` § `safety:commit-attribution`).
    - Absent reads as true, and the repo file's key wins.
  - An optional `"docs": { "bullets": true }` turns the markdown shape check on for every repo that sets none (`docs/hooks.md` § `docs:board-guard`).
    - Absent reads as false, and the repo file's key wins.
  - An optional `"docs": { "paths": ["<path>"] }` is the doc set that check judges for every repo that sets none.
    - Absent reads as the kit default (`docs/hooks.md` § `docs:board-guard`), and the repo file's key wins.
  - An optional `"tests": { "budget": <minutes> }` is the root run's budget for every repo that sets none (`docs/tests.md` § The budget).
    - The repo file's key wins.
  - An optional `"tests": { "check": <minutes> }` is the time between a supervised run's checks for every repo that sets none (`docs/tests.md` § The checks).
    - Absent reads as the kit default, 5, and the repo file's key wins.
  - An optional `"site": { "sidebar": [ { "header": "<label>", "links": [ { "label", "href", "icon" } ] } ] }` adds the user's own link groups to the published dashboard's nav.
    - Each publish's build writes every group, as a header row and then its links, after the built-in groups of the clone's `sidebar.json`.
    - That file is rebuilt from the app's copy, so a group is never held twice.
    - Absent leaves the app's nav as it ships.
    - A value that is not such a list is the warning `sidebar: site.sidebar is not a list of groups; the built-in sidebar is published`, and the built-ins still build.
    - The central copy never reads it.
  - `publish` defaults to NULL, the unanswered state: `true`/`false` are answers.
    - An interactive `workkit setup` asks for one once there is a home repo to publish from.
  - `url` is asked for only in the same breath as a FRESH yes, and is a hand edit ever after.
- **`~/.workkit/.repos.json`**, the engine's roster:
  - The key is the root in GIT's spelling (`git rev-parse --show-toplevel`, so `C:/Users/x` on Windows).
  - It is never the shell's mount form (`/c/Users/x`): one repo, one key, whichever side wrote it.
  - `wk_native_path` in `platform.sh` is that spelling's one home, and every write and every lookup goes through it or its Node twin, `nativePath` in `lib/platform.js`.

- The three are split by WHO WRITES THEM.
  - Anything a human types is in `settings.json`.
  - Anything the engine records is in a dot-named file beside it.
    - That is how a reader knows at a glance that editing it is pointless.
  - `settings.json` has one machine-written key (`site.repo`, which `workkit setup` records once).
    - Nothing else in it is ever written by a run.
- Never-asked and declined are personal, not project facts.
  - A teammate seeing `enabled: false` in a shared repo would read it as the project declining.
  - In fact it was one developer undecided.
  - Only a real yes belongs in the repo.
- **The roster**: every heal (and every `--enable`) records the repo it is standing in under `repos` in `.repos.json` as `"enabled"`.
  - It drops any listed path that has gone away, lost its committed file, or whose committed file no longer says `"enabled": true`.
    - A file that cannot be read as JSON is excepted.
  - The registration takes the same `~/.workkit/.state.lock` mutex a decline does.
    - So does every other writer of the machine's files, the home slug and the cached GitHub node ids among them.
    - Each takes it through `takeLock` (`lib/lock.js`) at `stateLockPath`.
    - So sessions opening at once in several repos all land on the roster.
  - A `"declined"` entry is a decision and is never pruned.
  - The list is an INDEX, not the answer: the committed per-repo file stays the SSOT of membership.
    - It is what the tower reads instead of walking a filesystem root.
    - So a repo this machine has never opened is simply not on its dashboard.
  - Registration is silent; `workkit doctor` reports the count.
- **The home repo**: `site.repo` names the private GitHub repo whose issues hold the work that belongs to no single project.
  - That is the cross-project and business queue, and the nursery for projects that do not exist yet.
  - Unset, triage says so and leaves global entries where they are.
  - Full doctrine: `docs/project-state.md` § The global layer.

## The home repo's lifecycle

- `~/.workkit` is a plain folder, and the ONE git repo in it is `~/.workkit/tower`.
  - It is the home repo's clone, and the tower dashboard as a real project.
- `workkit setup` is the only thing that makes it.
- `home.js`, through the steps it requires from `home/`, is where each step lives; the command starts each verb of it as a program (`homeRun` in `workkit/kit.js`):

1. **The login**: `gh api user`. Without one, setup prints `gh auth login` and moves on; nothing is guessed.
2. **The repo**: one confirm line, then `gh repo create <login>/workkit --private`.
   - Without a terminal setup asks nothing and creates nothing. It prints ``home: no home repo is configured; `workkit setup --home` creates the private <slug> and makes <clone> its clone``.
   - `workkit setup --home` skips the confirm, at a terminal or not.
   - A repo that already exists is the current one, never an error: a second machine finds the same home.
3. **The clone**: a plain `git clone` into `~/.workkit/tower`.
   - Nothing is ever converted or adopted: an absent path is cloned, and the right clone is a no-op.
   - ANYTHING else already there (a repo pointing elsewhere, a folder somebody made) stops the home steps with a warning naming what it found.
   - A repo GitHub just created is empty and clones with a warning git prints and this step swallows. That is the ordinary first-setup case.
4. **The seed**, only into an empty clone: this checkout's `tower/app` copied in whole, minus what a working checkout accretes.
   - What it leaves out: `node_modules` at any depth, the lockfile, `.omega`, `dist`, `.env`.
   - The project's own `README.md`/`AGENTS.md` travel with it, because the repo they land in is a real repo.
   - The clone is engine territory and carries nothing hand-written (no site options, no `.workkit/` of its own).
     - So the seed copies the two `@omega.js` npm pins as they are.
     - The one thing it adds on top of the copy is a `file:` spec, repointed at the ABSOLUTE path it resolved to from this checkout.
     - Only a maintainer tree in local mode carries such a spec.
   - When the kit is a git checkout the copy reads its COMMITTED tree (HEAD's `tower/app`, exported into a scratch folder).
     - So an uncommitted edit never reaches the clone.
     - A copy with no repo reads the folder itself.
     - The export is `git` alone (`ls-tree` and `cat-file --batch`, `exportOf` in `home/committed.js`): each file's bytes and its run bit kept, no line ending changed under `core.autocrlf`.
   - A clone another machine already seeded is left exactly as it is.
5. **The cloud brief's runner**: the workflow and the code it runs, copied in on EVERY setup rather than only into an empty clone.
   - `.github/workflows/brief.yml` comes from `templates/github-workflows/brief.yml`.
   - The rest lands under `brief/` with its checkout-relative subpaths intact.
     - Those are `brief/jobs/`, `brief/workflow/`, `brief/tower/api/lib/`, and `brief/tower/app/targets/web/src/assets/js/libs/tower/`.
     - The last is the shared sweep module `board.js` requires by relative path.
     - And `brief/hooks/`: the `hooks/mods/` files the runner requires (`markers.js`, `gate.js`, `settings.js`, `log.js`, `text.js`), with the `hooks/package.json` that loads them as modules.
     - So every relative address inside those scripts resolves in the clone exactly as it does here.
   - The list is `workflow/home/runner-files.js`, a plain list of `[source, destination]` pairs.
     - It is the starter `morning.sh` and the one file it sources (`workflow/lib/platform.sh`), the require closure of `morning.js` and of the `brief-payload.js` it starts, and the files those read (`defaults/settings.json`, `workflow/labels.json`, `hooks/package.json`).
     - Among them: the morning's steps under `jobs/morning/`, `jobs/lib/`, `brief-dispatch.js`, the `hooks/mods/` files they require and the `workflow/lib/` pieces, `lib/bounded.js` among them (the jobs' children run under it, through `jobs/lib/machine.js`).
   - It is copied by CONTENT: a file already identical is not rewritten, so a second setup writes nothing.
     - A checkout that moved on is healed and pushed as its own `chore(home): refresh the cloud brief runner` commit.
   - Like the seed, it copies from the checkout's COMMITTED tree (HEAD, exported into a scratch folder) when a git repo tracks the kit.
     - So an uncommitted edit never reaches the clone.
     - A copy no repo tracks reads the folder itself.
   - The list is read from that same tree, the export's own `runner-files.js` (`runnerList` in `home/runner.js`).
     - So a list line edited on disk ahead of its commit can never disagree with the files it names.
   - A clone that already carries the project is first caught up with origin.
     - The catch-up is `pull --rebase --autostash`, the publish's own catch-up, `catchUp` in `home/install.js`.
     - So the runner refresh and the issue templates push onto the current tip.
     - A clone that cannot catch up is left unwritten: no runner refresh, no install, no heal. Discussions and Pages still run.
     - The next setup finishes the job.
   - The seed also SUBTRACTS: `brief/` is engine territory.
     - A file under it the list no longer names (what a rename left behind) is removed, and folders it empties with it.
     - The removal counts as a change, so it rides that same commit.
     - The removal waits while any listed file is missing from the committed kit.
     - So a committed list naming a file its commit lacks never strips a file the committed scripts still need.
   - **The daily morning writes it too**: `jobs/morning.js` runs this same step (`home.js seed-runner`) ahead of its dispatch.
     - So a `git pull` of this checkout reaches the cloud the next morning, rather than waiting for somebody to re-run setup.
     - It is a reconcile like the tower project's sync and the clone's heal.
     - Like them it creates and clones nothing, naming a skip where there is no clone.
   - `workkit doctor` is what still reports drift the last morning could not heal.
     - It compares the same list file by file against the same committed tree, and names `workkit setup` as the fix.
     - It never writes or pushes, and an unreadable clone or checkout is a named skip.
     - A listed file missing from the committed kit is named instead, with the line that the retired files wait until the kit is whole.
     - That is because the prune waits on it, and `workkit setup` cannot clear them.
   - The workflow lives here because the plugin repo is distributed to everyone who installs the kit.
     - A consumer cannot set secrets on a repo they do not own.
6. **The install**: `npm install` in the clone, so the daily publish has something to build with.
   - It runs on BOTH clone paths (unless the clone could not catch up, step 5).
     - A project that travelled from another machine arrives without its `node_modules`.
   - A tree that already carries `node_modules/.bin/omega` is a skip, so re-running costs nothing.
   - Absent tooling is an honest warning naming what did not install, never a failure.
7. **Discussions**: enabled through the GraphQL API (`lib/discussions.js`).
   - No `gh` is the skip `home: Discussions need gh; skipped`.
   - The four categories (Daily, Weekly, Monthly for the summaries, Brief for the digest) are CHECKED, never created.
     - GitHub has no `createDiscussionCategory` mutation.
   - At a terminal, setup names the missing ones and opens the page that makes them on Enter.
     - Then it polls every five seconds until they are there, Enter checking now and `s` or a closed stdin skipping.
     - This is omega's walkthrough shape, `enterToOpen` and `poll` in `lib/flows.js`.
   - A piped run, or a skip, prints the pointer at the page.
     - The summaries and the brief publish in the repo's default category until it exists.
8. **Pages**: `POST repos/<slug>/pages` for branch `gh-pages`, path `/`.
   - The branch need not exist yet; the first publish makes it.
   - A refusal (a private repo on a plan without Pages) warns with the fix and setup carries on.
9. **The first commit**: `chore(home): seed the tower project`, pushed.
10. **The publish question**: setup built the whole publish path, so it asks the one thing left.
    - The question: publish the dashboard site to GitHub Pages? `[y/N]`, empty is no.
    - The answer is written to `site.publish` under the same state mutex every writer of that file takes.
    - It is asked ONCE: `true` and `false` are both answers and are never asked again.
      - Only the unanswered null (or no key at all) has a question left.
    - No home repo, no terminal, no settings file, a kit with no `home.js`, or a settings file that does not parse: a named skip.
      - It is a warn for the unparseable file, and an info line naming the hand edit without a terminal.
      - Either way it leaves the switch unanswered and the file untouched, so a later interactive setup asks.
11. **The domain, on the fresh yes only**, and only while `site.url` is null: custom domain for the site? Enter for none.
    - Empty leaves `site.url` null, which is the plain github.io address and no CNAME.
    - Anything typed is written to `site.url` under the same mutex, taken at its word.
      - `siteHost` in `home/options.js` is the one reader of the option, which the command reaches as `node home.js host`.
      - It takes a scheme and a trailing slash off, for the CNAME and for the token handover alike.
    - It rides the fresh yes because that is the one moment nothing is serving yet.
    - A machine that answered on an earlier run changes its domain by hand edit.
12. **The publish**: when the switch ends on, freshly answered or already true, setup runs the publish.
    - It is the same call a human's `workkit update` makes.
    - It comes after the domain question, so the first site already carries its CNAME.
    - Off, unanswered, or a question step that skipped adds no call at all.
      - `publish.js`'s own gate stays the single owner of that refusal.
    - A re-run simply republishes, like every other step here.

13. **The token handover**: a published copy is LOCKED until a token reaches its Settings page, and GitHub mints none through an API.
    - So setup hands over the one this machine already holds, instead of leaving a paste to do.
    - It waits for Pages to serve the commit the publish pushed.
      - It polls `pages/builds/latest` every 5 seconds, up to `WORKKIT_PAGES_WAIT` seconds, default 180.
    - It reads `gh auth token`, and opens the site's Settings page with that token in the URL FRAGMENT.
    - The address is composed the way the publish composes its path prefix.
      - That is `site.url` when one is set, the `https://<owner>.github.io/<name>/` default otherwise.
    - The token is never an ARGUMENT, because `open` puts one in `ps`.
      - And `xdg-open` leaves one in a browser's argv for that process's life.
    - It travels in a `mktemp` page, chmod 600 before a byte is written.
      - The page is renamed `.html`, so the opener hands it to a browser.
      - It is removed at exit after three seconds of grace, since the browser reads it asynchronously.
      - Any leftover from an interrupted run is swept first.
    - A fragment is the one part of a URL a browser never sends to a server.
      - That is why it is the carrier and `?` never is.
      - The page stores the token where a typed one goes, and strips it from the address bar.
    - Every ending is a NAMED SKIP and setup carries on.
    - Most of them print the Settings URL WITHOUT the fragment, since that is where the same handover is done by hand:
      - no opener (`open` on macOS, `xdg-open` elsewhere);
      - no readable `gh-pages` head;
      - a Pages build that errored;
      - a wait that ran out;
      - a login with no token to give;
      - and three reads of the latest Pages build that came back with nothing.
        - This one carries the repo's own Pages settings page as well.
        - That condition is either Pages switched off or GitHub unreachable.
    - Two endings point somewhere else instead:
      - a `site.url` that cannot go in a URL at all names the settings file to fix;
      - a publish that did not finish names no URL.
        - A token handed to a publish that never landed is a token handed to a stale site.
    - Only `setup` does this, on the publish it just made: never `update --auto`, never `workkit publish` on its own.
    - A TERMINAL is not among the conditions: setup is a human's act or the SHIP's.
      - A ship whose diff touched the setup surface runs `workkit setup` itself once the work commit's CI is green.
      - So the handover happens on a piped run exactly as it does at a terminal.
      - Every skip it prints rides the ship summary (`skills/ship/SKILL.md` Step 7).
    - The ramification of handing a CLI login to a browser is stated where the token itself is documented: `tower/README.md`.

14. **The clone's own heal**: `heal` in `home/install.js`, the home repo brought to the same standard every participating repo is brought to, by the same code.
    - `standards.js --home` runs `ensureIssueForms` and `syncLabels` (`standards/`) against the clone and nothing else.
      - So the home repo has the labels every queue reads and the forms that apply them.
      - Without them, a capture filed from a phone lands unlabelled and invisible.
    - It is scoped to those two because the clone is engine territory: no `.workkit/`, no opt-in, no local files.
    - The heal starts the committed kit's `standards.js` with the running Node, from its own HEAD export of the same commit the runner reads, and starts no `bash`.
      - For a copy no repo tracks, it runs from the folder itself.
      - So the templates and labels it installs are HEAD's, and an uncommitted template edit never reaches the clone.
    - The mode REFUSES any directory that is not the clone, so it can never write into a repo that never said yes.
    - The forms are files, so they are committed and pushed as `chore(home): install the issue templates`.
      - That happens only when the forms themselves changed.
      - So the second run writes nothing, commits nothing and pushes nothing.
    - The labels are a remote write and leave the tree alone.
    - No clone, an export that failed, a missing heal, or a push that did not land is a named warning and exit 0.

- **The seed never downgrades**: steps 4 and 5 and the daily publish's sync all write content THIS checkout owns over the clone's.
  - So two machines seeding one clone race, and the winner was simply whichever ran last.
    - That is how a machine on an older kit put a month-old runner and a pre-rename app back on the home repo three mornings running.
  - So each of those writers stamps the kit version from `.claude-plugin/plugin.json` into the first line of `.workkit-version` at the clone's ROOT.
    - The lines after it are the app's top-level folders the sync last wrote, the list the next sync retires from.
    - The stamp goes in the same commit as the content it describes.
  - Each one reads that stamp before it writes.
    - A clone stamped NEWER than this checkout is left exactly as it is.
      - Nothing is written, nothing committed, and one line names both versions and `workkit update` as the fix.
    - An equal, older or absent stamp (every clone made before this) is seeded exactly as it always was.
  - The compare is `compareVersions` (`ship/semver.js`), numeric field by field, so 0.9.0 is OLDER than 0.48.1, and a prerelease sorts below its release.
    - A version neither side can read never refuses anything.
  - `workkit doctor` reports the same condition with the same fix.
  - The version is the committed manifest's: HEAD's `.claude-plugin/plugin.json`, read through `file` in `home/committed.js`.
    - For a copy no repo tracks, it is the disk's.
    - So an uncommitted version bump is never stamped, and the downgrade check agrees with the bytes the writers copy.
- Every step is idempotent and the whole sequence is safe to re-run.
  - A second setup finds the clone and reports rather than acting.
- Afterwards the heal owes the global layer nothing but the machine roster.
  - The clone itself is never healed by a SESSION, because nobody ever opens one in it.
  - That is why step 14 is the engine's own call, and why the daily publish makes it again.
- **Two shapes the API forced, both proved against the live schema**:
  - Discussion **categories are checked and fallen back on**, not created, because no mutation exists to create one; setup walks the owner to the page instead.
  - The Pages source path is `/` or `/docs` and nothing else (`"enum":["/","/docs"]`).
    - That is why the site is served from the ROOT of its own branch, rather than from a folder named for the rule.

## The cloud brief's secrets

- The morning brief runs on a GitHub Actions runner, from the workflow step 5 seeded onto the **home repo**.
  - So the two secrets it needs live there too, on the slug in `~/.workkit/settings.json`.
  - That is also the slug the daily job's dispatch gates on.
- Not on this checkout's own repo: the plugin is distributed to everyone who installs the kit.
  - A consumer cannot set secrets on a repo they do not own.
- Setting them by hand was the last manual step of a from-zero install, so `setup` wires them:

| Value | What setup does |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | absent, or last set more than ~11 months ago (the token lives about a year) → a `[y/N]` offer to run `claude setup-token` |
| `WORKKIT_GITHUB_TOKEN` | absent → set zero-click from `gh auth token`, no prompt (maximum automation, and that login's broad reach is accepted). Present → left alone. It is the CROSS-REPO one, for the board sweep; the Discussion is posted with the workflow's built-in `GITHUB_TOKEN` and needs no secret. A name may contain `GITHUB_`: only a name that starts with it is refused |

- **`CLAUDE_CODE_OAUTH_TOKEN`**, the rest of its row:
  - A yes mints it and pipes it straight into `gh secret set`.
  - Without a terminal, or without a PTY tool (`expect` or `script`) for the mint to run under, Windows included, the two commands are printed instead.
    - The mint is a browser approval and cannot be automated.
  - Under a logged command the mint is a secret step: its screen is on the terminal device, or on the call's own streams between marks the logger keeps out of the log (the `lib/command-log.js` entry).
  - `workkit setup --token` forces that same mint at any age, for the token that went bad while it was young.
- **A token value moves through a pipe, through the mint's own capture file, and through the handover page of step 13, and nowhere else.**
  - The mint runs under a PTY: `claude setup-token` draws its ENTIRE screen on stdout.
    - That screen is the browser message AND the paste-the-authorization-code prompt that follows the approval.
    - So capturing that stdout left the human staring at a blank line, with no way to answer.
    - And in the CLI's raw keyboard mode, there was no way to quit.
  - Under the PTY runner the whole screen reaches the terminal.
  - The copy the token is read out of lands in a capture file in `TMPDIR` (the system temp folder when unset), made new and mode 600 before the mint writes a byte.
    - It is removed the moment it has been read, and on the process's exit, INT and TERM as well, so an interrupted mint leaves nothing behind.
  - From the extraction on, the value is held in one local on the way to `gh secret set`'s stdin.
    - It is never passed as an argument, echoed, or logged.
  - The pty is `runUnderPty` (`workkit/pty.js`): Node has no pty without a native dependency, so the system's `expect`, else `script`, gives one.
  - At a real terminal (the command's own stdin) with `expect` present, `workflow/workkit/mint-pty.exp` is the runner.
    - The CLI's raw mode discards the ^C byte itself, so the binding catches it one layer out.
    - Ctrl-C ends the mint like it ends any command, with 130, and every other keystroke still reaches the paste prompt.
  - Otherwise `script` runs it, with both syntaxes spoken, told apart at runtime by whether `--version` answers:
    - BSD/macOS `script -q -e <file> <cmd>`;
    - GNU/util-linux `script -q -e -c "<cmd>" <file>`.
    - `-e` is what returns the child's own status.
    - There Ctrl-C is forwarded to a CLI that ignores it, which is what the expect path exists to fix.
- Reading comes first and decides everything.
  - These are a NAMED SKIP, never a missing value: no `gh`, a kit with no `home.js` beside the engine, no home repo yet.
  - So is a `gh secret list` that did not come back as a JSON array.
  - A repo that could not be read must never send someone to mint a token that is already there.
    - It must never be written to either.
  - A secret's age is read in Node off the listing's `updatedAt` (`secretAgeDays`), and a timestamp that does not read is an age it cannot judge, never a stale one.
- The listing is bounded: `bounded` (`lib/bounded.js`) ends the whole tree of a read past its bound and answers 124.
  - The bound is `WORKKIT_GH_TIMEOUT` seconds, default 10; a value that is not a positive number reads as the default (`secondsOf`).
  - The reason: the daily `update --auto` runs them at session start.
    - A captive portal answers the handshake and never the request.
  - A bound that fires reads as an unreadable listing.
- Writes are not bounded: every one of them is on a path a human is sitting in front of.
- `workkit doctor` reports one line per value: set and fresh, missing, or stale, each with the command that fixes it.
  - It counts both toward its attention total.
- The daily `workkit update --auto` never prompts and never mints: at most one warning line per value.

## The bot identity

- The agent's issue bookkeeping posts as `workkit-agent[bot]`.
  - It is one GitHub App, registered once under ITW-Creative-Works and installed per account.
  - It is required on every repo the agent keeps books on, so the record tells the owner's acts from the agent's.
- Commits and pushes stay the owner's.

- **The shim decides who a `gh` call is**: `identity/gh` sits at `~/.local/bin/gh`, ahead of the real `gh`.
  - The real `gh` is the next `gh` on PATH after it.
  - Before it decides, every call passes its gate, `identity/gate.js`.
    - The exceptions are `gh auth` and a call under `WORKKIT_IDENTITY_OFF=1`.
    - The owner's own terminal calls and a cloud session's are included.
    - The leak scan runs always.
    - The label and filing gates run where `wk_session_judges` holds for the cwd's git toplevel (the `identity/gh` and `identity/gate.js` rows).
    - A bounce ends the call before any `gh` runs.
  - In a cloud session (`wk_is_cloud`: `CLAUDE_CODE_REMOTE=true`) it hands every `issue`, `label`, `auth`, `pr` and `release` call to `identity/rest.js`.
    - The repo is resolved as below, and it fetches no token.
    - Every other verb runs the real `gh` with the resolved repo as `GH_REPO`, whatever host the proxy origin names.
    - The session's GitHub proxy serves REST alone and signs every request as the account, so those calls post as the owner.
    - What `rest.js` serves is [`docs/cloud.md`](../docs/cloud.md) § gh in a session.
  - Outside a Claude session (`CLAUDECODE` unset) it runs the real `gh` untouched.
  - Likewise, in a session or out, it runs the real `gh` untouched for `gh auth …` always: `git-credential` for pushes, `token` for the cloud secrets, `status`.
  - Likewise for `WORKKIT_IDENTITY_OFF=1`, and for any call that is not bookkeeping.
  - Bookkeeping is a `BOT_VERBS` verb (`issue`, `label`, `pr`) with a subcommand that writes.
    - A verb with no subcommand, or with `-h`/`--help` anywhere after it, runs as the owner.
    - So does a read in `READ_SUBCOMMANDS` (`list`, `view`, `status`, `checks`, `diff`).
      - A read posts nothing, and the hooks and the heal depend on reads.
    - So do the owner's `pr` subcommands in `PR_OWNER_SUBCOMMANDS` (`create`, `merge`, `checkout`, `revert`, `update-branch`).
    - These are the three tables at the shim's top.
  - A bookkeeping call takes its repo from the first of these:
    - `-R`/`--repo`;
    - else `GH_REPO`;
    - else the first argument that is a github.com issue or pull request URL (a tail after the number allowed), whatever precedes it;
      - except inside a body or title flag's value (`--body`, `-b`, `--body-file`, `-F`, `--title`, `-t`), which is prose;
    - else the cwd's `origin`.
    - A flag or `GH_REPO` spelled as a URL or `github.com/owner/name` reads as `owner/name`.
  - Without `jq` the roster cannot be read, so such a call exits 1 naming it.
  - On the roster (`~/.workkit/.repos.json`, enabled) it runs the real `gh` with `GH_TOKEN` set to that repo's App token, for that one process.
    - Or it exits with the client's code and message.
    - Off the roster it runs as the owner.
  - A bookkeeping call on a rostered repo never runs with the owner's token.
  - The token travels in the environment, never in argv, and is fetched only after the gate has judged the call.
  - In a Claude session the last step (the owner's `gh`, the bot's, `rest.js`) runs as a child of the shim in place of an `exec`.
    - So a write that exits 0 leaves the gate's line in the gh journal of the cwd's repo (the `identity/gh` row).
    - `workflow:snapshot`, `workflow:public-mirror` and `docs:change-tracker` read that line in place of the command ([`docs/hooks.md`](../docs/hooks.md)).
- **Two tokens, two places**: the user's sign-in token comes from GitHub's device flow with the App's Client ID (`workkit setup --login`, `identity/login.js`).
  - It stays on the user's machine at `~/.workkit/identity/login.json` (the folder 0700, the file 0600).
  - It says who is asking.
  - The App's installation token is the one a bookkeeping call runs with.
    - It is minted by the token service for one repo, and is good for an hour.
    - It is cached by `identity/token.js` in `~/.workkit/identity/<owner>--<repo>.json` (the same modes).
    - It is reused while it has more than five minutes left.
  - The client reads the sign-in before the cache.
    - So a cached token outliving a removed `login.json` (the only sign-out) is never handed on.
  - The owner's keyring login is every call the shim passes through.
  - The three are never mixed.
- **The token service**: the client asks `POST <tokenUrl>` with `Authorization: Bearer <sign-in token>` and `{ "repo": "owner/name" }`.
  - The URL is the `identity.tokenUrl` setting, set in `~/.workkit/settings.json`.
    - Else it is the kit's default in `defaults/settings.json`, `https://workkit.itwcreativeworks.com/token`.
  - Every other reader takes a machine file that is not a JSON object as adding nothing; the client refuses it (`settings`).
    - It refuses an `identity` value the merge set aside the same way.
    - So a custom URL in a broken file never sends the sign-in to the hosted service instead.
  - The service checks, in order:
    - a bearer (else 401), and a body naming one `owner/name` (else 400);
    - the App's installation on the repo, asked as the App with a JWT its private key signs;
      - this comes first because a user token from a GitHub App sees only the repos the App is on;
    - the sign-in's push access to the repo, asked as the user.
  - Then it mints the installation token, scoped to that one repo with Issues and Pull requests write.
    - It answers 200 `{ token, expires_at }`.
  - Its three refusals:
    - 401 `not signed in` (no bearer, or GitHub refused the sign-in), the fix naming `workkit setup --login`;
    - 412 `not installed`, the fix naming the owner and `https://github.com/apps/workkit-agent`;
    - 403 `no write access`.
  - Every refusal is JSON `{ error, fix }`.
  - Any other GitHub failure is 502 `github refused` with GitHub's message, and any other route is 404.
  - The service caches nothing.
  - It is a Cloudflare Worker hosted by the App's owner.
    - The App's private key lives there alone, as the Worker's secret.
- **The client's exit codes**: `node identity/token.js <owner/repo>` prints the token and exits 0.
  - Exit 3 is not signed in (no login file, or the service's 401), its message naming `workkit setup --login`.
  - Exit 4 is the App not installed on the repo (the service's 412).
    - Its message is the client's own fix in place of the service's: `install workkit-agent[bot] on <owner>: <page>`.
    - The owner is the canonical login, and the page is pre-selected on it (`identity/install-page.js`).
    - The id comes from the repo read, else from the public `GET /users/<owner>`, as for a private repo whose owner lacks the App.
    - On the next line comes `or run: workkit setup --bot`.
    - When neither read gives an id, the line is `install workkit-agent[bot] on <owner as sent>: owner id unreadable from GitHub, retry`.
      - It has no page and no hint line, since a page without the owner is never the answer.
  - Every ask is preceded by the owner read through `GET /repos/<owner>/<repo>`.
    - That read follows a rename, where `GET /users/<old login>` answers 404.
    - The ask is made once, under the canonical slug.
    - So a clone whose remote still spells the old owner gets its token.
    - A failed read sends the slug as sent, so GitHub being down never blocks an installed repo.
  - Exit 1 is anything else, with the service's message.
    - That is no write access, a service error, or a service that cannot be reached or does not answer within 15 seconds.
  - At a keyboard (stdin and stderr both terminals) a not-signed-in refusal is not the end.
    - The client runs the device flow once on stderr, so stdout stays the token's, and asks again.
    - The retry's answer or refusal is the result.
    - Away from a keyboard it exits 3.
  - The shim keeps no copy of these rules.
    - On any exit but 0 it relays the code and the message as they are, and the real `gh` never runs.

- **Setup and doctor**: every verdict comes from one `node identity/token.js --status` read per run, so the sign-in rules stay the client's.
  - `workkit setup`'s Identity section says `identity: signed in as @<login>`.
  - Not signed in at a keyboard, it asks `Sign in to GitHub now, so the agent's issue bookkeeping posts as workkit-agent[bot]? [Y/n]`.
    - On Enter or a yes it runs `identity/login.js --open <opener>`, and reads the status again.
      - The opener is the one `opener` (`lib/flows.js`) finds; with none, the printed page suffices.
    - A no, or no keyboard, warns `identity: not signed in; run workkit setup --login`.
  - `workkit setup --login` runs the same step forced.
    - It asks nothing and signs in even when signed in, with or without a terminal.
    - The device page is opened when an opener exists.
  - A cloud session signs nothing in, since the bot does not act there.
    - `workkit setup --cloud`'s Identity section, doctor's machine line and `update` each print `identity: not applicable in a cloud session; the session's GitHub proxy signs every call as the account`.
    - That line is `cloudNa(kit, 'signin')` (`workkit/setup.js`), a skip line `update --auto` drops, counted by nothing.
    - Doctor's This repo section has no identity line.
  - Both questions are `askYes` (`lib/flows.js`) with yes the default.
    - Enter, `y`, `Y`, `yes` or `YES` is a yes; a closed stdin or Ctrl-D a no.
  - Setup's This repo section, after the opt-in, runs the install step when signed in and the repo's opt-in state is `enabled`.
    - The state is the committed `.workkit/settings.json`, read as the opt-in offer reads it.
    - Else it prints no line.
    - Installed is the ok line.
    - Not installed takes the owner and the install page from that lookup's refusal line (`install workkit-agent[bot] on <owner>: <page>`).
      - It never takes them from the remote's spelling.
      - It takes them before any question, so the offer reads the owner once, and each of the poll's asks reads it again.
  - `identity/install-page.js` reads the canonical login and id from one `GET /repos/<owner>/<repo>` on GitHub's API.
    - The read is sent with the user's sign-in, and follows an owner rename.
    - When it gives nothing, the public `GET /users/<owner>` with no bearer supplies the id, the owner as sent.
    - It builds the page as `INSTALL_URL` from `identity/app.js` plus `/installations/new/permissions?suggested_target_id=<id>`.
    - The owner is suggested and the repo list is not.
      - The App installs once per owner, and one repo pre-selected would send the owner's other repos back to the page.
  - A refusal whose tail is not an `https://` page (the id unreadable) is warned as the client said it, and nothing opens or polls.
  - At a keyboard it asks `Install workkit-agent[bot] on <owner> now? [Y/n]`, and opens that page through `openUrl`.
    - Then it waits on the kit's poll: `poll`, the service asked again every 15 seconds through `token.js --probe`, which prints no page.
    - Enter checks now and `s` skips.
    - Installed is the ok line.
    - A no, no keyboard, a skip, or a closed stdin is `identity: workkit-agent[bot] is not installed on <repo>; install it on <owner> at <page>`.
    - It is the same page on every path.
  - `workkit setup --bot` runs that step alone and forced.
    - In any repo with a GitHub origin, opted in or not, it asks, opens the page and polls the same way.
    - With no keyboard it warns with the page.
    - Not signed in, it warns `identity: not signed in; run workkit setup --login first` and installs nothing.
    - Installed, it prints the ok line and asks nothing.
    - It exits 1 unless the App ends installed.
  - The App is installed once per account or org by an owner's click on GitHub, never by the kit.
    - Another org's repo gets the page from the refusal itself.
  - A kit with no client beside the engine (`identity/token.js`) gets a named skip.
  - `workkit doctor` says, under This machine, `identity: signed in as @<login>` or `identity: not signed in; run workkit setup --login`.
  - Under This repo, doctor asks the service through `token.js --installation`.
    - It asks when signed in and the cwd's origin is enabled on this machine's roster.
      - That roster is the repos the shim acts on, so a clone of someone else's project hears nothing.
    - The answer is `identity: workkit-agent[bot] installed on <repo>`.
    - Or it is `identity: workkit-agent[bot] is not installed on <repo>`, followed by the client's refusal.
      - The refusal is the pre-selected install page, then `or run: workkit setup --bot` as a warning line of its own.
    - The check is bounded at 45 seconds (`LOOKUP_TIMEOUT_S` in `workkit/identity.js`, through `bounded`).
      - That is room for the client's two GitHub reads and its ask.
  - `workkit update` and `update --auto` print the machine line too, the ok line dropped under `--auto`.
    - So a machine set up before the identity shipped hears at session start that it must sign in.
  - Doctor also checks that the shim is the `gh` the PATH finds first.
    - A real `gh` ahead of it would post every call as the owner.
  - Doctor checks the `git` shim right after: `gitshim/git` present and executable in the kit, and, in a session (`CLAUDECODE=1`), the `git` the PATH finds first.
    - Any kit copy's `workflow/gitshim/git` there is ok. Another `git` first leaves `safety:tree-guard` off in that session, until a restart.
    - A missing or not executable shim is a warning in a session or out of one. Outside a session the PATH line is a skip. Doctor sees only the PATH it inherited, so it speaks for the shell that ran it.
  - A hand-made `~/.local/bin/gh` link (one not naming a workkit kit's `identity/gh`) is reported by setup, update and doctor.
    - It is left as it is, never repointed.
  - Each warning counts toward the attention total.

## Publishing the dashboard

- `publish.js`, started by `publish.sh`, pulls the clone, refreshes it from this checkout's `tower/app`, mints its brand assets, and builds it.
  - It pushes the OUTPUT to the home repo's `gh-pages` branch.
  - So nothing generated is ever committed as source, and the default branch stays the project.
- **One program builds every copy**: the install, the mint and the build are `publish/build.js`, and they are written nowhere else.
  - `publish.js` calls it on the home clone, and setup's first install calls it there too.
  - The CENTRAL copy is built by the same program in CI, where `.github/workflows/pages.yml` runs `node workflow/publish/build.js` on this repo's `tower/app`.
    - See `tower/README.md` § Where a published copy comes from.
  - The skips, the markers, the spinner and the messages around each call stay `publish.js`'s own.
- **Its tools are `git`, `gh`, `npm` and `node`**, with the `omega` the build runs: the publish needs no `jq`, `awk` or `tar`, and does its file work in Node.
- **The clone catches up before it is built**: the seed is a ONE-TIME write.
  - A clone that already carries the project is another machine's work, and is never re-seeded.
  - So without a sync, every tower improvement made after the home repo was created would stop at the checkout.
    - Pages would serve the app as it looked on seed day.
  - The sync is the catch-up, by CONTENT, the way the cloud brief's runner is seeded.
    - A file whose bytes already match is not written, so a second run changes nothing and there is nothing to commit.
  - The manifests are compared against what the seed's transform would leave.
    - That is the two npm pins as they are, and a `file:` spec repointed absolute. Only a maintainer tree in local mode carries such a spec.
    - They are not compared against the checkout's relative specs, which differ by construction.
  - It reads what the seed reads: the checkout's committed tree (HEAD) when the kit is a git checkout.
    - So an uncommitted edit on one machine never reaches the clone for a clean machine's publish to write back.
    - For a copy with no repo, it reads the folder itself.
  - One list of exclusions serves the seed and the sync.
    - It holds `node_modules`, a lockfile, `.omega`, `.cache`, `.temp`, `dist`, `.env`, the `.env.*` overlays, `logs`, `.claude`, and what `tower/app/.gitignore` names.
    - Plus `.git` and `.DS_Store`, which the copy owes itself.
  - One keep list beside it is that gitignore's `!` lines (`.env.example`, the template the tower README points at).
    - Both copy it back at the root.
  - A write that fails MID-walk is its own failure: the publish stops there, committing and building nothing.
    - Half a refresh is the broken site the mint's abort exists to prevent.
  - It may REMOVE only inside the top-level folders the app itself defines, where it is the only writer.
    - The clone's root is shared with the runner's `brief/`, the heal's `.github/ISSUE_TEMPLATE/` and the roster's `data/repos.json`.
    - So a root-level file the app retired is left alone, rather than risking another step's work.
  - A whole top-level folder the app dropped or renamed goes the same way.
    - The sync removes a clone folder its stamp's list names and the app no longer ships.
    - `TOWER_APP_RETIRED` (`workflow/home/seed.js`) names the folders earlier app layouts shipped before the stamp carried the list.
    - So a clone from before then is cleaned on its next sync.
    - `TOWER_APP_EXCLUDE` still wins.
  - It sits above the source push, so the refreshed project rides to the default branch in the same commit.
  - It sits above the site switch too, since the clone is the cloud brief's home as well.
  - A checkout with no `tower/app` beside its engine is a named skip, and the clone is built exactly as it is.
    - So is one OLDER than the clone's `.workkit-version` stamp (§ The home repo's lifecycle: the seed never downgrades).
  - A sync that wrote a MANIFEST says so in its answer: `sync()` (`home/seed.js`) hands back `{ code, manifests }`, the code 0 changed, 2 current, 1 nothing to sync from and 3 part written.
    - The publish then runs `publish/build.js install` on the clone before it builds.
    - So a refreshed `package.json` is never built without its modules.
  - The flag only covers the run that wrote the manifest, so the trigger's memory is npm's own stamp.
    - A manifest newer than the clone's `node_modules/.package-lock.json` asks for the install again.
      - That is a switch-off run's leftover, or a failed install's.
    - A page-only refresh installs nothing.
    - An install that FAILS aborts the run, for the mint's reason.
- **Then the mint, then the build**: `omega manage --service=assets` runs at the BRAND ROOT.
  - That is the mirror image of the build, which resolves only inside the target.
  - It runs after a sync that changed something.
  - It runs on any clone that has never minted at all.
    - That is every freshly seeded one, since `.omega` is among the trees the seed leaves behind.
  - It runs whenever the last mint FAILED.
    - The failure is remembered in a marker under the clone's gitignored `.omega`.
    - The failing sync's changes were already committed, so tomorrow's "already current" run would otherwise publish straight over it.
  - The verb is load-bearing: a bare `omega --service=assets` prints the manager's help and exits 0 having minted nothing.
    - So `build.js` checks for `.omega/assets/logo` after every mint.
    - A call that leaves none is a failed mint, marker and all.
  - A mint that FAILS aborts the run before the build.
    - The sidebar and the og/twitter tags emit the minted paths unconditionally.
    - So building on top of a failed mint publishes a public site with a broken logo, and a stale site beats that.
- The build runs in the TARGET, not at the brand root.
  - `omega build` is a command of `@omega.js/web` and resolves only inside `targets/web`.
  - At the root the `omega` bin dispatches to `@omega.js/manager`, which has no build at all.
  - So the build is `npm --prefix ~/.workkit/tower/targets/web run build`, and it writes `targets/web/dist/`.
  - A build that exits 0 and leaves no `dist` fails in `build.js`, before anything is pushed.

- The push uses a temporary `git worktree`, so main's working tree is never checked out over.
  - It is a force-with-lease onto `gh-pages` alone.
  - The branch carries nothing but generated files, so a rewrite is what a rebuild IS.
  - The lease still refuses to overwrite a push this machine has not seen.
- The pull is `--rebase --autostash`.
  - A pull that cannot finish (a divergence, an offline machine, a refused auth) publishes nothing, and says the clone could not catch up.
  - The engine never forces main.
- The autostash's own failure is caught too.
  - A rebase that lands while the stash it took conflicts on the way back exits 0 over a tree full of conflict markers.
  - So the surviving stash entry is checked for, and the tree is put back exactly as the run found it.
  - Nothing is built, committed or pushed.
- A `~/.workkit/settings.json` that does not parse is refused the same way, rather than read as an absent one.
  - That check comes first, since the same file names the home repo.
- Whether the remote already carries `gh-pages` is probed with `ls-remote --exit-code`.
  - Its three answers are kept apart: a branch, a remote that says there is none, and a remote that could not be reached at all.
  - The last skips the publish with a warning.
    - It does not drop the local branch on the way to a push that could never land.
- **Nothing publishes until the owner says so**: `site.publish` is the whole decision, and it is DEFAULT OFF.
  - An absent key reads as off and only `true` publishes, so a machine that has not said yes builds nothing.
  - It is all or nothing, whoever asked for the run: `workkit publish` skips exactly as the daily job does.
  - When it is on, the engine builds and pushes and assumes Pages will serve it.
    - Whether the account's plan actually serves Pages on a private repo is the owner's problem, never the engine's.
    - There is no plan detection, no visibility check, no warning gate.
- **Off means there is no site, not just no update**: a run that finds the switch off while the home remote still carries `gh-pages` TAKES THE SITE DOWN.
  - The branch is deleted, and the stale local copy with it.
  - Pages is disabled through `gh api -X DELETE repos/<home>/pages`. A 404 there is "already off", not a failure.
  - Both removals are logged.
  - The branch is generated content and the next yes rebuilds it from scratch, so nothing is lost.
  - A machine that never published has nothing to remove and hears nothing at all.
  - An unreachable remote is never torn down on a guess.
- **The roster is not part of the site**: `data/repos.json` on the home repo's default branch feeds the CLOUD BRIEF as well as the published dashboard.
  - So it is composed and pushed ABOVE the publish switch and above every build check.
  - It runs inside the publish and needs git and the clone, and nothing that publishing needs.
  - Each machine writes only its own entry under `machines`, keyed by the first label of the machine's hostname, lowercased.
    - `repos` is the union of every entry, so two machines sharing one home repo never overwrite each other.
  - A machine with the switch off, or without the tooling to build, still leaves the brief a current list.
  - A compose that FAILS is not a machine with no repos on it.
    - An unreadable `.repos.json` raises instead of composing the empty list.
    - So the file already published stays exactly as it is, and the run warns and carries on.
    - A stale-but-good roster is the designed outcome, which is why it is a warn and not the exit code.
  - Whatever else the day changed in the clone rides in the same commit.
    - The commit is `chore(home): refresh the repo list`.
    - Or it is `chore(home): sync the tower project`, when the sync above is why there is a commit at all.
  - A push that does not land is warned about, and carries out as the exit code.
    - It never costs the site a publish it can still make.
- **Nothing is baked in but the home repo**: the published site reads GitHub live from the browser with the viewer's own token.
  - So no issue data is ever written into what Pages serves.
  - That matters, because Pages is PUBLIC even when the repo serving it is private.
  - The one file the publish adds beside the pages is `data/home.json`.
    - It holds the repo the site is served from, and the branch of it the roster is on.
    - The publish pushes whatever branch the clone is on, and a reader assuming `main` 404s on a home repo that is not.
    - A branch name says nothing more once the repo is known.
  - The ROSTER goes to that branch as `data/repos.json`.
    - It holds the `owner/name` slugs to sweep as `repos`.
      - That is the union of the per-machine lists under `machines`, each keyed by the first label of the machine's hostname, lowercased.
    - Plus `home`, the repo whose Discussions carry the published summaries.
    - It lives there because repo names are private when the repos are.
    - The page reads it at the branch the pointer names, and the cloud brief at the one GitHub reports as the repo's default.
    - Each reads it with a token it already holds.
  - It has no timestamp, so an unchanged roster is a byte-identical file and no commit at all.
  - A list that cannot be composed is a warning naming both readers of the list that is now stale, and the publish carries on.
  - `site.url` set writes the CNAME into the published branch.
- The build is LOCAL: the app consumes its two `@omega.js` packages from npm at an exact version.
  - The publish checks only for `~/.workkit/tower/node_modules/.bin/omega`, never an install's exit status.
- Every reason not to publish is a named skip with exit 0:
  - no home clone, no tooling, a clone that could not catch up, a conflicting autostash;
  - an unparseable settings file, an unreachable remote, no `tower/app` to sync from, nothing changed.
- Only a mint, a build or a copy that actually failed exits non-zero.
  - So does the roster push above, which fails the run without stopping it.
- `workkit publish` runs it on demand, and a human's `workkit update` runs it too.
- `jobs/morning.js` runs it after the morning brief, never before.
- It never runs in `update --auto`: a session start has no business spending minutes on an app build.

## Participation: the tri-state

| Repo state | The heal (`standards.js`) does |
|---|---|
| committed `enabled: true` | heal |
| committed `enabled: false` | nothing, silently |
| committed text that does not parse | a warning naming the file (`unreadable`), heal nothing |
| no committed file, or one with no `enabled` answer (empty, `{}`, a value that is not a boolean), no record | print one line offering to enable, and write **nothing** into the repo |
| no committed file, or one with no `enabled` answer, recorded `declined` | nothing, silently |
| the tower clone at `~/.workkit/tower` | nothing, it is engine territory: never offered, never healed, never on the roster, and `--enable` refuses it |

- Both answers are explicit commands, never something a hook decides:

```sh
workkit enable [repo]                                  # write the committed opt-in, then heal
workkit decline [repo]                                 # record it in the USER file; never offered again
workkit state [repo]                                   # enabled | disabled | declined | undecided | home | unreadable | nogit
node ~/.claude/workkit/standards.js --announce [repo]  # the offer line, for a hook to relay
node ~/.claude/workkit/standards.js --engine-link       # maintain the engine's address, nothing else
node ~/.claude/workkit/standards.js --command-link      # make ~/.local/bin/workkit, nothing else; no repo, no prompt
node ~/.claude/workkit/standards.js --git-hooks <repo>  # set git's hooks alone, in the caller's voice; no participation check
```

- `--decline` writes only the `repos` key: every other key in the user file, and its value, survives untouched.
- Both files are created lazily: nothing exists until there is a decision to record.

## How it is reached

- The hooks resolve this folder from their own location, so they work the moment the plugin is installed.
- Git's hooks path is the exception that goes through the address, `~/.claude/workkit/githooks` (`standards/githooks.js`).
  - So a plugin update that moves this folder leaves every repo's `core.hooksPath` good.
  - Each hook takes its kit root physically (`cd -P`) from there.
- Everything else (the spec, the skills, anything scripting the standard by hand) reaches it at `~/.claude/workkit`.
  - That is a symlink this script maintains itself.
- A real heal points the address at the folder it is running from.
  - It does so provided that folder is a git checkout whose origin names the workkit repo.
- A plugin install takes it too: a folder under `<claude home>/plugins/cache/` whose `.claude-plugin/plugin.json` names `workkit`.
  - The home is read by its physical path, so a symlinked `~/.claude` counts.
  - A clone outranks it: a cache engine leaves an address naming a workkit clone alone.
  - The 9am job runs through this address: `~/.claude/workkit/../jobs/morning.sh` on a Mac, `~/.claude/workkit/morning-task.js` on Windows.
    - So a plugin update that repoints it needs no reinstall of the schedule.
- It is one path for the whole machine, so it is written ATOMICALLY.
  - It is made under a temporary name and renamed onto the address, which is also how `~/.local/bin/workkit` is written.
  - Sessions opening at once in several repos all write it.
  - None of them can leave the machine with no address, or end on having lost that race.
- A probe writes nothing, and a copy that is not the machine's engine is left silently alone.
- The heal makes the link in Node (`link`, `lib/link.js`), which makes a link or fails, never a copy.
  - On Windows a refused link warns ``engine: could not link <address>; Windows refused the symlink (turn on Developer Mode or run as administrator), then re-run `workkit update` ``.
  - Elsewhere a failed link stays silent.
- A real file or directory already at the address is left as it is, with a warning to move it aside.
- A symlink there is renamed over, never removed first, since it may be another session's win of the same race.
  - Windows renames nothing onto a folder link, so there a repoint removes the old link and then renames, a moment with no address; a link already naming this engine stays.
- `--engine-link` is that step on its own, which is what `workkit setup|update` calls.
- The hook takes a `WORKFLOW_DIR` override, and the address step a `WORKFLOW_CLAUDE_HOME` one; the tests use both.
- Run it by hand against any repo:

```sh
node ~/.claude/workkit/standards.js [repo-root]
```

- Only the label step, the claim sweep, and the label report need `gh` and a reachable remote.
- The gitignore, working-file, and forms heals need neither, and always run.
- The gitignore heal checks its result with `git check-ignore`, rather than looking for its own text.
  - Some other pattern may still hide `.workkit/settings.json`.
    - The directory form `.workkit/` does exactly that, and no negation can undo it.
  - Then the run names that line, and reports the repo as needing attention instead of claiming success.

## Where this is going

- This folder is the seed of a future installable kit.
  - That is the workflow defined once, installed per agent and per developer, in repos beyond the owner's own.
- Tracking: issue #2.
- Keep it self-contained: nothing here may depend on `~/.claude`, on Claude Code, or on anything else in this repo.
- The spec it implements: [`../docs/project-state.md`](../docs/project-state.md).
