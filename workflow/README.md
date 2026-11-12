# workflow: the issue-workflow core

- The agent-agnostic core of the issue workflow.
- It calls the `claude` CLI in one place only: the setup commands in `workkit/`.
  - Those are the plugin's install and list, and `claude setup-token` for the cloud brief's secret.
  - The test runner, whose mod half runs `claude plugin test`, is the `workkit-core` package (`../packages/core/`).
- Past that it knows nothing about Claude Code. That is why it lives at the plugin's top level instead of under `hooks/`.
  - The hooks call it, and `~/.claude/workkit` is its stable address for anything else that does.

| File | What it is |
|---|---|
| `labels.json` | Machine SSOT for the label vocabulary: every label is `group:value`, with its description and color |
| `standards.sh` | Brings a repo to the standard, idempotently |
| `standards/` | The heals `standards.sh` sources, one file per concern |
| `templates/issue-forms/` | The markdown GitHub issue templates (bug · enhancement · idea · dump) installed into a repo's `.github/ISSUE_TEMPLATE/`. Each pre-fills the issue anatomy (`## Description` then `## Spec`) and auto-applies `status:inbox` + its `type:` label |
| `templates/github-workflows/` | Two workflows, installed into two different places |
| `templates/capture.md` · `templates/session.md` | The two gitignored working files seeded into a participating repo's `.workkit/`: the capture file at its root, the session file under `agents/`. A file that already has content is never overwritten |
| `workkit.sh` | The one command: the front door to everything below |
| `workkit/` | The commands `workkit.sh` sources, one file per concern |
| `lib.sh` | Sourced helpers the home-repo machinery shares |
| `lib/` | The shell library's pieces, functions only and nothing run at load, save the MSYS link flag `platform.sh` exports |
| `lib/platform.sh` | The spellings that differ per platform, and the read shapes built on them |
| `lib/run.js` | The one Node home for starting a program |
| `lib/participation.sh` | The sibling of `platform.sh` for what the KIT means rather than for what a platform spells |
| `lib/slug.sh` | The third of the seams beside `platform.sh` and `participation.sh`: what a repo is CALLED |
| `lib/suite.sh` | The proved-tree records |
| `lib/workspaces.js` | The workspace members a package's tree id leaves out |
| `lib/hold.sh` | The full-suite hold |
| `lib/changelog.sh` | The shell home of the CHANGELOG format check, the linter's resolution and the message |
| `lib/detach.sh` | A command that outlives the shell that started it, one per lock |
| `lib/detach.js` | The detached runner's Node half: the supervisor, its checks and its ends, requiring `lib/run.js`, `lib/pulse.js` and `lib/tree.js`, and `lib/settings.js` only with `--root` |
| `lib/pulse.js` | The supervisor's verdict on a run from one reading per check, CJS, requiring nothing: `judge`, and the counts, the work floor and the two codes |
| `lib/tree.js` | The processes under a pid by parent with their processor time (`treeOf`), and the end of that tree (`endTreeOf`), CJS, requiring only `lib/run.js` |
| `lib/discussions.sh` | Sourced: the home repo's Discussions API (GraphQL through `gh`), enabling, resolving and caching the repo and category ids, posting a summary or a brief, reading prior posts back |
| `lib/git.js` | The git reads the kit's Node scripts share, CJS, requiring only `lib/run.js` |
| `lib/pause.js` | The one blocking wait the kit's synchronous Node commands share, CJS, requiring nothing beyond Node: `pause(seconds)` blocks the process through `Atomics.wait`, a fraction allowed, so a poll loop sleeps with no child process (`identity/rest-pr.js`'s `pr checks --watch`, `ship/cut.js`'s release wait) |
| `lib/say.js` | The line helpers the kit's Node commands share, CJS, requiring nothing beyond Node |
| `lib/read.js` | The read of a file that may not be there, CJS, requiring nothing beyond Node |
| `lib/settings.js` | The settings loader bound to the disk for the kit's Node scripts, CJS |
| `lib/cloud.js` | Whether this is a claude.ai/code cloud session, CJS, requiring nothing beyond Node: `isCloud(env)` is `CLAUDE_CODE_REMOTE` being `true` (`env` is `process.env` when absent), the workflow layer's Node twin of `wk_is_cloud` in `lib/platform.sh`, read by `ship/hooks.js` and `identity/gate.js` |
| `public/` | The public pairing's three verbs, each a Node script run from the private repo |
| `slug.js` | The Node twin of `slug.sh`, required rather than re-spelled |
| `user-dir.js` | The Node twin of `wk_user_dir` in `lib/platform.sh` |
| `identity/app.js` | The workkit-agent App's two constants, their one home |
| `identity/login.js` | The user's sign-in |
| `identity/install-page.js` | The repo's canonical owner, the owner's public id, and the App's install page |
| `identity/token.js` | The client of the hosted token service |
| `identity/gh` | The `gh` shim, linked to `~/.local/bin/gh` beside the `workkit` link so it outranks the real `gh` |
| `identity/gate.js` | The shim's gate, `node gate.js <cwd> <gh argv...>`, CJS |
| `identity/rest.js` | The shim's cloud half |
| `identity/rest-pr.js` | The REST forms of `pr create`, `pr list`, `pr view`, `pr checks` and `pr merge` |
| `identity/rest-release.js` | The REST form of `release view`, built on `rest.js`'s helpers as `rest-pr.js` is |
| `home.sh` | Sourced: the home repo's lifecycle |
| `home/` | The stages `home.sh` sources, one file per stage |
| `publish.sh` | Heals the home repo and refreshes its roster, then builds the tower project and pushes it to the home repo's `gh-pages` branch |
| `publish/build.sh` | The one home of the three commands that turn a tower project into a built site |
| `publish/site-repos.js` | The roster the published site sweeps |
| `script-shell.sh` | npm's script shell, once `npm config set script-shell` names it |
| `script-shell.cs` | npm's script shell on Windows, a C# 5 console program |
| `prove.sh` | `workkit prove`, the root suite on exactly the staged tree, the suite record's second writer |
| `supervise.sh` | `workkit supervise -- <command>`, any command run detached under the supervisor, as the root suite runs |
| `watch.sh` | `workkit watch [--end] [suite\|run]`, the call attached again to the repo's live run, given the code of one that ended with no call attached, or that run ended on request |
| `githooks/` | Git's own hooks, set as a repo's `core.hooksPath` by the heal |
| `wk.sh` | The capture CLI: `wk.sh note <text...>` appends one bullet to the right capture file |
| `changelog/lint.js` | Machine SSOT for the CHANGELOG entry rules, and the CLI both guarding hooks call (`linterPath` in `hooks/mods/changelog-guard.js`) and the npm wrapper calls through `lib/changelog.sh`: `workkit changelog lint <file> [--added-only [--base=<ref>]] [--staged] [--unreleased-only]` |
| `changelog/changelog-links.js` | Release-time backfill of each entry's commit link and contributor handle: `node changelog-links.js [--file X] [--range A..B] [--dry-run]` |
| `changelog/changelog-job.sh` | A repo's `checks.yml` as the heal writes it, and the retired linter copies |
| `ship/release.js` | The ship's release commit, the three edits in their order |
| `ship/plan.js` | The ship's publish plan: which packages go to npm, in dependency order, and which are skipped and why |
| `ship/publish.js` | The ship's publish, `workkit ship publish [--dir <root>]` |
| `ship/cut.js` | The ship's GitHub release, which CI makes: `workkit ship cut <x.y.z>` creates nothing |
| `ship/deploy.js` | The ship's deploy: `workkit ship deploy`, from inside the repo, run at its root |
| `ship/hooks.js` | The ship hooks, a library with no CLI |
| `ship/entries.js` | The one shape of a `hooks.<event>` declaration and its check, CJS with no imports so a CI runner's older Node loads it: `commandsOf(settings, event)` answers `[{ command, local }]` or throws `HooksError` naming the first misshapen entry; `ship/hooks.js` and `.github/scripts/ci-setup.sh` (`hooks.ciSetup`) both call it |
| `ship/watch.sh` | The ship's CI watch: `workkit ship watch <sha>` |
| `ship/triggers.awk` | Whether one workflow file's top-level `on:` names an event, exit 0 yes and 1 no |
| `ship/dispatch-input.awk` | Whether one workflow file declares a dispatch input, exit 0 yes and 1 no |
| `ship/semver.js` | The kit's one version comparison, `compareVersions(a, b)` in semver's order (a missing part reads as 0, a prerelease sorts below its release), and `isSemver(v)` beside it. Required by `plan.js`, `release.js` and `cut.js` for the version shape and by `jobs/morning/brief/cc-news.js` for the upstream releases; it requires nothing |
| `ship/items.sh` | The ship's Step 0c read: every open issue at `status:qa` or `status:complete`, one line each |
| `review/covers.sh` | The ship's review tier: whether the full-panel review marker covers the working diff, `workkit review covers` |
| `review/mark.sh` | The review marker's writer, `workkit review mark [full]`: the `workkit:review` skill's record that it ran on this repo, keyed on the repo root; `full` writes the full-panel marker `review/covers.sh` reads as well. An unknown argument, or no repo, exits 1 |
| `triage/mark.sh` | The triage marker's writer, `workkit triage mark`: the `workkit:triage` skill's record that a drain is under way, keyed on the repo root or `$HOME` outside one, which `safety:capture-guard` reads before it lets the capture file open (`docs/hooks.md` § `safety:capture-guard`) |
| `proof/red.sh` | The verifier's red run, `workkit proof red [--live] <path>... -- <command>...` |

- `labels.json`:
  - A color is not free-chosen. It is the LIGHT-mode value of the theme token the tower draws that label in.
    - The token side lives in the dashboard's `libs/tower/format.js`, so the board and the issue page agree.
  - `standards.sh` keeps existing labels on it rather than only creating them: every fixed label, with no exception.
  - A color is unique WITHIN its group and shared freely across them, since every chip on the board carries its own word and its own glyph.
    - `type:idea` wears `status:specced`'s purple.
    - `priority:high` wears `status:blocked`'s alarm red.
    - `priority:low` wears `status:backlog`'s faint gray.
- `standards.sh`:
  - It creates the labels from `labels.json`, and corrects description/color drift.
  - It installs the issue templates.
  - It rewrites `.github/workflows/checks.yml` to the kit's CI caller whenever it differs.
    - A replaced copy gets one warning per customization it held: a step to move into `hooks.ciSetup`, a kit step changed, a trigger, a job or workflow setting.
  - It removes a vendored linter copy.
  - It converts a `CHANGELOG.md` written with em dash separators to spaced hyphens once.
  - It asks for branch protection on the caller's `checks / test` check (best effort).
    - The kit's own repo, whose `checks.yml` is its own, asks on `test`.
  - A protection that already requires `test`, a copy's own job, gets that one check swapped for `checks / test` once.
    - The swap waits until the default branch on GitHub carries the caller, read through the contents API and compared with the render. Before then it leaves the check as it is.
    - The swap is `swap_required_test_check`, a PATCH of the required checks alone; every other check and app is kept.
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
  - The entry holds the prologue, the mode parse and the flow. The heals it runs are sourced from `standards/`.
- `standards/`:
  - Functions only, each file sourced by the entry and never executed.
  - `engine-link.sh`: the engine's address.
  - `state.sh`: participation, the seeds, the version key's removal, the roster, the opt-in.
  - `gitignore.sh`: `.gitignore` and the local working files.
  - `githooks.sh`: `ensure_git_hooks <root>` and `git_hooks_installed <root>`.
    - `ensure_git_hooks` runs after the `.gitignore` basics, and by `script-shell.sh` after an install-time script.
    - It sets git's `core.hooksPath` to `wk_githooks_address`, in git's spelling of the path.
    - That is `~/.claude/workkit/githooks` when the engine link points at this engine, so a plugin update leaves the path good.
    - It is this kit's own `githooks/` folder where the link is missing.
    - `core.hooksPath` is read with `--path`, so a `~/` spelling is read expanded.
    - A folder the repo named before is saved once to `workkit.hooksPath`, an existing saved value kept.
      - That is husky's `.husky/_` or lefthook's, or one of its own that merely ends `/workflow/githooks`.
    - A kit-like folder (`wk_githooks_kitlike`, `lib/participation.sh`) is repointed with nothing saved:
      - this kit under another spelling, always;
      - a gone folder, always;
      - another kit, unless it is a workkit clone, which outranks the plugin cache as the engine's address does.
    - The ok line is `git hooks: installed (<path>)`. The changed line is `git hooks: set|repointed core.hooksPath → <path>`.
    - `git_hooks_installed <root>` is 0 when `core.hooksPath`, read the same way, names a kit's hooks folder by `wk_githooks_kit`.
      - `workkit doctor` and `workkit setup` print their This repo line from that check, and the wrapper's re-point asks it first.
  - `templates.sh`: the issue forms.
  - `checks.sh`: `checks.yml`, the kit's caller.
    - `ensure_ci_workflow` writes the rendered template whenever the file differs, and nothing when it matches.
    - Before replacing a file it reads it into `<path>\t<value>` leaves (`wk_checks_leaves`).
    - It names every customization in a `checks.yml: replaced by the kit's caller; <reason>: <what>` warning that flags the run (`wk_checks_kept_out`).
    - A customization is any of these:
      - a step the kit's templates never carried (`move this step into hooks.ciSetup`, its `with:` and `env:` said);
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
  - `changelog.sh`: the linter copies, the separator.
  - `labels.sh`: branch protection, the label sync, and the public pairing (its key, the `status:` labels on the public repo, the mirror sweep).
  - `claims.sh`: the claim sweeps and the issue label check.
    - A released `status:building` issue returns to `status:specced` in the same edit.
    - Its spec is still accepted, and leaving it building would count it as in flight everywhere.
    - The staleness test is jq's `fromdateiso8601`, since `date -d` and `date -v` disagree across platforms.
  - `hooks.sh`: the hook layer's self-check.
  - `tests.sh`: whether `npm test` runs `workkit-core`'s runner.
    - `package.json` is read, never run.
    - A test script passes when its devDependencies name `workkit-core` (`wk_has_core_package`), whatever the script, since one may wrap `workkit test`.
    - Any other test script warns once, naming `npm i -D workkit-core` and `"test": "workkit test"`. It never marks the run unfinished.
    - The shape it stands for: `docs/tests.md` § The shape.
    - It also checks whether the suites sit under `test/` (`docs/tests.md` § The kit's runner).
- `templates/github-workflows/`:
  - `brief.yml` is the cloud morning brief, seeded onto the HOME repo by `home.sh` and nowhere else.
  - `checks.yml` is the CI caller written into a repo's `.github/workflows/`, the kit's and never the repo's.
    - The triggers: every pull request, and every push to the default branch.
    - The default branch is the `__DEFAULT_BRANCH__` placeholder the heal fills through `wk_default_branch`.
    - Job `checks` calls the kit's `.github/workflows/ci.yml@main` with `secrets: inherit`.
    - Job `release` runs on a push only (`if: github.event_name == 'push'`), so a pull request's token stays read-only.
    - `release` has `contents: write` and `actions: write`, and calls the kit's `.github/workflows/release.yml@main` with no secrets. The job's own token is its only credential.
  - The reusable `ci.yml`'s `test` job runs the kit's `.github/scripts/ci-*.sh` from a shallow clone of the kit in `$RUNNER_TEMP`, outside the workspace.
    - What they run: the Node version, the repo's `hooks.ciSetup` before the dependency install, the suite under `xvfb-run -a`.
    - A newer run on the same pull request cancels the older.
  - A release push runs no setup, install or suite.
    - A `Scope` step right after the kit's clone answers `run=true` for a pull request.
    - For a push it asks the kit's `release-push.sh` with the push's `before`, which fetches it when the shallow checkout lacks it.
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
  - A release that job's token makes starts no workflow.
    - So after a create, or on a re-run where a release commit the push brought already has its release, it dispatches.
    - It runs `gh workflow run <file> --ref <the event's repository.default_branch>` for every workflow whose top-level `on:` names both `release` and `workflow_dispatch` (`ship/triggers.awk`).
    - It adds `-f tag=v<x.y.z>` for one whose `workflow_dispatch` declares a `tag` input (`ship/dispatch-input.awk`).
      - The tag is the newest version that run released or found released. Its `ci-release: started` line names the tag.
    - Each is tried whatever the one before answered.
      - A failure is `ci-release: dispatch of .github/workflows/<file> failed: <gh's first stderr line>`.
      - The job exits 1 once every one was tried.
    - It names a workflow on `release` alone in a `ci-release: warning:` line.
  - The heal rewrites the caller whenever it differs, so a hand edit lasts until the next heal (`standards/checks.sh`).
- `workkit.sh`:
  - Its verbs: `setup [--token | --login | --bot | --home | --cloud]` · `update [--auto]` · `doctor` · `publish` · `brief [--local]` · `log [-n N] [--follow]` · `tower` · `enable` · `decline` · `heal` · `state` · `note` · `test [paths]` · `tools` · `prove` · `supervise -- <command>` · `watch [--end] [suite|run]`.
  - And: `public intake|mirror|close` · `ship items|release|watch|cut|plan|publish|deploy` · `review covers|mark` · `triage mark` · `proof red` · `changelog lint`.
  - It keeps the map, the constants and the dispatch, and sources its commands from `workkit/`.
  - A verb with subcommands follows one rule: `workkit <verb> <sub>` runs `<verb>/<sub>.sh` or `.js` (`run_verb`).
    - It is exec'd, so the script's output and exit code are the command's.
    - An unknown or missing subcommand exits 1 with one line naming the ones there are.
- `workkit/`:
  - Functions only, each sourced by the entry and never executed; `links.sh` by `standards.sh --command-link` as well.
  - `links.sh`: the engine's address, the two `~/.local/bin` symlinks (`workkit` and the `gh` shim), and npm's `script-shell` and its Windows executable.
    - Plus `machine_links`, the sequence `update`, the wizard and `setup --cloud` share.
    - That sequence is the links, the script shell, then the kit's allow rules in the global settings (`keep_allow_rules` in `allow.sh`).
  - `schedule.sh`: the 9am schedule's drift, update and first install.
  - `install.sh`: the plugin, the gh login, the tower pointer, this repo's opt-in.
  - `site.sh`: the publish question and the domain.
  - `token.sh`: the token handover.
  - `secrets.sh`: the cloud brief's secrets.
  - `identity.sh`: the bot identity's sign-in and install steps and doctor lines.
    - It asks through `wk_ask_yes` and opens the install page through `wk_open_url`.
  - `setup.sh`: the wizard, its `--cloud` form and the `cloud_na` lines doctor shares, the roster report, the home steps.
  - `commands.sh`: `update`, `publish`, `brief`, `doctor`, `test`, `tools`.
  - `log.sh`: `log`, the hooks log's last 40 lines, or `-n N`, `--follow` tailing it.
    - It prints one skip line when there is no log yet.
  - `public.sh`: `public`, each subcommand handed to its `public/` script.
  - `allow.sh`: the kit's allow rules in the global `~/.claude/settings.json`, setup's step and doctor's lines.
  - `ship.sh`, `review.sh`, `triage.sh`, `proof.sh` and `changelog.sh`: each its verb's subcommand list, handed to `run_verb`.
- `lib.sh`:
  - The global layer's addresses: `~/.workkit`, the tower clone in it, its config and its build output.
  - A safe JSON edit.
  - The ONE voice everything else prints in (the line shape, the colors, the spinner, the browser walkthrough, the relay untag): [Output](#output).
  - The entry keeps the addresses and every line that runs at load (the palette, the state lock's address).
  - It sources its function groups from `lib/`.
- `lib/`:
  - Three are `lib.sh`'s own groups, reached by sourcing it:
    - `voice.sh`: the color gate, the palette, the line shape and its levels, the headings, the relay untag, the spinner;
    - `flows.sh`: the browser walkthrough's Enter gate, its opener `wk_open_url` and its poll; the yes/no question `wk_ask_yes`; and `wk_link`, the atomic link maker;
    - `state.sh`: the safe JSON edit and the state mutex.
  - Six are seams the hooks and the entries source directly as well, each with its own row: `platform.sh`, `participation.sh`, `slug.sh`, `suite.sh`, `hold.sh` and `discussions.sh`.
  - Two more are the npm wrapper's, with rows of their own too: `changelog.sh`, and `detach.sh`.
    - `detach.sh` has its Node half `detach.js`, which the CI watch shares.
- `lib/platform.sh`:
  - Sourced by `lib.sh`, by `standards.sh` and by the hooks' `_lib.sh` alike.
  - It is the shell twin of `test/lib/platform.js`, and of `lib/run.js` on the Node side.
  - A shape sits here beside the spelling it is built on.
    - So one jq read has one home for both of its questions: which jq answers it, and what its default means.
  - It holds twenty-seven functions, each below.
  - `wk_jq`, since jq on Windows is a native program whose stdout is in TEXT MODE.
    - So a value read bare carries a `\r` into whatever is compared or written next.
    - Every jq call in `standards.sh` and in `lib/state.sh`'s JSON helpers goes through it.
    - The hook layer reaches it under its own name (`hook_jq`).
    - jq's own exit status comes back, so a predicate (`jq -e`, `jq empty`) answers what it always answered.
  - `wk_jq_default <default> <jq args...>`, beside it: the shape every read that carries a default is written in (`hook_jq_default` on the hook side).
    - jq writes the values it parsed before it fails on a later one.
    - So a `|| printf <default>` in the substitution hands back that partial answer, with the default stuck on the end of it.
  - `wk_native_path`: the native spelling of a path (`cygpath -m` on Windows, the identity elsewhere), which is git's own.
    - Every kit shell line prints a path for a person in it, so Windows output never mixes `/d/a` and `D:/a`.
    - It is the one spelling a machine-roster key is written and looked up under.
    - So `C:/Users/x` and the Git Bash `/c/Users/x` cannot become two keys for one repo.
  - `wk_posix_path`, beside it: its inverse, the Git Bash spelling of a path (`cygpath -u` on Windows, the identity elsewhere).
    - `workkit proof red` walks a drive path a failing load names through it.
  - The pair a port takeover is written in:
    - `wk_port_pids <port>`: the pids listening on a TCP port (`lsof` where it ships, `netstat -ano` on Windows, an empty answer where the port is free).
    - `wk_end_pid [-9] <pid>`: ending one of them (`kill`, and `env kill -f -W` for a Windows pid).
    - There `env` is load bearing: bash's builtin shadows the `kill.exe` that takes a Windows pid.
    - That path is forceful whatever signal it is handed.
  - `wk_end_run <pid>`, beside them: a detached run's supervisor ended with its process group (on Windows its process tree), always 0.
    - On Windows it ends its process tree (`taskkill //T //F`), or uses `wk_end_pid` where there is none.
    - Elsewhere it ends its process group: INT so the body logs its own code, then TERM and KILL.
    - Each comes 1.5 seconds after the last, while the group lives.
  - `wk_pid_alive <pid>`: whether a pid still runs (`kill -0`).
    - On Windows it asks Node, where a pid Node printed is a Windows pid bash's kill cannot see.
  - `wk_mv_link <from> <to>`: the rename that never follows a link at its destination (`-T` where mv is GNU, `-h` where it is BSD).
    - `wk_link` in `lib/flows.sh` renames a fresh link through it, so an address is replaced atomically.
  - `wk_sha1`: the one digest (`shasum` or `sha1sum`).
    - A machine with neither is refused loudly, rather than keyed to an empty string.
  - `wk_marker_path <dir> <anchor>`, beside it: the one derivation of a marker's path, `<markers dir>/<dir>/<sha1 of anchor>`.
    - It serves the suite and package records here, and the hooks' review and triage markers alike.
    - The hooks reach the digest as `hook_sha1`.
  - `wk_markers_dir`: that base, `markers/` in `wk_user_dir`'s folder, out of reach of a system temp cleaner.
  - `wk_sweep_markers`: the kit's own cleaner. Every marker writer calls it.
    - It removes each regular file one folder under the base whose mtime is older than `MARKER_KEEP_DAYS` (7 days, set here).
    - It never enters a folder there.
  - `wk_tower_dir`: the tower clone, `tower/` in the same folder, the one spelling `lib.sh`'s `WK_HOME_DIR` reads.
  - `wk_user_dir`: the one spelling of the machine folder (`WORKFLOW_HOME` else `~/.workkit`), the engine's, the hooks' and the jobs' alike.
  - `wk_hooks_log`, beside it: it sets `WK_HOOKS_LOG` to the hooks log in that folder.
    - That is `hooks.log`, the one path `workkit log` reads.
    - The hooks module writes it, and spells the same path in `hooks/mods/log.js`.
  - `wk_proof_base`: the kit's cache folder, `~/.cache/workkit/proof`, where every proof run folder lives.
    - `HOME` moves it; `WORKFLOW_HOME` does not, since on a machine where `~/.workkit` is a link into a repo a copy under it would sit inside that repo.
  - `wk_proof_dir`: a new run folder, `<wk_proof_base>/<id>` with `<id>` six random characters, printed; 1 when none can be made.
    - `workkit prove` and `workkit proof red` each make theirs through it, so `HOME` moves the copy and `TMPDIR` does not.
    - The copy's path stays short (43 bytes under a default macOS home) and has no crowded parent.
    - It first removes each run folder there last changed more than `PROOF_KEEP_DAYS` ago (1 day, set here), since no system cleaner reaches the cache folder.
    - One holding `live` is left: a `--live` run that could not restore keeps the live files there.
    - One it cannot remove is left, and never fails the run; a removed copy's worktree entry is left for git's own prune.
  - npm's script shell on Windows:
    - `wk_script_shell_exe`: the one spelling of the executable's path (`script-shell.exe` in the machine folder). Setup builds to it and the commit gate checks for it.
    - `wk_npm_script_shell`: npm's `script-shell` value without the carriage return a Windows npm ends it with, npm's own exit status coming back.
    - That is the one read setup, `doctor` and the gate compare.
    - `wk_physical_path <path>`: the one compare they share.
    - A path's folder is resolved through every link (`pwd -P`), and its file name kept as written.
    - It gives nothing and a non-zero return when the folder cannot be entered.
    - So the kit's shell reached through a linked folder is the kit's. A link to the file itself, set in another folder, is not.
  - `wk_in_plugin_cache <kit dir>`: whether a kit is the workkit plugin's copy in Claude's plugin cache.
    - That is: its manifest names `workkit`, and its physical path lies under the physical `<claude home>/plugins/cache/`.
    - It is the one answer the engine's address, the setup nudge, the command link, `doctor` and the job installer ask.
  - `wk_clone_outranks <kit dir> <linked dir>`, beside it: the rule that a clone outranks the plugin cache.
    - A cached kit finding a machine-wide link that names a workkit clone (`wk_is_kit_checkout`) leaves it as current.
    - The engine's address, the command link, the `gh` shim link, `doctor` and the job installer read it alike.
  - `wk_is_cloud`: whether this is a claude.ai/code cloud session (`CLAUDE_CODE_REMOTE` is `true`).
    - `workkit setup --cloud`, `doctor` and the `gh` shim read it.
    - Its Node twin is `isCloud` in `lib/cloud.js`.
  - `wk_node`: the path of the first node whose `--version` reaches `WK_NODE_FLOOR`.
    - `WK_NODE_FLOOR` is 22.12, set here: the `require()` of the ES modules in `hooks/mods` needs it.
    - The kit's own `engines` floor is higher, and is not this one.
    - It tries, in order: `$WORKKIT_NODE`, `node` on PATH, `~/.nvm/default-bin/node` (the dotfiles pin, on a Mac and on Windows), and nvm's newest `~/.nvm/versions/node/v*/bin/node`.
    - It gives nothing and 1 when none fits.
    - It is the node the `gh` shim's gate and the git hooks' judge run under.
  - The one mutex shape:
    - `wk_take_lock <dir>`: a `mkdir` of `<dir>`, its parent made first.
    - It is 0 holding it, and 1 after a 5-second wait, its caller going ahead either way.
    - `wk_drop_lock <dir>`, beside it: the `rmdir` only a caller that took it runs.
    - The state mutex (`lib/state.sh`) and the package record's write (`lib/suite.sh`) both take it.
- `lib/run.js`:
  - CJS, requiring nothing beyond Node, the Node twin of `lib/platform.sh`.
  - workkit-core ships it as `workkit-core/run`; its prepack copies it to `run.cjs`.
  - `spawnSync`, `spawn` and `execFileSync` take `child_process`'s arguments and give its results and errors.
    - Off Windows they are its own calls.
  - On Windows `launchOf(cmd, args, options, { platform, parentEnv })` answers the real launch `{ file, args, options }`.
    - A bare name is searched on the given env's PATH (else the parent's) dir by dir, each entry trimmed of its quotes.
    - It tries the name, then `.exe`, `.com`, `.cmd`, `.bat`.
    - An extensionless file counts only when its first line starts `#!`.
    - A `#!` naming node (`#!/usr/bin/env node`, or a path ending `/node`) runs under `process.execPath`.
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
  - An npm cmd-shim (a `.cmd` under `node_modules\.bin`, cross-spawn's rule `NPM_CMD_SHIM`) gets each argument's escaping twice.
    - The shim's `%*` parses the line again. Any other `.cmd` or `.bat` gets it once.
  - Every argument and the program name (`argv0`, unless the caller passes one) go through `windowsQuoted`, verbatim.
    - So Git Bash never globs or splits one.
  - A given env lacking one of `WINDOWS_KEPT` takes it from the parent.
    - Those are `ComSpec`, `SystemRoot`, `PATHEXT`, `TEMP`, `TMP`, any letter case.
  - A name the env spells in more than one case (`Path` and `PATH`) is read under the key Node hands the child, the first in sorted order.
  - A name found nowhere is left as given, so the start fails with ENOENT.
  - The platform is read once at load, so a test that fakes `process.platform` never hands a real program the win32 launch.
  - Every shipped file that starts a program requires it.
  - `test/scripts/run-home.test.js` fails any other `child_process` import but two and a list:
    - the published workkit-core runner's `packages/core/test/run.js` and `packages/core/test/lib/spawn.js`, since that package cannot require the kit's run.js;
    - the root `test/` files still on the check's list, which only shrinks.
- `lib/participation.sh`:
  - Sourced by `lib.sh` and by the hooks' `_lib.sh` alike.
  - `wk_is_repo_root <dir>`: it asks `.git` with `-e` and never `-d`.
    - A worktree's and a submodule's `.git` is a FILE, and a `-d` reading skips a repo that works perfectly.
  - `wk_settings_declined <file>` / `wk_settings_enabled <file>`: the top-level `enabled` key of a settings file, read without jq.
    - It is read through the node `wk_node` finds, so a nested `enabled` (`manager.enabled`) changes nothing.
    - A text match is used only where there is no node.
    - The two are not each other's negation: a file carrying no `enabled` key is off but not declined, which the heal's offer tells apart.
    - A file that is there but cannot be read reads declined.
  - `wk_opted_in <root>`: 0 when the repo turned workkit on.
    - That is `<root>/.workkit/settings.json`, a file whose own `enabled` is `true`, through `wk_settings_enabled`.
    - No file, an empty one, `{}` or one with no key is off, the default. The machine's file has no say.
    - It is the shell side's one opt-in test, the twin of `settingsOptedIn` in `hooks/mods/gate.js`.
    - `wk_session_judges`, `wk.sh`'s `participating` and `script-shell.sh`'s repoint ask it.
  - `wk_setting <root> <dotted.key>`: one setting from the merged view.
    - The view is the kit's `defaults/settings.json`, then `$(wk_user_dir)/settings.json`, then `<root>/.workkit/settings.json`, none with an empty root.
    - They merge key by key in jq as `loadSettings` in `hooks/mods/settings.js` merges them, `enabled` the root's own alone.
    - A string prints raw, null as nothing, and anything else as JSON.
    - The defaults are found at `defaults/settings.json` two folders above `participation.sh` itself (`${BASH_SOURCE[0]%/*}/../../`).
    - That holds because every caller sources the file by absolute path.
    - Defaults missing or not an object give an error naming the file, and 1.
    - The site options are read through it with an empty root (`home/options.sh`, `publish.sh`, `workkit/site.sh`, `jobs/morning.sh`).
  - `wk_session_judges <root>`: 0 when a Claude session's checks rule in that root.
    - That is `CLAUDECODE=1`, `HOOK_DISABLE` not `1`, and `wk_opted_in`.
    - It is the one gate of the full-suite hold (`lib/hold.sh`), the git hooks (`githooks/hook.sh`) and the `gh` shim's session gates (`identity/gh`).
  - What the kit means by its own hooks folder, for the heal (`standards/githooks.sh`) and the hooks' chain alike.
    - So a hook loads nothing of the heal's.
    - `wk_githooks_kit <root> <folder>`: 0 and the kit root printed when the folder's physical path ends `/workflow/githooks` and holds executable `pre-commit` and `commit-msg` and a `judge.js`.
    - A relative folder is read against the root, as git reads it.
    - `wk_githooks_spelled <folder>`: 0 for a spelling ending `/workflow/githooks` or `/workkit/githooks`.
    - `wk_githooks_kitlike <root> <folder>`: the one predicate both callers ask.
    - It is 0 when `wk_githooks_kit` accepts the folder.
    - It is 0 too when the folder is spelled like a kit's and does not exist (a plugin update's leftover, a dangling link).
    - So an existing folder of the repo's own that merely ends `/workflow/githooks` is not kit-like.
- `lib/slug.sh`:
  - Sourced by `lib.sh` and by the hooks' `_lib.sh` alike.
  - `wk_slug_from_remote <url>` is `owner/repo` out of a remote in every form git writes one, the SSH shorthand and the HTTPS URL.
    - It also reads one out of a local path in EITHER separator.
    - Git stores a remote exactly as it was typed, and a path typed natively on Windows comes back with backslashes.
    - The trims and the regex are `slugFromRemote` in `../slug.js`, shape for shape.
    - So the roster and the home repo's project list can never disagree about what a repo is called.
  - `wk_repo_slug <dir>` is that rule over a working tree's origin.
    - The hooks module reads it as `repoSlug` in `hooks/mods/optin.js`, over `hooks/mods/command.js`'s copy of `slugFromRemote`.
    - That copy is the one `safety:release-taken` names the repo in its github-release bounce through.
    - `wk_is_kit_checkout <dir>` asks it whether a tree is a clone of workkit itself.
    - That is the rule the engine's address and `wk_clone_outranks` both read.
  - `wk_roster_path <owner/name> [<match>]` runs it the other way.
    - It gives the machine roster's enabled folder whose origin is that slug, matched without regard to case, or 1.
    - Given a `<match>` function, it gives the first enabled folder it accepts instead (the `gh` shim's `names_public`).
    - The hooks module follows it as `rosterPath` in `hooks/mods/optin.js`.
    - That is how `safety:proof-guard`, `workflow:snapshot` and `workflow:public-mirror` find the repo a flip names.
- `lib/suite.sh`:
  - Sourced by `script-shell.sh`, by `supervise.sh`, by `watch.sh`, by `ship/watch.sh`, by `workkit.sh` and by the hooks' `_lib.sh` alike.
  - The suite record is the engine-agnostic contract between whatever runs a repo's root suite and the gate.
    - It has two writers. `script-shell.sh` is npm's adapter, recording the working tree a root run started on.
    - `prove.sh` records the index's tree, proved in a copy.
    - Its readers are `safety:commit-gate`, through `suiteProved` in `hooks/mods/suite.js` (`wk_suite_proved`'s read).
    - And the full-suite hold (`lib/hold.sh`), through `wk_suite_proved` itself.
  - The record's first line is the `git write-tree` id of the tree its writer proved, less `.workkit/`.
  - Its second line is `ms=<n>`, the wall time in milliseconds of the run that wrote it. The gate holds it against `tests.budget`.
  - Every read matches the first line alone, so a record with no second line still proves its tree.
  - It lives in `~/.workkit/markers/claude-suite-marker/<sha1 of the repo root>` (`wk_suite_marker_path`).
  - `wk_tree_hash` computes it with `git add -A` into a throwaway index under `mktemp -d`.
    - That index is seeded from a copy of `$git_dir/index`, never `$GIT_INDEX_FILE` (`cp -p`, keeping the mtime git's racy check reads).
    - So untracked files count, and ignored ones never. Only changed files are re-hashed, and the real index is never touched.
  - `wk_index_write_tree <root> <index> [<path>...]` then drops `.workkit` and each path from that scratch index (`git rm -r -f --cached`).
    - Then it takes its `write-tree`.
    - So a write under `.workkit/` (a log, a marker, `settings.json`) never re-keys a record.
  - `wk_suite_index_tree <root>` is the real index's id the same way: a scratch copy of the index, through the same helper.
    - The copy is `wk_index_copy <root> <dir>`, which honours `$GIT_INDEX_FILE` in a commit hook and prints the copy.
    - `prove.sh` shares that step.
  - `wk_suite_marker_write` writes the id its writer hashed BEFORE the run, and only when the tree hashed after it is the same.
    - So an edit made while it runs is never proved.
  - `wk_suite_proved` compares a tree id with it: the hold the working tree's, or the real index's for `workkit prove`.
    - What the gate compares is `docs/hooks.md` § `safety:commit-gate`'s.
  - The package record is its sibling: the packages a green `npm test` other than the bare root run proved.
    - It has its own file, `~/.workkit/markers/claude-package-marker/<sha1 of the repo root>` (`wk_pkg_marker_path`), never the suite's.
    - It holds one line per package, `<id> <pkg>`.
    - That is the package folder relative to the root (`.` for the root), after its own tree id hashed before the run.
  - A package's id is `wk_tree_hash <root> <pkg>`.
    - After the `git add`, each folder `lib/workspaces.js` prints is dropped from the throwaway index with `.workkit` (`wk_index_write_tree`), then `write-tree`.
    - `.` or no `<pkg>` is the whole tree.
    - So is no node found (`wk_node`), said on stderr as `tree-hash: no node <WK_NODE_FLOOR> or newer found; <pkg> keyed to the whole tree`.
    - That is the line `safety:proof-guard`'s qa block names for a package with no line.
    - Which members it leaves out, so which code the id covers, is the id rule in `docs/hooks.md` § `safety:proof-guard`, its package id bullet.
  - `script-shell.sh` is its one writer: `wk_pkg_marker_write <root> <tree> <pkg>`.
    - It works under the record's lock, `<marker>.lock` taken by `wk_take_lock`.
    - It copies every line whose package is not `<pkg>`, and appends `<tree> <pkg>`.
    - It moves the result onto the record from `<marker>.tmp.<pid>`, so overlapping package runs each keep their line.
  - `safety:proof-guard` is its one reader, at the flip to `status:qa`.
    - It reads through `pkgProved` in `hooks/mods/suite.js`, the read of `wk_pkg_proved <root> <tree> <pkg>`, 0 when a line is `<tree> <pkg>`.
  - The suite record keeps the fresh write (`_wk_record_write`).
  - The two records share the marker path rule (`wk_marker_path`), and the sweep each of their two writers runs first (`wk_sweep_markers`).
  - The package record's locked line write and its read (`wk_pkg_proved`) are its own, here in `lib/suite.sh`.
  - `wk_has_test_script` is the one has-a-test-script predicate (a non-empty string `scripts.test`).
  - `wk_log_path <root> <name>` is where a detached run logs.
    - That is `<root>/.workkit/<name>` when git ignores it there, else `~/.workkit/markers/claude-<name>/<sha1 of the repo root>`.
    - So a log never changes the tree hash.
    - `wk_suite_log_path`, `wk_run_log_path` and `wk_ci_log_path` are it for `suite.log`, `run.log` and `ci.log`.
  - `wk_suite_lock_path`, `wk_run_lock_path` and `wk_ci_lock_path` are the three run locks, the `claude-suite-lock`, `claude-run-lock` and `claude-ci-watch-lock` marker paths.
  - The hook library's scripts call these by their engine names.
  - The hooks module reads the records through `hooks/mods/suite.js`.
    - It takes a tree id through `tree-hash.sh`, the index's with `-i` as its only flag.
- `lib/workspaces.js`:
  - Run by `wk_tree_hash` (`lib/suite.sh`) under `wk_node`, CJS.
  - `node workspaces.js <root> <pkg>` prints them, one folder per line.
  - `membersOf(root)` is `[{ name, dir, deps }]`.
    - `dir` is relative to the root, from the root `package.json` `workspaces` expanded in one call of `ship/plan.js`'s `expandWorkspaces`.
    - `deps` is the member names its `depNamesOf` reads across the dependency fields.
    - No `workspaces` field is `[]`.
  - `npm query .workspace` is never used: it answers `[]` until `npm install` has run.
  - `excludedFor(root, pkg)` is the `dir`s of the members outside `pkg`'s own id, the code it can see, sorted.
    - The rule: `docs/hooks.md` § `safety:proof-guard`, the package id bullet.
    - A `pkg` that is no member (a `functions/` folder) is read by its own `package.json`'s dependency fields.
    - `.` is `[]`.
  - Anything the plan refuses is `[]` and one stderr line, `workspaces: <plan.js's message>; <pkg> keyed to the whole tree`.
    - The plan refuses with `PlanError`: a pattern it does not expand, a `package.json` that does not parse.
- `lib/hold.sh`:
  - Sourced by `script-shell.sh` and by the hooks' `_lib.sh`, so `prove.sh` and the snapshot reach it.
  - It is the rule of the spec's § The proof run where the root suite runs, never read off a command's text.
  - `wk_suite_hold <root> <tree-reader>` exits 0 to run and 1 to refuse, the reason on stderr.
    - `script-shell.sh` asks it on the bare root run with `wk_tree_hash` (the working tree).
    - `prove.sh` asks it with `wk_suite_index_tree` (the real index).
    - The reader runs only once the run is judged, each before its CHANGELOG check and its detach.
    - So a refusal runs no suite and writes no record.
    - On the `script-shell.sh` path a root `pretest` has already run, since npm runs it first through `exec sh`.
  - A reader that fails skips the proved-tree check with one stderr line, never a judgment of an empty tree:
    - `suite-hold: the tree could not be hashed (<reader> exited <rc>), so the proved-tree check did not run; the building hold still judges`.
  - It judges only where `wk_session_judges <root>` (`lib/participation.sh`) says a Claude session's checks rule:
    - `CLAUDECODE=1` (a Claude session; the owner's terminal is never judged);
    - `HOOK_DISABLE` is not `1`;
    - and `<root>/.workkit/settings.json` exists and does not decline.
    - Every other run goes on, with no `gh` call.
  - Both gates are read from the run's own environment, which whoever runs npm sets per command.
    - So `HOOK_DISABLE=1` there is a per-run escape the owner uses, never an agent.
  - Then, in order:
    - A tree the suite record already holds (`wk_suite_proved`) refuses with `suite-hold: this tree is already proved:`.
      - It names the record's path (`wk_suite_marker_path`) and asks for the narrowest test.
    - A root with no origin (`wk_repo_slug` empty) runs, with no `gh` call.
    - One `gh issue list --state open --label status:building` from the root (`wk_issues_building`) refuses when it lists any issue.
      - The line is `suite-hold: the full suite runs once, at the commit, after every item in the tree is parked and passed;`.
      - It names each issue as `#N (status:building)`.
      - It says that work has to finish (tests green, its `Proof:` comment, its own park), never a relabel, `HOOK_DISABLE` or a cleared `CLAUDECODE`.
      - It asks for the narrowest test.
    - A `gh` that is missing or cannot answer lets the run go, with one `suite-hold:` note on stderr.
  - The stage label alone holds a run, never `agent:claimed`, since an `agent:ok` item keeps that claim through the park.
  - Every run is judged by the root it runs in, which npm has already resolved.
    - A `cd`, `--prefix` or `-w` lands it in its own repo.
    - So a repo that never opted in is never judged.
  - `wk_issues_building [repo]` prints one line per such issue: the number, a tab and the label.
    - It returns 2 when `gh` cannot answer.
    - Its argv changes together with `buildingList` in `hooks/mods/gh.js`.
    - `hook_snapshot_stale` reads it too.
  - Not held:
    - a run of the root script's text that skips npm (it writes no record either);
    - a machine whose npm is not wired to the wrapper (the commit gate refuses its code commits).
- `lib/changelog.sh`:
  - Sourced by `script-shell.sh`.
  - The hooks module resolves the same linter itself (`linterPath` in `hooks/mods/changelog-guard.js`), for `docs:changelog-guard` and `safety:commit-gate` check 3.
  - `wk_is_changelog <path>` is the filename rule the wrapper asks: a `CHANGELOG.md` at the root or below.
    - The module's twin is `isChangelog` in `hooks/mods/changelog-guard.js`.
  - `wk_changelog_linter` is the linter's path: `changelog/lint.js` in the workflow folder beside it, or under `WORKFLOW_DIR` (the tests' override).
    - It answers 1 when node or the file is missing, which the wrapper reads as standing aside.
  - `wk_changelog_lint_file <file> [--staged]` runs it as `--added-only`, its findings on stderr and its code returned.
    - With no linter to run it stands aside, with 0 and a line on stderr that `wk_changelog_lint` passes on.
    - The line: `changelog: the linter did not run on <file> (no node on PATH|no changelog/lint.js to run), so its entries are not judged`.
  - `wk_changelog_lint <root> [--staged] <path>...` runs that per path.
    - On the first failure it prints `the CHANGELOG entry does not match the format (see docs/project-state.md). <the linter's stderr>` on stderr, and returns 1.
    - Clean paths, or none, return 0.
  - The wrapper prints it after `script-shell:`.
  - Commit-gate check 3 prints the same sentence after `commit-gate: BLOCKED this commit:`.
- `lib/detach.sh`:
  - Sourced by `script-shell.sh`, by `prove.sh`, by `supervise.sh`, by `watch.sh` and by `ship/watch.sh`.
  - `wk_run_detached <log> <lock> [--root <root>] -- <cmd> [args...]` takes `<lock>`.
    - The lock is a directory made by `mkdir`, with the supervisor's pid written inside as `pid`.
    - It launches through `detach.js`, passing `--root` on, so the run is checked.
    - With `--root` that is the first node `wk_node` finds at the kit's floor, which the settings loader needs; without it, plain `node`.
    - A launcher that fails (a bad `tests.check` is 2) drops the lock, prints `detach: could not start <cmd> (log <log>)` and returns the launcher's code.
    - Then it attaches through `wk_attach_run <log> <lock> <pid>`, whose answer is its own.
  - `wk_attach_run <log> <lock> <pid> [<offset>]` tails `<log>` to stdout from byte `<offset>` (0), so a later verb attaches to a run already going.
    - It drops the lock and returns the code the command recorded.
    - That code is read once, from the done file, in the poll that first finds it.
    - A `look` file beside the done file, with no done file yet, is the supervisor asking for a look.
      - It prints the look's evidence, then `detach: the run goes on; read <log>, then run workkit watch to keep waiting or workkit watch --end to end it (exit 125)`.
      - It removes the look file, keeps the lock, sets `WK_RAN_LOOK` to 1 and returns 125, with the run still going.
    - Before it drops the lock it leaves `<supervisor pid> <code>` in `<lock>.done`, a file beside the lock folder, written whole and renamed.
    - A call that finds the lock or the done file gone, its supervisor's pid gone too, returns the code that record holds for its own pid.
      - So of two calls attached to one run, the one that finds the lock already dropped still gets the run's code, whatever the command printed.
      - No record, or another run's, is the supervisor-gone line below.
    - `wk_take_run_lock` removes the record when it takes the lock for a new run.
  - `wk_run_live <lock>` is 0, printing the supervisor's pid, while `<lock>` holds a pid file, no done file, and that pid is alive; 1 otherwise.
    - `wk_take_run_lock` asks it whether a lock's run is going.
  - `wk_run_held <lock>` is 0, printing the pid, while `<lock>` holds a pid file and that pid is alive or its done file is written: a run whose answer no call has collected yet. `watch.sh` chooses its run by it.
  - The lock is dropped only by its owner.
    - The normal end, the INT trap and the supervisor-gone path each remove it only while `<lock>/pid` still holds this run's pid.
    - So a run that took it over keeps it.
  - A lock a live run holds answers 3 with nothing run.
    - Since a command may return 3 itself, `WK_HELD_PID` is set, to the holder's pid, only then.
  - A lock whose run is over is taken over: its done file written, its pid gone, or no pid five seconds after the `mkdir`.
    - With a done file, it waits up to two seconds for the directory to go, since its own foreground is collecting it.
  - INT, a human's Ctrl-C on the call that started the run, ends the whole run and exits 130.
    - It writes the end request and waits through `wk_ask_end`, so the supervisor ends the run's processes, a child in its own session included, and the log ends with its request line.
    - Once the done file holds a code, it leaves the record, so a second call attached to the run gets 143.
    - A run still going when the wait runs out is ended by process group (`wk_end_run` in `platform.sh`).
    - Then it drops the lock.
  - `wk_ask_end <lock> <pid>` writes `<lock>/end`, the supervisor's end request, while `<lock>/pid` holds `<pid>`, then waits up to `WK_END_WAIT` seconds (30).
    - With another pid or none there it is 0 at once, nothing written.
    - It is 0 once the done file is written or `<lock>/pid` holds another pid or none, 1 when the wait runs out. It prints nothing.
    - A supervisor gone with no done file ends the wait at once with 1; the done file is looked at once more first, since it may land just before the supervisor exits.
    - `watch.sh`'s `--end` waits through it too.
  - Any other signal ends only the foreground.
    - The run goes on to its done file, and the lock stands until a later call finds it over.
  - A supervisor gone with no done file and no record of its own is one `detach:` line and 1.
  - `WK_RAN_CODE` holds the code the command recorded.
    - It is empty whenever the runner itself failed (no lock, no start, no done file).
    - So a caller can tell the command's own 1 from the runner's.
  - `wk_body_traps <prefix> [<before-exit command>]` is a detached body's traps: the suite's, prove's and the CI watch's alike.
    - On EXIT the optional command runs, and `<prefix>: exit <code>` is the last line.
    - HUP, INT and TERM exit 129, 130 and 143, since bash runs the EXIT trap on a fatal signal with a stale status.
- `lib/detach.js`:
  - `node detach.js <log> <done> [--root <root>] -- <cmd> [args...]`.
  - The rule it runs (the checks, the verdicts, the evidence, the ends and every line they write): `../docs/tests.md` § The checks.
  - With `--root` the launcher first reads that root's `tests.check` (`checkMinutes` in `hooks/mods/settings.js`); a bad value exits 2 with nothing run.
  - The launcher truncates `<log>`, drops a stale `<done>`, and starts a supervisor copy of itself (`--supervise`, the minutes passed as `--check`) with `detached: true` and ignored stdio.
    - It prints its pid and exits 0. A bad argument list is 2.
  - The supervisor leads its own session (the Mac has no `setsid`), so the death of whatever started it changes nothing.
  - On macOS it starts `caffeinate -i -w <its own pid>` (`awakeCommand`). Other platforms start nothing.
  - It runs the command with stdout and stderr written to `<log>`.
    - The log is opened for writing, never append-only: a Git Bash child cannot write to the append-only handle Node makes on Windows.
    - The supervisor's own lines go through that same handle, at the command's offset.
  - Then it writes `<code>` to `<done>` through a temp file and a rename.
    - A command killed by a signal records 128 plus its number.
  - With `--root` it checks the run, each verdict from `judge` in `lib/pulse.js` (`FROZEN_CHECKS`, `LOOK_CHECKS`, `WORK_FLOOR`).
    - Each read of the processes is `treeOf` in `lib/tree.js`, `SAMPLE_MS` apart at most and `MIN_SAMPLES` to a check.
    - On Linux `treeOf` reads `/proc/<pid>/stat`, in hundredths; elsewhere `ps`.
  - A frozen run's tree is ended (`endTreeOf` in `lib/tree.js`), and `<done>` gets 124 (`FROZEN_CODE`).
  - A look is the evidence written whole to a `look` file beside `<done>`, for `wk_attach_run` to print.
  - An `end` file beside `<done>` is read every second (`END_POLL_MS`) and ends the run's tree; `<done>` gets 143.
    - Without `--root` too, so every supervised run can be ended so.
  - An end that rejects with the command alive writes no `<done>`, removes the `end` file, and leaves the end poll and the checks running.
  - On Windows `treeOf` is null, so nothing is checked; `endTreeOf` is one `taskkill /T /F`.
- `lib/git.js`:
  - `repoRoot(cwd)` is the git top level of `cwd`, trimmed. It is null outside a repo, or for a folder that is not there.
  - `headSha(cwd)` is HEAD's full sha, or null outside a repo or before its first commit.
  - Its callers each keep their own reaction to null:
    - `public/lib.js` throws its `PublicError`;
    - `changelog/changelog-links.js` prints `changelog-links: not a git repository.` and exits 1;
    - `ship/cut.js` (both reads) and `ship/deploy.js` refuse the run;
    - `ship/publish.js` reads its afterPublish hooks from its `--dir` itself;
    - `lib/io.js`'s `top` answers it as is.
  - `hooks/register.js` keeps its own `gitTop`, since the hooks module spawns through `$.process.run`.
- `lib/say.js`:
  - `sayAs(prefix)` is a writer of one `<prefix>: <text>` line on stderr.
    - It writes straight to the fd, so the line lands before the output of a child started after it.
    - Its callers: `ship/hooks.js`, `ship/cut.js`, `ship/deploy.js`.
  - `endOf(res)` is how a `spawnSync` child ended: `exited <code>`, `did not finish (<signal>)` or `could not be run, <error code>`.
    - It is the one phrasing of the ship's failure lines.
    - Its callers: `ship/hooks.js`, `ship/cut.js`, `ship/deploy.js`, and `plan.js`'s `npmEnd`, which puts `npm` before it.
  - `errLine(res, fallback)` is a failed child's first stderr line, else `fallback` (`endOf(res)` by default).
    - It is the why of a failure line.
    - Its callers: `ship/cut.js`'s gh view failure, `.github/scripts/ci-release.js`'s dispatch failure, `ship/publish.js`'s npm check, with `npmEnd` as its fallback.
- `lib/read.js`:
  - `readOrNull(file)` is its text, or null when it cannot be read.
  - `readJsonOrNull(file)` is its parsed JSON, or null when it cannot be read or does not parse.
  - Its callers each keep their own reaction to null:
    - `lib/settings.js` (the loader's read), `lib/io.js` (the io's `read`);
    - `identity/token.js` and `login.js`, `publish/site-repos.js`;
    - and `tower/api/lib/repos.js`, `sessions.js`, `board.js` and `health.js`.
- `lib/settings.js`:
  - `settingsAt(root, user?)` is `loadSettings` in `hooks/mods/settings.js`, read through `readOrNull` in `lib/read.js`.
    - The files: the kit's `defaults/settings.json`, then `<user dir>/settings.json` or `user`, then `<root>/.workkit/settings.json`, none with a null root.
  - `faultsAt(root, user?)` is the `settingsFaults` of those same files (`identity/token.js`, `ship/hooks.js`).
    - That is one `{ file, key, line }` per layer or value the merge set aside.
  - `homeSlug(workflowHome)` is the `site.repo` a machine folder's merged settings name, null unless it is an `owner/name` string.
    - Its callers: `identity/token.js`, `public/lib.js`, `ship/hooks.js`, `publish/site-repos.js`, `tower/api/lib/repos.js` and `summaries.js`, `jobs/morning/brief/cc-news.js`.
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
  - `lib.js`: the key, the link line, the `gh` calls.
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
    - It writes `{ token, login }` to `loginFile()`, `~/.workkit/identity/login.json` (the folder 0700, the file 0600, renamed into place).
  - `readLogin` and `writeLogin` are the store.
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
    - With no node 22.12 or newer found, the shim says `gh: the workkit gate did not run (no node 22.12 or newer found)` on stderr and goes on.
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
    - each with its facts from `lib/io.js`.
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
- `home.sh`:
  - Its stages: the login, the private repo, the clone into `~/.workkit/tower`, seeding the tower project into an empty one, its install, Discussions, Pages, the clone's own heal, the doctor lines.
  - It keeps the constants and the cloud runner list, and sources its stages from `home/`.
  - The readers of the site options every caller shares live in `home/options.sh`:
    - `wk_home_slug` for the repo;
    - `wk_site_host` for the custom domain, with its scheme and any trailing slash off;
    - `wk_site_sidebar` for the sidebar groups `publish/build.sh` merges.
  - The publish reads `wk_site_host` for the CNAME and the path prefix, and `setup` reads it for the published site's URL.
- `home/`:
  - Functions only, each sourced by the entry and never executed.
  - `options.sh`: the site options and the clone's state.
  - `repo.sh`: the login, the repo, the clone, the manifest transform.
  - `stamp.sh`: the version stamp.
  - `seed.sh`: the project's seed and sync.
  - `runner.sh`: the cloud brief's runner.
  - `install.sh`: the install, the catch-up, the commit and push, the clone's heal.
  - `services.sh`: Discussions and Pages.
  - `wizard.sh`: the home half of `setup`.
  - `doctor.sh`: the doctor lines.
- `publish.sh`:
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
  - One file: the prologue, the steps, and the flow that calls them.
    - The prologue: the settings file, jq and the home clone, each a named skip.
    - The steps are functions in run order, none declaring a local, so every value a step sets is there for the steps after it.
- `publish/build.sh`:
  - `build.sh <install|mint|build> <project dir> [path prefix]`.
  - `install` runs `npm install` inside the project.
  - `mint` runs the project's `omega manage --service=assets` at its brand root.
    - It fails when no `.omega/assets/logo` is left behind.
  - `build` first merges `site.sidebar` into a clone's sidebar (`build_sidebar_merge`, never on this checkout's own `tower/app`).
    - Then it runs `npm --prefix <dir>/targets/web run build` with `OMEGA_PATH_PREFIX` set.
    - It fails when no `dist` is left behind.
  - The merged sidebar exists only for the build.
    - When the script exits, on success or failure alike, the app's copy is put back.
    - So the clone matches the app, and the next sync and mint see no change.
  - Run, never sourced, loading `lib.sh` and `home.sh` itself.
    - `publish.sh` calls it for the home clone, and setup's `wk_home_install` calls its `install` there too.
    - `.github/workflows/pages.yml` calls it for this checkout's `tower/app`.
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
    - It sources `lib.sh` and `standards/githooks.sh`, and runs `ensure_git_hooks` when `git_hooks_installed` fails. `ensure_git_hooks`'s line is its only output.
  - A `test` event runs as the root suite only when two things hold:
    - it is bare;
    - the package npm is running (`npm_package_json`) sits at the git root of the run's folder.
  - npm hands a narrowed run (`npm test -- <file>`) its script text with the arguments appended.
    - So only the bare `npm_lifecycle_script` is the whole suite.
  - Every other `test` event is a package run, in the foreground.
    - That is a narrowed run anywhere, or a nested package's or workspace member's (`-w`) bare run.
    - It hashes the package's own id, the code it can see, as `wk_tree_hash <root> <pkg>`.
    - The rule: `docs/hooks.md` § `safety:proof-guard`, the package id bullet.
    - `<pkg>` is the package's folder relative to the root, `.` for the root and its whole tree.
    - It runs the script with `sh`, and on exit 0 hashes the same id again.
    - An unchanged id writes the package's line `<id> <pkg>` to the package record (`wk_pkg_marker_write` in `lib/suite.sh`).
    - A changed one writes nothing, said in one `script-shell:` line.
    - So a narrowed root run records `.` on the whole tree, and a `-w` or nested run records the member on its own id.
    - A package run skips the hold, the CHANGELOG lint and the detach. All three belong to the bare root run only.
  - That run is first judged by the full-suite hold (`wk_suite_hold` in `lib/hold.sh`, with the working tree's hash).
    - A refusal exits 1 with no suite run and no record written. A root `pretest` has already run.
  - Then it takes the commit gate's cheap check.
    - Every tracked `CHANGELOG.md` that `git status --porcelain -z` shows modified goes through `wk_changelog_lint` (`lib/changelog.sh`).
    - `-z` makes a path with a space read as it is.
    - A failing entry exits 1 with `script-shell:` and the gate's own message, before any suite starts and with no record written.
    - A tree with no modified CHANGELOG runs no lint.
    - With no node or no linter the check stands aside, as the gate's does.
  - The root suite then runs detached (`lib/detach.sh`), in its own session.
    - It runs as this file again, with `--suite-body <root>` ahead of npm's arguments.
    - That body hashes the tree, runs the script with `sh`, and on exit 0 hashes again.
    - An unchanged tree writes the proved-tree record (`lib/suite.sh`); a changed one writes nothing.
  - Its stdout and stderr go to the suite log, truncated per run, which the foreground tails to stdout.
    - The log is `wk_suite_log_path`: `.workkit/suite.log` where git ignores it, else under `~/.workkit/markers`.
    - The body's last line is always `script-shell: exit <code>`.
    - The suite writes to that file, never to a terminal. So a colour or reporter choice that looks for a terminal sees none.
  - npm's exit code is the script's, with one exception.
    - A green run exits 1 when its tree cannot be hashed (on either side of the run), or its record cannot be written.
    - A changed tree, an unhashable one and an unwritable record are each one `script-shell:` line in the log.
    - That line reaches the terminal on stdout through the tail, like every body line.
  - A kill of the shell that ran `npm test` leaves the suite running to its record.
    - So a cut-off agent reads the log for the result.
  - An INT, a human's Ctrl-C, ends the suite, a child in its own session included, and exits 130 with no record (`lib/detach.sh`).
  - The run is passed `--root <root>`, so its supervisor checks it (`lib/detach.js`).
    - A frozen suite is ended and exits 124, the log's last line the frozen line.
    - A look exits 125 with the suite still going, and a green end still writes its record.
  - A second root `npm test` while one runs starts nothing.
    - It prints `script-shell: a root npm test is already running (pid <pid>); its output is in <log>` on stderr, exit 1.
  - Another engine proves a tree by an adapter of its own that writes the same record.
  - On Windows npm starts `script-shell.exe` instead, which hands the same call to this file under Git Bash.
    - The detached suite outlives the exe's wait.
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
  - It decides nothing about recording: that is the wrapper's.
- `prove.sh`:
  - The ship runs it instead of the root `npm test` when the folder holds work the commit leaves out.
    - That is when, after staging, `git diff --quiet` fails or `git ls-files --others --exclude-standard` prints a file.
  - Run at the repo root with no arguments, it adds a detached worktree of HEAD outside the repo, at `copy` in a run folder of its own (`wk_proof_dir`, `~/.cache/workkit/proof/<id>`).
    - The add goes through `hook_snapshot_worktree_add`, the shared add in `hooks/lib/snapshot.sh` that tries three times against a racing one.
  - It checks the whole index's tree out into it.
    - That is `write-tree` on a scratch copy of the index (`wk_index_copy` in `lib/suite.sh`).
    - So the real index is never written, nor blocked by a held `index.lock`.
    - The record and the before/after compare use the same copy's id less `.workkit/`, through `wk_index_write_tree`.
  - It fills the copy from the live folder with only the paths an ignore pattern matches (`hook_snapshot_fill`).
    - That is the fill red-proof uses, its relink of each package's `node_modules` included on every platform.
    - So an untracked or unstaged file stays out of the copy.
  - A copy whose tree is not the index's runs nothing.
  - The suite runs there as `npm test --script-shell=<sh>`, plain `sh` spelled for node.
    - So the copy writes no record of its own.
  - On green, with the copy's tree unchanged, the index's tree is recorded for the real repo (`wk_suite_marker_write`).
  - The working folder and the index are never changed.
  - The copy is removed on every exit (`hook_snapshot_worktree_remove`, the shared removal beside the add), and its run folder with it.
  - It shares the root run's log and lock (`wk_suite_log_path`, `wk_suite_lock_path`, run through `lib/detach.sh`).
    - So one full run goes at a time. A second prints the holder's pid and the log, exit 1.
    - Its closing line is `prove: exit <code>`; a `detach:` line follows it after a frozen or requested end.
    - It is passed `--root <root>` too: a frozen run exits 124 with no record and its run folder gone, the frozen line after its `prove: exit 143`, and a look exits 125 with the run going on.
  - A red run prints so, and exits with the suite's code.
  - Every other way no record is written exits 1 with one `prove:` line:
    - no test script, no npm, an unwritable index tree;
    - a failed add or fill, a changed copy, an unwritable record.
  - Before the detach, the full-suite hold (`wk_suite_hold` in `lib/hold.sh`) judges it against the index's tree.
    - A refusal exits 1 with nothing run.
- `supervise.sh`:
  - `workkit supervise -- <command> [args...]` runs any command the way the root `npm test` runs: detached, read by the supervisor, its output tailed to the call.
    - A narrowed `npm test -- <files>`, a lane or a build started in the background goes through it (`../docs/agents.md` § Watching a run).
  - A call with no `--` or no command prints `usage: workkit supervise -- <command> [args...]`, exit 2.
  - Outside a git repo it prints `supervise: not inside a git repository`, exit 1.
  - A command the supervisor reads already is refused before anything starts, since its own supervisor would leave the outer one's reach.
    - Those are the bare `npm test` or `npm run test` in the repo root, the bare `workkit test`, and `workkit prove` and `workkit supervise` with any arguments.
    - It prints `supervise: the supervisor reads <command> already; run it without workkit supervise`, `<command>` as the call spelled it, exit 2.
    - A narrowed `npm test -- <files>` at the root, and a bare `npm test` in a folder under it, still run.
    - The JS twin of the test is `bareNpm` and `bareWorkkit` in `hooks/mods/unwatched.js`.
  - It runs `supervise.sh --body -- <command> [args...]` through `wk_run_detached` (`lib/detach.sh`), passed `--root <root>`.
    - The body runs the command in the folder the call was made in, and exits with its code.
    - The body's last line is always `supervise: exit <code>`.
  - It has its own log and lock (`wk_run_log_path`, `wk_run_lock_path` in `lib/suite.sh`), beside the root run's.
    - The log is `.workkit/run.log` where git ignores it, else under `~/.workkit/markers`.
    - So one supervised run goes at a time per repo, beside the suite's own.
    - A second prints `supervise: a supervised run is already running (pid <N>); its output is in <log>`, exit 1.
  - The call exits with the command's own code, 124 after a frozen end, or 125 on a look with the run going on (`lib/detach.js`).
  - An INT ends the whole run, a child in its own session included, and exits 130 (`lib/detach.sh`); a kill of the calling shell leaves it running to its end.
  - No allow rule ships for it: it runs any command, so it is permitted the way that command is.
- `watch.sh`:
  - `workkit watch [--end] [suite|run]` attaches the call again to the repo's live run.
    - Any other argument prints `usage: workkit watch [--end] [suite|run]`, exit 2.
    - Outside a git repo it prints `watch: not inside a git repository`, exit 1.
  - With no name it follows the suite's run (`wk_suite_log_path`, `wk_suite_lock_path`) when that run is live, else the supervised one.
    - `suite` names the suite's run, `run` the supervised one.
    - Live is `wk_run_held` (`lib/detach.sh`): a pid file in the lock, and the pid alive or the done file written.
    - So a run that ended with no call attached, after a look, still counts as live until a call collects its answer.
    - With no live run, or the named one not live, it prints `watch: no run is live in <root>`, exit 1.
  - `--end` with no name while both runs are live ends neither.
    - It prints `watch: two runs are live; name one: workkit watch --end suite, or workkit watch --end run`, exit 2.
  - It prints the log's last 20 lines, then tails it from there through `wk_attach_run`.
    - It ends at the run's end, a frozen end or the next look, with the same exit codes as the call that started the run.
    - A run that ended already gets its answer at once: the last 20 lines, the run's code as the exit, and the lock dropped, so a second `workkit watch` prints the no-run line.
    - Ctrl-C ends the call only: the run goes on, and its lock stays held.
  - `--end` writes the `end` file in the run's lock folder, the supervisor's end request, and waits through `wk_ask_end` (`lib/detach.sh`).
    - Once the done file is written, it prints the log's last line (the supervisor's closing line) and exits 0.
    - When it finds the done file it collects the answer through `wk_attach_run` too, so the lock drops, and a call still attached reads the code from its record.
    - A run that ended already prints `watch: the run ended already (exit <code>)`, drops the lock and exits 0.
    - A run that has not ended 30 seconds later prints `watch: the run did not end; its supervisor is pid <N>`, exit 1.
  - An allow rule ships for the verb, `Bash(workkit watch:*)` (`ALLOW_RULES` in `workkit/allow.sh`), so it runs as its own Bash call (`../docs/hooks.md` § `workflow:bare-call`).
- `githooks/`:
  - The heal (`standards/githooks.sh`) sets them as `~/.claude/workkit/githooks`, through the engine link.
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
    - With no node 22.12 or newer found, it says `<hook>: the workkit judge did not run (no node 22.12 or newer found)` on stderr and goes on.
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
- `changelog/changelog-job.sh`:
  - Sourced by `standards.sh`, functions only.
  - `safety:commit-gate` runs it as a program through its entry (`rewrite`, `copies`, `names`).
  - The copies' two names (`wk_linter_copies`).
  - Whether a workflow folder still runs one (`wk_workflows_run_copy`): a mention outside a comment line.
    - It is the one definition the heal and the gate both ask.
    - It answers 0 yes, 1 no, and 2 for a folder or a grep that could not be read.
    - The heal reads 2 as keep, and the gate as a named block.
  - The template's address.
  - Whether a repo's `package.json` names `workkit-core` in its devDependencies (`wk_has_core_package`), which the test-runner check asks.
  - The rewrite (`wk_checks_heal_rewrite <template>`, the entry's `rewrite [template]`).
    - It is the template with the cwd repo's default branch in place of `__DEFAULT_BRANCH__`, whatever the file held. So no file is read.
    - That branch is `wk_default_branch`, the one read branch protection shares.
    - It is GitHub's answer (`gh api repos/{owner}/{repo} --jq .default_branch`), else `origin/HEAD`'s, else a failure, never a guess.
    - On a failure the rewrite exits 2, the entry naming `git remote set-head origin -a` on stderr.
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
    - a stray line among the entries.
  - It never commits, tags or pushes.
- `ship/plan.js`:
  - The command: `workkit ship plan [--dir <root>]`. It publishes nothing.
  - It is the library `release.js`, `publish.js` and `lib/workspaces.js` require.
    - It gives the first two how they name npm's end: `npmEnd`, `lib/say.js`'s `endOf` after `npm`.
    - It gives its workspace reading: `expandWorkspaces` for `release.js`.
    - For `lib/workspaces.js` it gives that with `readJson` and `depNamesOf` (the dependency fields, `optionalDependencies` among them).
  - Its lines and refusals speak as `publish-plan:`.
- `ship/publish.js`:
  - It prints the plan `plan.js` prints, then publishes it in order from the root.
  - It asks npm first whether each version is already out: a `skipped` line, and the run goes on.
  - It stops at the first failed publish, naming what was and was not published.
  - A run that published at least one package and exits 0 then runs the afterPublish hooks (`ship/hooks.js`) of the repo `--dir` sits in.
    - They are read from its git top level, so a run from a member folder reads the root's `.workkit/settings.json`.
    - One failing prints `publish-plan: <N> published; an afterPublish hook failed.` and exits 1.
  - A run that publishes nothing, or fails, runs none.
  - It never runs `prepare`.
- `ship/cut.js`:
  - It runs from inside the repo, at its root (`repoRoot` in `lib/git.js`).
  - The repo's `checks.yml` `release` job (`release.yml`, `.github/scripts/ci-release.js`) makes `v<x.y.z>` when the release commit reaches the default branch.
    - That is the same on a machine and in a cloud session.
  - The cut first checks that `.github/workflows/checks.yml` holds a top-level job named `release`.
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
  - The wait asks every `WORKKIT_CUT_RELEASE_POLL` seconds (10), for `WORKKIT_CUT_RELEASE_TIMEOUT` seconds in all (600, the `<n>` of its failure line).
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
    - no `release` job is `ship-cut: .github/workflows/checks.yml has no release job; run the standards step (workkit standards) and commit the caller`, exit 1;
    - no `[x.y.z]` section with entries, a folder outside a repo or no HEAD commit is one line, exit 1;
    - no release within the wait is `ship-cut: no release v<x.y.z> after <n>s; check the release job: <url>`, exit 1, no hook run;
    - that url is HEAD's `checks.yml` run (`gh run list --commit`), else the repo's Actions page;
    - a hook failing prints `ship-cut: v<x.y.z> was released; an afterRelease hook failed`, exit 1, the release standing.
- `ship/deploy.js`:
  - It runs `npm run deploy` when the root `package.json` has `scripts.deploy`.
  - Else it runs `npm run release` when it has only `scripts.release`.
  - It runs through `lib/run.js`'s `spawnSync`, output passed through.
  - On exit 0 it runs the repo's afterDeploy hooks (`ship/hooks.js`).
  - It never asks: the owner's yes is the ship skill's Step 6.
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
- `ship/watch.sh`:
  - It expands a sha shorter than 40 characters to the full commit id, since `gh run list --commit` matches only that.
    - It uses `git rev-parse --verify --quiet <sha>^{commit}` from the repo root.
    - A full sha is used as given.
  - Then it finds the sha's runs (`gh run list --commit`).
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
    - 0 and `ci-watch: no CI configured for push`, when no workflow under the repo's `.github/workflows/` names `push` in its top-level `on:` (`ship/triggers.awk`);
    - 3 and `ci-watch: run not queued yet for <sha>`, when one does.
  - A usage error is 2.
    - So is a short sha the clone cannot resolve, with a line on stderr before any `gh` call.
    - That line is `ci-watch: <sha> is not a commit this clone knows; fetch it or pass the full sha`.
  - gh failing is 4 with the line:
    - a `gh run list` that failed or answered no run list;
    - a `gh pr list` that failed (`ci-watch: gh pr list --head <branch> failed: <its first error line>`);
    - a `gh pr list` that answered no PR list (`ci-watch: gh pr list --head <branch> answered no PR list: <its first line>`);
    - a watch that exited non-zero on a run gh cannot then show as finished (GitHub unreachable, the login refused).
    - That is no answer rather than a red.
  - The watch runs detached through `wk_run_detached` (`lib/detach.sh`), as this file again in its `--watch-body <sha>` mode.
    - So a kill of the invoking shell leaves it going to its answer.
    - Its output, stdout and stderr alike, goes to the CI log, truncated per call.
    - The log is `wk_ci_log_path`: `.workkit/ci.log` where git ignores it, else under `~/.workkit/markers`.
    - The output reaches the terminal on stdout through the tail, every line above included.
    - Its first line is `ci-watch: watching <sha>`.
    - Its last is `ci-watch: exit <code>`, the code the foreground exits with, but after an INT.
  - A run that fails non-zero while that last line does not carry its code is the runner failing, never a red.
    - That is when the runner could not start, or the supervisor died.
    - It prints `ci-watch: the watch did not finish, so there is no answer; its output is in <log>` on stderr, exit 4.
  - The file is functions only, `main "$@"` its last line, so an edit to the kit during a long watch never runs a fragment.
  - A second watch while one runs starts nothing.
    - It prints `ci-watch: a watch is already running for <sha> (pid <pid>); its output is in <log>` on stderr, exit 5.
  - INT ends the watch through the end request (`lib/detach.sh`), exit 130: the log ends with the request line, under `ci-watch: exit 143`.
- `ship/triggers.awk`:
  - It reads `on:` in any of its YAML shapes: a scalar, a flow list, a block of keys or items.
  - The call: `awk -v ev=<event> -f triggers.awk <file>`.
  - Carriage returns are dropped, and single quotes read as double.
  - An event nested deeper is never one.
  - `ship/watch.sh` asks it for `push` and `pull_request`.
  - `.github/scripts/ci-release.js` asks it for `release` and `workflow_dispatch`.
- `ship/dispatch-input.awk`:
  - The call: `awk -v input=<name> -f dispatch-input.awk <file>`.
  - It is true only for a key of `inputs:` under `workflow_dispatch:` under the top-level `on:`, each in block style.
  - It reads carriage returns and quotes as `triggers.awk` reads them.
  - The same key anywhere else (a step's `with:`, an input's property) never counts.
  - `.github/scripts/ci-release.js` asks it for `tag`.
- `ship/items.sh`:
  - The line is `<stage> #<N> <proved|unproved> <title>`, qa first then complete, each by number.
  - `proved` is a comment line starting `Proof:`.
    - That is the same pattern `safety:proof-guard` reads (`PROOF_RE` in `hooks/mods/proof.js`), and the two change together.
  - Nothing at either stage prints `ship-items: nothing at qa or complete`.
  - A failed `gh` prints one `ship-items:` line on stderr and exits 1.
  - A usage error exits 2.
  - The command: `workkit ship items [--repo owner/name]`.
- `review/covers.sh`:
  - The marker must be newer than every modified, staged and untracked path, and than the folder a deleted path left.
    - The one change it passes over is the heal's removal of the retired `version` key from `.workkit/settings.json`.
  - It prints `review-covers: covered` and exits 0, or `review-covers: stale: <why>` and exits 1.
  - A usage or git failure exits 2 (`docs/hooks.md` § `safety:commit-gate`).
- `proof/red.sh`:
  - It runs the command against the named paths as the claim's snapshot holds them.
    - That is in a worktree copy, or, with `--live`, swapped in the live tree.
    - Either mode's run folder is `wk_proof_dir`'s, under `~/.cache/workkit/proof`, removed on every exit but one: a `--live` run that cannot restore the live tree keeps it.
  - Red exits 0, green 1, and any other stop 2 with a `red-proof:` line.
  - The load check reads a missing module in three spellings before it compares it with the named paths:
    - its own path;
    - its path through a workspace link, the nearest folder that exists resolved physically (`physical`, which `root_relative` reads through too);
    - a bare specifier with a subpath, against its package folder in the nearest `node_modules` at or above the requiring file (`module_path`).
  - The copy, the load check, the summary check and the limits are `docs/agents.md` § Crew sizing.
    - In the summary check, a node test summary with no test, or a failing run with none failed, is a stop.

## The one command

- `workkit.sh` is the front door.
- From zero on a new machine, the whole recipe is a clone and one line:

```sh
git clone https://github.com/ITW-Creative-Works/workkit.git && cd workkit
./workflow/workkit.sh setup
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
- It adds each of the kit's allow rules missing from `~/.claude/settings.json`.
  - Every other key is untouched, and a file already holding them all is never written.
- It installs the 9am schedule through `jobs/install.sh`.
- It creates the home repo, and clones the tower project into `~/.workkit/tower`.
- It wires the cloud brief's secrets onto the home repo, where that brief runs and where it is delivered.
- It says whether this machine is signed in for the bot identity, signing in there at a keyboard.
- It says where the tower is started.
- It hands this machine's `gh` login token to the dashboard it just published.
- It offers to enable the repo the shell is standing in.
- It symlinks itself to `~/.local/bin/workkit`, and the `gh` shim to `~/.local/bin/gh` beside it.
  - Where that directory is not on the PATH it prints the one `export` line to add.
  - It never edits a shell rc.
- Every step checks before acting, so a second `setup` reports nothing to do.
- `setup` and `doctor` say all of that in titled sections, one blank line apart, in the order the steps run:
  - **This machine** (plugin, gh, the three links, the kit's allow rules, the schedule);
  - **Home repo**;
  - **Cloud brief secrets**;
  - **Identity** (setup only; doctor's two identity lines sit under This machine and This repo);
  - **Dashboard site** (setup only);
  - **This repo**.
- Each title is a bold line opening with its emoji.
- `update --auto` prints neither the titles nor the blank lines.
  - A session-start injection stays terse, and `QUIET` is what silences them.
- The line shape, the levels, the color rule and the spinner are all [Output](#output) below.

| Command | What it does |
|---|---|
| `workkit help` | the map (also what a bare `workkit` prints) |
| `workkit setup` | the wizard above, the only path that installs a schedule for the first time; its This repo section, in an enabled repo, sets git's commit hooks when they are not set (`ensure_git_hooks`), then says `git hooks: installed (<path>)`, or warns `git hooks: not installed; run workkit setup` when they still are not |
| `workkit setup --token` | the wizard's Claude-token step alone, forced: mint a `CLAUDE_CODE_OAUTH_TOKEN` and push it to the home repo however young the one there is: the flag IS the yes, so there is no age check and no question. Nothing else of setup runs. A token that went bad while young (a lapsed subscription) is what the age check cannot see |
| `workkit setup --login` | the wizard's sign-in step alone, forced: `identity/login.js` signs in to GitHub through the device flow, the browser opened to the device page, so the agent's bookkeeping posts as `workkit-agent[bot]`, replacing any sign-in already here. It runs the sign-in with or without a terminal. Nothing else of setup runs ([The bot identity](#the-bot-identity)) |
| `workkit setup --bot` | the wizard's App install step alone, forced; nothing else of setup runs ([The bot identity](#the-bot-identity)) |
| `workkit setup --home` | the wizard's home repo step alone, forced; nothing else of setup runs ([The home repo's lifecycle](#the-home-repos-lifecycle)) |
| `workkit setup --cloud` | the wizard for a cloud session (claude.ai/code, `CLAUDE_CODE_REMOTE=true`) |
| `workkit update` | re-runs the machine-side installs: the engine address, the two `~/.local/bin` symlinks (`workkit` and the `gh` shim), npm's `script-shell`, the kit's allow rules in `~/.claude/settings.json`, and the schedule |
| `workkit update --auto` | the quiet variant the standards hook runs; prints only what it changed |
| `workkit doctor` | reports drift, with the fix command for anything out of its reach |
| `workkit publish` | builds the tower project and pushes the site to the home repo's `gh-pages` branch; the daily job runs the same script after the brief |
| `workkit brief` | today's brief, asked for now: the same `gh workflow run brief.yml` dispatch the 9am schedule makes, through the same one function (`jobs/brief-dispatch.sh`) and the same secret guards. A human is standing here, so a refusal names its reason and exits 1 rather than being logged and carried past, and a dispatch that lands prints where to watch the run |
| `workkit brief --local` | the rehearsal instead: `jobs/morning.sh --now`, the full local morning with the brief composed and sent from this machine and never posted to the home repo. The other steps still run where they can: the summaries can post their Discussion, and the site publish fires when it is switched on |
| `workkit enable [repo]` · `workkit decline [repo]` | `standards.sh --enable` / `--decline` under the one name |
| `workkit heal [repo]` | `standards.sh` with no flag under the one name: the repo's heal, on the shell's own repo or the one named, run NOW: the session hook makes the same pass once a day, and this is how a repo gets it without waiting |
| `workkit tower` | runs the tower here: the JSON API (8693) and the dashboard (4300) together; replaces any previous instance on those ports, and one interrupt ends both |
| `workkit state [repo]` | `standards.sh --state` under the one name: the repo's participation, one word on stdout (`enabled`, `disabled`, `declined`, `undecided`, `home` or `nogit`) |
| `workkit note <text...>` | `wk.sh note`, unchanged |
| `workkit log [-n N] [--follow]` | the hooks log (`docs/hooks.md` § The hooks log): the last 40 lines, `-n <N>` that many, `--follow` keeps printing new ones |
| `workkit test [paths]` | hands its arguments to this repo's `npm test`, run at the repo root, so the one recorder, npm's script shell, sees the run |
| `workkit tools` | prints every command this repo's suites name through `needs()`, one per line, sorted and unique, for a setup to install |
| `workkit prove` | `prove.sh`: the root suite on exactly the staged tree, in a copy outside the repo, recorded on green, so a commit of it passes the gate while other work stays in the folder unstaged |
| `workkit supervise -- <command> [args...]` | `supervise.sh`: the command run detached under the supervisor, as the root suite runs, its output tailed to the call and kept in the run log; it exits with the command's code, 124 after a frozen end, 125 on a look |
| `workkit watch [--end] [suite\|run]` | `watch.sh`: the call attached again to the live run, the suite's before the supervised one, or the one named; `--end` asks the supervisor to end it, and with both runs live and no name it refuses, exit 2 |
| `workkit public intake` · `mirror <N>... \| --all` · `close <version> <N>...` | the public pairing, run from the private repo: `public/intake.js`, `public/mirror.js`, `public/close.js` (the `public/` row above); the triage drain runs the intake, `workflow:public-mirror` and the daily heal the mirror, the ship's close step the close |
| `workkit ship items` · `release <x.y.z> [--keep N,M]` · `watch <sha>` · `cut <x.y.z>` · `plan` · `publish` · `deploy` | the ship's steps, run by `workkit:ship`: `ship/items.sh`, `ship/release.js`, `ship/watch.sh`, `ship/cut.js`, `ship/plan.js`, `ship/publish.js`, `ship/deploy.js` (their rows above) |
| `workkit review covers` · `mark [full]` | the review tier and the review marker: `review/covers.sh`, `review/mark.sh` |
| `workkit triage mark` | the triage marker: `triage/mark.sh` |
| `workkit proof red [--live] <path>... -- <command>...` | the verifier's red run: `proof/red.sh` |
| `workkit changelog lint <file> [flags]` | the CHANGELOG entry check: `changelog/lint.js` |

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
  - It sets npm's `script-shell`, and the kit's allow rules in `~/.claude/settings.json`, as a human's `update` makes them.
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
    - each of the kit's allow rules missing from `~/.claude/settings.json`, and each retired one still in it;
    - schedule vintage, the roster count;
    - the tower clone's state (unset · absent · clone · other, plus ahead/behind/diverged);
    - whether that clone was written by a NEWER kit than this one;
    - whether the cloud brief's seeded runner still matches this kit, and the cloud brief's secrets;
    - the bot identity's sign-in, and whether `workkit-agent[bot]` is installed on this repo;
    - this repo's state and, in an enabled repo, its git commit hooks.
  - The hooks line is `git hooks: installed (<path>)`, or the warning `git hooks: not installed; run workkit setup`.
  - Every warning counts toward the closing tally, gh's included.
  - In a cloud session (`wk_is_cloud`) some checks are each one not-applicable line, counted by nothing.
    - Those are the schedule, the home clone, its runner, the cloud brief's secrets and the sign-in.
    - The rest stay real checks.
- `workkit test [paths]`:
  - A package.json with no `test` script is one error line and exit 1.
  - So is the verb started inside an `npm test`, where `workkit` should have been `workkit-core`'s bin.
    - That line is `workkit-core is not installed here: run npm install` (`docs/tests.md` § The kit's runner).
- `workkit tools`:
  - A `needs()` argument that is not a string literal is `✖ tools: <file>:<line>: needs() takes string literals only`, exit 1.
  - An argument to the verb exits 2.
  - It runs the kit's own `packages/core/bin/workkit.js` with `node` at the repo root, never the repo's installed package.
    - So it answers before `npm install`.
  - No `workkit-core` beside the engine, or no `node` on PATH, is one error line and exit 1 (`docs/tests.md` § The kit's runner).
- **Upkeep is automatic.** Claude Code has no plugin-install hook, so the trigger is the one this kit owns.
  - The `workflow:standards` SessionStart hook's once-per-day run calls `workkit update --auto`.
  - It is resolved beside the engine, never through the PATH or the symlink, which are exactly what may not exist yet.
  - A moved kit needs nothing, since the schedule reaches its job through the engine's address.
  - A job template that changed is corrected the next morning, instead of waiting for someone to remember the installer.
  - Two boundaries keep that safe:
    - **It only ever UPDATES a schedule a human already installed**: the installed `com.workkit.claude-daily.plist` is the marker. A machine with no schedule never gets one at session start.
    - **It creates no convention it did not find.** `~/.local/bin` is linked when the directory already exists; making it is a human's `setup`, or in the cloud `setup --cloud`'s or `standards.sh --command-link`'s. The same restraint the engine's address shows toward `~/.claude`.
- **Setup is pestered for, never performed.** The same hook checks one thing above every gate it has: `~/.local/bin/workkit`, the command `setup` installs.
  - While that is missing (absent, dangling, or not executable), EVERY session is told to run `bash <engine>/workkit.sh setup` itself before other work.
    - That holds in a participating repo or no repo at all.
    - The session hands the user only what it prints.
  - There is no daily cache, because a machine without setup has no schedule, no home repo, and no command.
  - The pester stops the moment the link exists, whoever made it.
  - `standards.sh --command-link` makes the command link alone, for a bootstrap that runs no setup at all.
  - A cloud bootstrap that does run setup calls `workkit setup --cloud`, which makes the link itself.
  - It never runs anything itself.
- The drift question is answered by `jobs/install.sh --check`, which renders and compares without asking launchd anything.
  - Most session starts never get that far: the hook's daily marker returns first.
  - The once-a-day run that does costs a few short shell invocations and a `plutil` lint, with no launchd call and no network.
- Agents themselves never issue launchd commands. Their path is `workkit doctor`, which reports and fixes nothing.

## Output

- One voice for everything the engine, the jobs and the tower say to a person:
  - a GLYPH says what kind of line it is;
  - the `task:` the line belongs to is bold;
  - the steps sit indented under the title or the section that opened them.
- `workflow/lib/voice.sh` (sourced through `lib.sh`) is the shell home, and `tower/api/lib/log.js` the Node one.
  - The two print the same shape.

| Call | Opens with | Color on a terminal | Stream | `QUIET=1` |
|---|---|---|---|---|
| `wk_title "<emoji> workkit setup in <dir>"` | the caller's emoji | bold | stdout | silent |
| `wk_section "<emoji> This machine"` | a blank line, then the caller's emoji | bold cyan | stdout | silent |
| `wk_ok "task: message"` | `✓` | glyph bold green, `task:` bold, message plain | stdout | speaks |
| `wk_skip "task: message"` | `·` | the whole line dim | stdout | silent |
| `wk_info "task: message"` | `›` | glyph cyan, `task:` bold, message plain | stdout | silent |
| `wk_warn "task: message"` | `⚠` | glyph and message yellow, `task:` bold yellow | stderr | speaks |
| `wk_warn_lines task "task: message"` | `⚠` on each non-blank line, each prefixed `task:` | as `wk_warn` | stderr | speaks |
| `wk_error "task: message"` | `✖` | glyph and message red, `task:` bold red | stderr | speaks |
| `wk_done "message"` | `✨` | bold green | stdout | silent |
| `wk_spin "message" <cmd...>` | a braille frame, or `⏳` off a terminal | frame cyan, message plain, `(Ns)` dim | stderr | the static form is silent |
| `wk_enter_to_open "<url>" "<label>" "<prompt>"` | the prompt, then `URL:` and a green `?` Enter gate | URL cyan, the no-browser line dim | stderr | speaks |
| `wk_open_url "<url>"` | nothing when an opener runs; else the no-browser line | dim | stderr | speaks |
| `wk_ask_yes "<prompt>" <y\|n>` | the prompt, then `[Y/n]` or `[y/N]` by the default | plain | stderr | speaks |
| `wk_poll "message" <seconds> <check...>` | the dim `(enter)=check now, (s)=skip` hint, then a braille frame counting down, or `⏳` off a terminal | frame cyan, message plain, `(Ns)` dim | stderr | speaks |

- The `task:` is the first word of a message that reads `<word>: <rest>` (`engine:`, `command:`, `schedule:`, `gh:`, `site:`).
  - The renderer splits it off and paints it.
  - A message with no such opening prints as it is.
- A level line carries its glyph and nothing else.
- A title, a section and the closing line carry an EMOJI the caller picks for what that part of the command does.
  - One per section name, the same one wherever that section appears.
- A command opens with its title, groups its steps under sections, and closes on the answer to "is there anything for me here?".
  - `wk_done` when there is not, and a `wk_warn` naming the count when there is.
- `wk_title` and `wk_section` set the two-space indent every level line under them carries.
  - A script that prints neither (`standards.sh`, `wk.sh`, the jobs) sets `WK_LOG_INDENT` itself, or stays flush left, as it always did.
- Color is a terminal's affordance and nothing else's. `lib/voice.sh`'s `wk_color_on` is the one gate.
  - It says no to a pipe, to `NO_COLOR`, and to a `dumb` TERM.
  - So a log file, a captured hook payload and a piped run get the same glyphs and the same words with no codes, byte for byte.
  - `WORKKIT_COLOR=1`/`0` overrides the tty question either way, which is how the suites read the styled shape back.
  - The Node half applies the same rule to `process.stdout.isTTY`.
- Two variables bend the rest, and nothing else does.
  - `QUIET=1` in the caller silences the lines that only report, which is what `update --auto` and the session-start heal lean on.
  - Under `QUIET=1` an action, a warning and a stop still speak.
  - `WK_LOG_STDERR=1` puts every level on stderr, for a caller whose stdout is a MACHINE answer (`standards.sh --state`).
- A line relayed from another part of the kit goes through `wk_plain` first, which takes the indent and the glyph off.
  - So the relay re-says it under its own glyph, rather than letting a line wear two.
- **A spinner on every awaited call.** `wk_spin "<message>" <command...>` wraps each awaited call:
  - each `gh` call, each `git clone` / `fetch` / `pull` / `push`;
  - the publish build, the Pages poll and the launchctl waits.
  - On a terminal it animates omega's braille frames on stderr, with the elapsed seconds beside them, and erases the line when the call returns.
  - Anywhere else (a pipe, a log file, launchd, the suites) it prints `⏳ <message>...` once on stderr.
  - The wrapped command runs in the foreground, so its stdout and its exit status pass through untouched.
    - So `x="$(wk_spin 'reading the roster' gh api ...)"` captures the answer alone.
  - `WORKKIT_SPIN=0` forces the static form.
- Two things are deliberately not log lines:
  - a PROMPT (it carries no newline, because the answer is typed on it);
  - a script's stdout that is DATA (`standards.sh --state`, the reason `jobs/brief-dispatch.sh` hands its caller, a JSON payload).
- `jobs/install.sh --check` is neither: its drift lines ARE glyph lines.
  - The caller reading them (`workkit update`) strips each one with `wk_plain`, and re-says it under its own.
- Three things print plain glyphless lines by design:
  - The kit's own hooks, whose output is context for an agent rather than a terminal.
  - The engine's Node CLIs (`changelog/lint.js`, `changelog-links.js`, `release.js`, `cut.js`, `plan.js`, `publish.js`, `deploy.js`, `site-repos.js`), whose lines are read by CI, by a hook bounce or by the ship.
  - And the CHILDREN a command runs (`omega` under the tower, `npm` under the publish), which speak as themselves.

## The capture CLI

- `wk.sh` gets a thought out of a head and into a capture file with no session, no agent, and no network:

```sh
workkit note fix the tower poller
```

- The words after `note` join with spaces, so the call works unquoted.
- The bullet lands in the capture file of the repo the shell is standing in.
  - A walk UP from the current directory decides it, to the first ancestor that passes both tests:
    - it is a git repo root (a `.git` directory or file);
    - its `.workkit/settings.json` says the repo participates.
- Standing outside one, there is no capture file to write to.
  - The note is filed as a `status:inbox` issue on the home repo instead.
  - Where there is no clone yet (or no way to reach GitHub), it hands the note back on stderr and exits 1.
  - It does so rather than buffering a thought no triage run reads.
- A missing capture file is created from `templates/capture.md`, so a hand-made file reads exactly like a seeded one.
- Existing content is only ever appended to.
- No arguments, an unknown subcommand, or an empty note prints usage on stderr and exits 1.
- Triage drains the capture files into issues.
  - The captures made outside a project are issues already, and triage's HQ pass drains those from any repo.
- Putting it on the PATH or behind an alias is the user's own shell config (dotfiles).
  - The heal maintains the address below, and nothing beyond it.

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
  - Every heal is idempotent, so `standards.sh` runs all of them on each daily heal.
  - A heal with nothing to do writes nothing.
- A `version` key an older kit left in `.workkit/settings.json` is removed by the heal (`remove_version_stamp`), the file otherwise untouched.
  - Without `jq` it says so in one warning, and writes nothing.
- What a script must not decide alone is the `workkit:migrate` skill's own scan, run when someone asks for it:
  - `PROGRESS.md`, `INBOX.md`, `TODO.md` and `plans/`, each still holding work items nobody migrated;
  - and a `CHANGELOG.md` history outside the entry format.
- The format of new entries stays judged at the edit, at the commit, in the root `npm test`, in CI and at the ship.

## The hook layer self-check

- Every hook but the three `tool.call` guard chains fails open by design.
  - A chain that crashes refuses the call: `docs/hooks.md` § Failure.
  - So a module that cannot load, a syntax error in a shell piece, or a missing tool takes a safety layer offline with nothing watching.
- Once a day, the heal asserts the layer beside it (`workflow/standards/hooks.sh`).
- The hooks module is loaded the way Claude Code loads it: `node --input-type=module` imports `hooks/register.js` by its file URL.
  - That pulls in every module under `hooks/mods/`.
- A module that fails to load warns `hooks: the hooks module fails to load:`, and marks the run unfinished.
  - The warning carries node's first stderr line that opens with an error name and a colon (`SyntaxError:`, `Error [ERR_MODULE_NOT_FOUND]:`).
  - Else it carries node's first stderr line.
  - No `register.js` beside the engine, or no `node`, checks nothing there.
- The shell the scripts still source is parsed with `bash -n`, since a sourcing script never parses what it sources until it runs.
  - That shell is `hooks/_lib.sh` and every `*.sh` under `hooks/lib/`.
  - The `review/`, `triage/` and `proof/` scripts, `prove.sh` and the snapshot entry load it.
  - A piece with a syntax error warns and marks the run unfinished.
- The tools the module and those scripts call must be on the PATH: `HOOK_TOOLS` in `standards.sh` (`jq`, `git`, `node`, `shasum` or `sha1sum`).
  - A missing one warns just as loudly, but never marks the run.
  - No repo can install it, and an unfinished run, retried every session, would nag forever.
- The summary line reads `hooks: <N> shell pieces parse; the hooks module loads`.
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
  - An optional `"hooks": { "<event>": [{ "command": "<shell command>", "local": true }] }` declares the ship hooks for `afterRelease`, `afterPublish` and `afterDeploy`.
    - `workkit ship cut`, `publish` and `deploy` run them from the repo root once their step succeeds.
    - They run only where this file says `"enabled": true`.
    - An entry's optional `"local": true` marks one that needs a machine, which a cloud session skips with its line (`ship/hooks.js`).
  - The same shape under `"ciSetup"` is the repo's own CI setup, which the ship never runs.
    - The kit's `ci.yml` runs each entry on the runner before the dependency install, skipping a `"local": true` one.
    - Where: `.github/scripts/ci-setup.sh`, through the one entry check in `ship/entries.js`.
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
  - `wk_native_path` in `platform.sh` is that spelling's one home, and every write and every lookup goes through it.

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
    - A file jq cannot read is excepted.
  - The registration takes the same `~/.workkit/.state.lock` mutex a decline does.
    - So does every other writer of the machine's files, the home slug and the cached GitHub node ids among them.
    - `wk_take_state_lock` in `lib/state.sh` is its single home.
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
- `home.sh`, through the stages it sources from `home/`, is where each step lives:

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
   - A clone another machine already seeded is left exactly as it is.
5. **The cloud brief's runner**: the workflow and the code it runs, copied in on EVERY setup rather than only into an empty clone.
   - `.github/workflows/brief.yml` comes from `templates/github-workflows/brief.yml`.
   - The rest lands under `brief/` with its checkout-relative subpaths intact.
     - Those are `brief/jobs/`, `brief/workflow/`, `brief/tower/api/lib/`, and `brief/tower/app/targets/web/src/assets/js/libs/tower/`.
     - The last is the shared sweep module `board.js` requires by relative path.
     - And `brief/hooks/`: the temp folder rule `repos.js` requires from `hooks/mods/markers.js`, with the `hooks/package.json` that loads it as a module.
     - So every relative address inside those scripts resolves in the clone exactly as it does here.
   - The list is `WK_HOME_RUNNER_FILES` in `home.sh`.
     - It is the require closure of `brief-payload.js` plus what `morning.sh` sources.
     - Among them: `jobs/morning/brief-publish.sh`, the `workflow/home/` stages and the `workflow/lib/` pieces.
   - It is copied by CONTENT: a file already identical is not rewritten, so a second setup writes nothing.
     - A checkout that moved on is healed and pushed as its own `chore(home): refresh the cloud brief runner` commit.
   - Like the seed, it copies from the checkout's COMMITTED tree (HEAD, exported into a scratch folder) when a git repo tracks the kit.
     - So an uncommitted edit never reaches the clone.
     - A copy no repo tracks reads the folder itself.
   - The list is read from that same tree, by sourcing the export's own `home.sh` (`wk_home_runner_list` in `home/runner.sh`).
     - So a list line edited on disk ahead of its commit can never disagree with the files it names.
   - A clone that already carries the project is first caught up with origin.
     - The catch-up is `pull --rebase --autostash`, the publish's own catch-up, `wk_home_catch_up` in `home/install.sh`.
     - So the runner refresh and the issue templates push onto the current tip.
     - A clone that cannot catch up is left unwritten: no runner refresh, no install, no heal. Discussions and Pages still run.
     - The next setup finishes the job.
   - The seed also SUBTRACTS: `brief/` is engine territory.
     - A file under it the list no longer names (what a rename left behind) is removed, and folders it empties with it.
     - The removal counts as a change, so it rides that same commit.
     - The removal waits while any listed file is missing from the committed kit.
     - So a committed list naming a file its commit lacks never strips a file the committed scripts still need.
   - **The daily morning writes it too**: `jobs/morning.sh` calls this same function ahead of its dispatch.
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
7. **Discussions**: enabled through the GraphQL API.
   - The four categories (Daily, Weekly, Monthly for the summaries, Brief for the digest) are CHECKED, never created.
     - GitHub has no `createDiscussionCategory` mutation.
   - At a terminal, setup names the missing ones and opens the page that makes them on Enter.
     - Then it polls every five seconds until they are there, Enter checking now and `s` skipping.
     - This is omega's walkthrough shape, `wk_enter_to_open` and `wk_poll` in `lib/flows.sh`.
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
    - No home repo, no terminal, no jq, no settings file, or a settings file that does not parse: a named skip.
      - It is a warn for the unparseable file.
      - Either way it leaves the switch unanswered and the file untouched, so a later interactive setup asks.
11. **The domain, on the fresh yes only**, and only while `site.url` is null: custom domain for the site? Enter for none.
    - Empty leaves `site.url` null, which is the plain github.io address and no CNAME.
    - Anything typed is written to `site.url` under the same mutex, taken at its word.
      - `wk_site_host` in `home/options.sh` is the one reader of the option.
      - It takes a scheme and a trailing slash off, for the CNAME and for the token handover alike.
    - It rides the fresh yes because that is the one moment nothing is serving yet.
    - A machine that answered on an earlier run changes its domain by hand edit.
12. **The publish**: when the switch ends on, freshly answered or already true, setup runs the publish.
    - It is the same call a human's `workkit update` makes.
    - It comes after the domain question, so the first site already carries its CNAME.
    - Off, unanswered, or a question step that skipped adds no call at all.
      - `publish.sh`'s own gate stays the single owner of that refusal.
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

14. **The clone's own heal**: `wk_home_heal`, the home repo brought to the same standard every participating repo is brought to, by the same code.
    - `standards.sh --home` runs `ensure_issue_forms` and `sync_labels` against the clone and nothing else.
      - So the home repo has the labels every queue reads and the forms that apply them.
      - Without them, a capture filed from a phone lands unlabelled and invisible.
    - It is scoped to those two because the clone is engine territory: no `.workkit/`, no opt-in, no local files.
    - The heal runs the committed kit's `standards.sh`, from its own HEAD export of the same commit the runner reads.
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
  - The compare is numeric field by field, so 0.9.0 is OLDER than 0.48.1.
    - A version neither side can read never refuses anything.
  - `workkit doctor` reports the same condition with the same fix.
  - The version is the committed manifest's: HEAD's `.claude-plugin/plugin.json`, read through `wk_home_file` in `home/seed.sh`.
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
  - Without a terminal, or without a PTY tool (`expect` or `script`) for the mint to run under, the two commands are printed instead.
    - The mint is a browser approval and cannot be automated.
  - `workkit setup --token` forces that same mint at any age, for the token that went bad while it was young.
- **A token value moves through a pipe, through the mint's own capture file, and through the handover page of step 13, and nowhere else.**
  - The mint runs under a PTY: `claude setup-token` draws its ENTIRE screen on stdout.
    - That screen is the browser message AND the paste-the-authorization-code prompt that follows the approval.
    - So capturing that stdout left the human staring at a blank line, with no way to answer.
    - And in the CLI's raw keyboard mode, there was no way to quit.
  - Under the PTY runner the whole screen reaches the terminal.
  - The copy the token is read out of lands in a capture file: `mktemp` in `TMPDIR`, `chmod 600` before the mint writes a byte.
    - It is removed the moment it has been read, and by a trap as well, so an interrupted mint leaves nothing behind.
  - From the extraction on, the value is held in one local on the way to `gh secret set`'s stdin.
    - It is never passed as an argument, echoed, or logged.
  - At a real terminal with `expect` present, `workflow/workkit/mint-pty.exp` is the runner.
    - The CLI's raw mode discards the ^C byte itself, so the binding catches it one layer out.
    - Ctrl-C ends the mint like it ends any command, and every other keystroke still reaches the paste prompt.
  - Otherwise `script` runs it, with both syntaxes spoken, told apart at runtime by whether `--version` answers:
    - BSD/macOS `script -q -e <file> <cmd>`;
    - GNU/util-linux `script -q -e -c "<cmd>" <file>`.
    - `-e` is what returns the child's own status.
    - There Ctrl-C is forwarded to a CLI that ignores it, which is what the expect path exists to fix.
- Reading comes first and decides everything.
  - These are a NAMED SKIP, never a missing value: no `gh`, no `jq`, an incomplete checkout, no home repo yet.
  - So is a `gh secret list` that did not come back as a JSON array.
  - A repo that could not be read must never send someone to mint a token that is already there.
    - It must never be written to either.
- The listing is bounded: `timeout`/`gtimeout` when the machine has one, a bash watchdog when it does not.
  - The bound is `WORKKIT_GH_TIMEOUT` seconds, default 10.
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
      - The opener is the one `wk_opener` finds; with none, the printed page suffices.
    - A no, or no keyboard, warns `identity: not signed in; run workkit setup --login`.
  - `workkit setup --login` runs the same step forced.
    - It asks nothing and signs in even when signed in, with or without a terminal.
    - The device page is opened when an opener exists.
  - A cloud session signs nothing in, since the bot does not act there.
    - `workkit setup --cloud`'s Identity section, doctor's machine line and `update` each print `identity: not applicable in a cloud session; the session's GitHub proxy signs every call as the account`.
    - That line is `cloud_na signin`, a skip line `update --auto` drops, counted by nothing.
    - Doctor's This repo section has no identity line.
  - Both questions are `wk_ask_yes` with yes the default.
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
  - At a keyboard it asks `Install workkit-agent[bot] on <owner> now? [Y/n]`, and opens that page through `wk_open_url`.
    - Then it waits on the kit's poll: `wk_poll`, the service asked again every 15 seconds through `token.js --probe`, which prints no page.
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
  - A machine without node or jq gets a named skip.
  - `workkit doctor` says, under This machine, `identity: signed in as @<login>` or `identity: not signed in; run workkit setup --login`.
  - Under This repo, doctor asks the service through `token.js --installation`.
    - It asks when signed in and the cwd's origin is enabled on this machine's roster.
      - That roster is the repos the shim acts on, so a clone of someone else's project hears nothing.
    - The answer is `identity: workkit-agent[bot] installed on <repo>`.
    - Or it is `identity: workkit-agent[bot] is not installed on <repo>`, followed by the client's refusal.
      - The refusal is the pre-selected install page, then `or run: workkit setup --bot` as a warning line of its own.
    - The check is bounded at 45 seconds (`IDENTITY_LOOKUP_TIMEOUT` in `workkit/identity.sh`).
      - That is room for the client's two GitHub reads and its ask.
  - `workkit update` and `update --auto` print the machine line too, the ok line dropped under `--auto`.
    - So a machine set up before the identity shipped hears at session start that it must sign in.
  - Doctor also checks that the shim is the `gh` the PATH finds first.
    - A real `gh` ahead of it would post every call as the owner.
  - A hand-made `~/.local/bin/gh` link (one not naming a workkit kit's `identity/gh`) is reported by setup, update and doctor.
    - It is left as it is, never repointed.
  - Each warning counts toward the attention total.

## Publishing the dashboard

- `publish.sh` pulls the clone, refreshes it from this checkout's `tower/app`, mints its brand assets, and builds it.
  - It pushes the OUTPUT to the home repo's `gh-pages` branch.
  - So nothing generated is ever committed as source, and the default branch stays the project.
- **One script builds every copy**: the install, the mint and the build are `publish/build.sh`, and they are written nowhere else.
  - `publish.sh` calls it on the home clone, and setup's first install calls it there too.
  - The CENTRAL copy is built by the same script in CI, where `.github/workflows/pages.yml` runs it on this repo's `tower/app`.
    - See `tower/README.md` § Where a published copy comes from.
  - The skips, the markers, the spinner and the messages around each call stay `publish.sh`'s own.
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
    - `WK_TOWER_APP_RETIRED` (`workflow/home.sh`) names the folders earlier app layouts shipped before the stamp carried the list.
    - So a clone from before then is cleaned on its next sync.
    - `WK_TOWER_APP_EXCLUDE` still wins.
  - It sits above the source push, so the refreshed project rides to the default branch in the same commit.
  - It sits above the site switch too, since the clone is the cloud brief's home as well.
  - A checkout with no `tower/app` beside its engine is a named skip, and the clone is built exactly as it is.
    - So is one OLDER than the clone's `.workkit-version` stamp (§ The home repo's lifecycle: the seed never downgrades).
  - A sync that wrote a MANIFEST says so on the way back (`WK_HOME_SYNC_MANIFESTS`), since the return code is already spoken for.
    - The publish then runs `publish/build.sh install` on the clone before it builds.
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
    - So `build.sh` checks for `.omega/assets/logo` after every mint.
    - A call that leaves none is a failed mint, marker and all.
  - A mint that FAILS aborts the run before the build.
    - The sidebar and the og/twitter tags emit the minted paths unconditionally.
    - So building on top of a failed mint publishes a public site with a broken logo, and a stale site beats that.
- The build runs in the TARGET, not at the brand root.
  - `omega build` is a command of `@omega.js/web` and resolves only inside `targets/web`.
  - At the root the `omega` bin dispatches to `@omega.js/manager`, which has no build at all.
  - So the build is `npm --prefix ~/.workkit/tower/targets/web run build`, and it writes `targets/web/dist/`.
  - A build that exits 0 and leaves no `dist` fails in `build.sh`, before anything is pushed.

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
  - It needs node, git and the clone, and nothing that publishing needs.
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
  - Without node on the machine it cannot be composed, and the run names both readers of the list that is now stale.
  - `site.url` set writes the CNAME into the published branch.
- The build is LOCAL: the app consumes its two `@omega.js` packages from npm at an exact version.
  - The publish checks only for `~/.workkit/tower/node_modules/.bin/omega`, never an install's exit status.
- Every reason not to publish is a named skip with exit 0:
  - no home clone, no tooling, a clone that could not catch up, a conflicting autostash;
  - an unparseable settings file, an unreachable remote, no `tower/app` to sync from, nothing changed.
- Only a mint, a build or a copy that actually failed exits non-zero.
  - So does the roster push above, which fails the run without stopping it.
- `workkit publish` runs it on demand, and a human's `workkit update` runs it too.
- `jobs/morning.sh` runs it after the morning brief, never before.
- It never runs in `update --auto`: a session start has no business spending minutes on an app build.

## Participation: the tri-state

| Repo state | `standards.sh` does |
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
workkit state [repo]                                   # enabled | disabled | declined | undecided | home | nogit
bash ~/.claude/workkit/standards.sh --announce [repo]  # the offer line, for a hook to relay
bash ~/.claude/workkit/standards.sh --engine-link       # maintain the engine's address, nothing else
bash ~/.claude/workkit/standards.sh --command-link      # make ~/.local/bin/workkit, nothing else; no repo, no prompt
```

- `--decline` writes only the `repos` key: every other key in the user file, and its value, survives untouched.
- Both files are created lazily: nothing exists until there is a decision to record.

## How it is reached

- The hooks resolve this folder from their own location, so they work the moment the plugin is installed.
- Git's hooks path is the exception that goes through the address, `~/.claude/workkit/githooks` (`standards/githooks.sh`).
  - So a plugin update that moves this folder leaves every repo's `core.hooksPath` good.
  - Each hook takes its kit root physically (`cd -P`) from there.
- Everything else (the spec, the skills, anything scripting the standard by hand) reaches it at `~/.claude/workkit`.
  - That is a symlink this script maintains itself.
- A real heal points the address at the folder it is running from.
  - It does so provided that folder is a git checkout whose origin names the workkit repo.
- A plugin install takes it too: a folder under `<claude home>/plugins/cache/` whose `.claude-plugin/plugin.json` names `workkit`.
  - The home is read by its physical path, so a symlinked `~/.claude` counts.
  - A clone outranks it: a cache engine leaves an address naming a workkit clone alone.
  - The 9am job runs `~/.claude/workkit/../jobs/morning.sh` through this address.
    - So a plugin update that repoints it needs no reinstall of the schedule.
- It is one path for the whole machine, so it is written ATOMICALLY.
  - It is made under a temporary name and renamed onto the address, which is also how `~/.local/bin/workkit` is written.
  - Sessions opening at once in several repos all write it.
  - None of them can leave the machine with no address, or end on having lost that race.
- A probe writes nothing, and a copy that is not the machine's engine is left silently alone.
- A real directory found at the address after the write is the copy Git Bash makes on a shell that cannot symlink.
  - `lib/platform.sh`'s `MSYS=winsymlinks:nativestrict` asks it to refuse instead, and the result is checked anyway.
  - A copy hides the kit's folders one level above the engine, which the schedule reaches through the address.
  - So the heal removes it, and names the Windows setting to turn on.
- A symlink there is never removed, since it is another session's win of the same race.
- `--engine-link` is that step on its own, which is what `workkit setup|update` calls.
- The hook takes a `WORKFLOW_DIR` override, and the address step a `WORKFLOW_CLAUDE_HOME` one; the tests use both.
- Run it by hand against any repo:

```sh
bash ~/.claude/workkit/standards.sh [repo-root]
```

- Only the label step, the claim sweep, and the label report need `jq`, `gh`, and a reachable remote.
- The gitignore, working-file, and forms heals are pure bash and always run.
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
