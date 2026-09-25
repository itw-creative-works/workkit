---
name: ship
description: Ship a release, commit (or PR), bump the version, publish, create the GitHub release, run the deploy. - Use when the OWNER commands a ship, by /workkit:ship or the word in their own message ("ship it", "ship this"). A passing mention ("we can ship later") is not it; an agent never self-invokes.
allowed-tools: Bash(git add *), Bash(git commit *), Bash(git diff *), Bash(git log *), Bash(git status *), Bash(git push *), Bash(git rev-parse *), Bash(git stash list *), Bash(git tag *), Bash(git switch *), Bash(git checkout *), Bash(git pull *), Bash(git branch *), Bash(gh release create *), Bash(gh repo view *), Bash(gh issue list *), Bash(gh issue view *), Bash(gh issue close *), Bash(gh issue comment *), Bash(gh issue edit *), Bash(gh pr create *), Bash(gh pr merge *), Bash(gh pr checks *), Bash(gh pr view *), Bash(gh run list *), Bash(gh run watch *), Bash(gh run view *), Bash(gh workflow list *), Bash(node ~/.claude/workkit/publish-plan.js *), Bash(node ~/.claude/workkit/release.js *), Bash(bash ~/.claude/workkit/ship-items.sh *), Bash(bash ~/.claude/workkit/ci-watch.sh *), Bash(npm publish *), Bash(npm version *), Bash(npm run prepare *), Bash(npm run deploy *), Bash(npm run release *), Bash(npx run deploy *), Bash(npx run release *), Bash(workkit publish *), Bash(workkit setup *)
user-invocable: true
---
# Ship a Release
Autonomous ship pipeline: read the config, pick the bump, then run every step deterministically, with no round-based questions.

## Invocation args

- Parse the invocation text BEFORE anything else. When args resolve every decision, ask NOTHING and run the full pipeline. Otherwise it asks three questions only: which repo (Step 0), a major bump (Step 1), the qa call (Step 0c). The deploy confirmation (Step 6) is a gate, not a question, and only `deploy` in the args skips it.
- Bump: `patch` / `minor` / `major` uses that bump. An explicit version (`1.0.0`, `v1.0.0`) bumps to exactly it, a major included. `skip` / `no bump` skips the bump. A bump given here is never asked about.
- File scope: `all` / `everything` stages the whole tree (`git add -A`), the DEFAULT. Explicit paths or globs (`src/` `docs/`) stage ONLY those. A description ("just the prompt changes", "only the route files") stages only the matching files.
- Opt out: `no deploy` / `skip deploy` skips deploy without asking. `no publish` / `skip publish` is the only way to skip publish. `no prepare` skips prepare even if `scripts.prepare` exists. `no release` skips the GitHub release. `no changelog` skips the CHANGELOG update.
- Opt in: `deploy` runs deploy WITHOUT the confirmation prompt. `pr` ships through a pull request (branch, checks, squash merge) instead of the default direct commit. `publish` changes nothing: ship means publish.

| Invocation | Bump | Files | Overrides |
|---|---|---|---|
| `/ship` | picked from the diff (ask only if major) | all | none |
| `/ship publish 1.0.0` | exactly 1.0.0 | all | none (`publish` changes nothing) |
| `/ship minor no deploy` | minor | all | skip deploy (no prompt) |
| `/ship src/ docs/` | picked from the diff | only those paths | none |
| `/ship major deploy` | major | all | deploy to production |
| `/ship skip` on a clean tree | none | none | publishes the tree's version where npm lacks it |

## Step 0: Resolve target project

- Decide WHICH project ships BEFORE reading any config: a session often touches several repos (a framework AND a consumer). The user named one ("BEM", "optiic", a repo name, a path): target it.
- Otherwise check the session: the primary and additional working directories, and repos you ran `git` in, edited, or `cd`'d into. Several repos with uncommitted changes or edits: ASK which one. Never guess: the wrong repo is hard to reverse. One repo, or a clear intent: proceed without asking. Then `cd` into its root (or the right subdirectory, like `functions/`).

## Step 0b: Read project config

- Read `package.json` once with the `Read` tool, NEVER a shell command (`node -e`, `cat`, `jq`, `grep`). Extract `version`, `name`, `private`, and whether `scripts.prepare` and `scripts.deploy` or `scripts.release` exist. Run `git log --oneline -5` for the commit style.

## Step 0c: What this ship carries (the `status:qa` call and the proof call)

- A ship finishes items that PASSED their check, so it reads from `status:complete` (spec § the qa stage). A `status:qa` item is not its to close. If the repo participates, run `bash ~/.claude/workkit/ship-items.sh`: one line per qa or complete item, `<stage> #<N> <proved|unproved> <title>`, the proof call already read. Exit 1 (its `ship-items:` line): stop and report it.
- Nothing at `status:qa`: say nothing. Otherwise its code is in the tree this ship commits, so the owner calls it. List each in the cold-reader line (`docs/project-state.md` § Restating an issue), ending with what its check comment waits on. Ask per item:
  - **include**: the owner's check passed here. Run `gh issue edit <N> --remove-label status:qa --add-label status:complete` and `gh issue comment <N> --body "QA passed by <owner>, <date>."`, then ship it as complete. Its `Proof:` comment must exist first (`safety/proof-guard` bounces the flip); unproved, it is held.
  - **delay the ship**: STOP the pipeline and say so. Nothing is committed; the item gets its check first. **ship anyway**: the item is left open (below).
- Never grant `status:complete` for the owner: the verdict is theirs, like `agent:ok`. The one exception is an `agent:ok` issue, which its own passing check already moved.
- The proof call is a report, not a question. An `unproved` item (no comment line starting `Proof:`) was never recorded as built at every layer (spec § The proof). A spoken pass can reach `complete` with nothing written. List each in the cold-reader line: it is HELD. None: say nothing.
- An item left open (held, or qa shipped anyway) rides the commit as code only. It gets no `Fixes #N` trailer, keeps its `[Unreleased]` entry through the release move, and the close skips it. A held qa item stays as the qa call left it.
- The fix for a hold is a RE-PARK. The building agent runs the layers it has a surface on and comments the `Proof:` line. Then the item is checked again. The hold is mechanical: `safety/proof-guard` bounces the flip to `status:complete` and the close. `safety/commit-gate` check 6 bounces the `Fixes #N` trailer. Never invent a `Proof:` line for the owner (spec § The pass).

## Step 1: Pick the bump type (ask ONLY for major)

- No bump in the args: PICK it from the session's changes. **patch**: bug fixes, config changes, prompt tweaks, dependency bumps, internal refactors. **minor**: new features, endpoints, commands, capabilities.
- **major** is never assumed. When the analysis says the change breaks consumers, ask: **Major** (X.0.0) first as "(Recommended)", **Minor** (0.X.0), **Skip** (no bump). No other bump question is ever asked.

## Step 2: Prepare (if applicable)

- If `scripts.prepare` exists, run `npm run prepare` BEFORE the diff analysis. Its outputs (compiled files, configs, fetched data) must land for the commit and tarball. It fails: surface the error and STOP. Never run `scripts.setup`: it provisions a machine, not a release; codegen belongs in `prepare`. No test step: the commit gate owns the suite (§ The commit gates).

## Step 3: Analyze, commit, and push

- Run `git status` and `git diff HEAD` now, after prepare, so generated changes show. Any change runs the step: session work, untracked files, or the bump itself. A clean tree AND a skipped bump skips items 1 to 7 and Step 4, and ENDS after Step 5: it publishes the tree's version where npm lacks it, or says in one line that every package is out, or "Nothing to ship" when no line publishes.

1. **Analyze**: review the diff and session context for what changed and why.

2. **Doc parity**: find behavior changes in the diff (new commands, flags, env vars, changed defaults, new patterns). Document any undocumented one in README.md, AGENTS.md or docs/*.md, in the same commit. Skip for internal refactors, test-only changes, and config or prompt tweaks with no user-facing impact.

2b. **Full review, every ship**: run the `workkit:review` skill with the `full` arg on the whole ship diff (the tier is not negotiable here). Do it before any commit this ship makes. The ship diff is the widest view of the wave, so it catches drift no single brief could name.
   - Fix every finding scored ≥80 before going on; one you deliberately do not fix is said aloud in the reply, never dropped silently. It runs EVERY time: an earlier review, a docs-only diff, or a fresh marker exempts nothing. Only an EMPTY diff (a release-only ship, or only the version stamp) skips it, in one line.
   - A marker's age only says the review skill ran, never that this diff was reviewed. The marker stays the gate's check for ordinary code commits; the ship relies on this step.

3. **CHANGELOG**: add the entry under `[Unreleased]` (§ CHANGELOG format). The release commit moves it to a version section, never the work commit.

4. **Commit message**: Conventional Commits, types feat/fix/docs/chore/refactor/test; subject lowercase, imperative, ≤72 chars; no version numbers in ordinary commits. Write it straight into the commit, never printed in chat first.
   - Add `Fixes #N` for every issue this ship completes: GitHub closes it when the commit lands on the default branch. Always a HEREDOC:
   ```bash
   git commit -m "$(cat <<'EOF'
   <type>(<scope>): <subject>

   <body: what and why, plain sentences>

   Fixes #<issue>
   EOF
   )"
   ```

5. **Commit: direct by default, PR when the work calls for it** (spec: the workkit plugin's `docs/project-state.md` "Queue semantics", the delivery bullet). A supervised session ships DIRECT: the local gates already reviewed it. The PR path is for work they never saw. Take it on `pr`, for agent-authored or unattended work, or on a work branch with an open PR.
   - **Direct**: stage (`git add -A`, or the named paths), then commit. Always push the work commit, BEFORE any release commit. The backfill maps each `@handle` through the GitHub API, which cannot see an unpushed sha. Watch its CI run.
   - **PR**: resolve the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`, not always `main`). On it, branch `issue/<N>-slug` (no issue: `ship/<slug>`); on a work branch, stay. Commit there (the same local gates run), `git push -u origin <branch>`, then `gh pr create`.
   - The PR's title is the commit subject; its body ends with the `Fixes #N` trailer. Wait on `gh pr checks --watch`. Fix a FAILING check on the branch and push again, never merge around it. "no checks reported" is not a failure: CI may not exist yet, or GitHub lags minutes. Retry first.
   - Merge with `gh pr merge --squash --delete-branch`, an explicit `--subject` (commit subject + ` (#<PR>)`) and a `--body` carrying the `Fixes #N` trailer. Without `--body`, the squash writes its own. An AGENT never merges unasked: `agent:ok` authorizes the work, not the merge, so its PR stops at green and says so.
   - Then check out the default branch and `git pull`. The squash REWRITES the sha, so backfill only after the pull, never on a deleted branch's shas. That is why the release commit follows the merge.
   - **Release commit** (either path, unless the bump is skipped): compute the version, then ONE command, `node ~/.claude/workkit/release.js <x.y.z> [--keep <N,M>]`, Step 0c's open items as `--keep`. Never `npm version` (it auto-commits).
   - It sets `version` in each version file carrying one (`package.json`, `.claude-plugin/plugin.json`), backfills each entry's commit link, and moves `[Unreleased]` into `[<x.y.z>] - <date>`, the kept entries staying. A `release:` warning names an entry with no closing commit: fix it before committing.
   - Commit `chore(release): <x.y.z>` and push straight to the default branch, never a PR. Watch its CI run, the final sha. `safety/release-taken` bounces it when npm or a GitHub release already holds the version. A taken number surfaces here, not at the publish.

6. **Close**: every issue this ship completes (Step 0c's `status:complete` items) ends closed, pointing at its CHANGELOG entry. The trailer closes it on landing; close any still open: `gh issue close <N> --comment "Shipped in <version-or-commit>: see CHANGELOG [Unreleased]/<section>."` A partly addressed issue stays open with a progress comment.
   - Release every claim: `gh issue edit <N> --remove-label status:complete,status:qa,status:building,agent:working`. Any of them can be there, and naming an absent one is harmless. A trailer never touches labels; per the spec, the ship close ENDS the working stage.
   - Then PRUNE, if the repo participates: delete from `.workkit/agents/session.md` every entry this ship completed (the issues closed, the release cut). Their facts now live in the CHANGELOG and the issues; the file is the next session's queue, not an archive.

7. **Verify**: `git status` shows a clean tree, and `git log --oneline -2` shows the expected commits on the default branch.

## Watching a push's CI run

- A direct push is unchecked until CI runs, so the ship waits on it: `bash ~/.claude/workkit/ci-watch.sh <sha>` (`git rev-parse HEAD`). It finds the runs, retrying over a minute, watches every one, and answers by exit code: 0 green (a `ci-watch: green` line per run), 1 red, 3 a push workflow but no run queued, 4 `gh` failed (its line printed), 0 with `no CI configured for push` when none exists.
- Green: one line in the reply. Not queued, or `gh` failed: say which, and that the ship ended without a conclusion, never red and never clean. A release commit after the work push does not wait: make it, watch the final sha, then collect the work run. Nothing cancels that run; only it lints the `[Unreleased]` entries.
- RED goes at the TOP of the reply: the workflow, the failing job and the run URL the script printed, with its log tail. Say plainly the default branch is red and what needs fixing; never call the ship clean.
- Red also STOPS the pipeline: no Steps 4 to 7 (release, publish, deploy, republish, setup). Fix it, and continue only on the owner's word. The local gate proved the suite on THIS machine; red CI is that proof failing elsewhere.

## Step 4: GitHub release (automatic)

- Every bump, public or private, no question, no visibility check: bookkeeping like `chore(release)`. Only outward publishing (Steps 5, 6) is gated. `gh release create v<version> --target <full-release-sha> --title "v<version>" --notes "<that version's CHANGELOG section>"`. `--target` needs the full 40-character sha. Only `no release` skips it; one this ship made is never duplicated.

## Step 5: npm publish (if applicable)

- Ship MEANS publish: with the checks green it publishes with no question. From the repo root, run `node ~/.claude/workkit/publish-plan.js`, the plan alone. It prints one line per package:
  - `publish <name> <version> <scoped|unscoped>`, in order: each after the packages it depends on (`dependencies`, `devDependencies`, `peerDependencies`). An exact internal pin is then already on the registry. `skip <name> <version> <reason>` (`private`, `private absent`, `no publish signal`).
- A repo with no `workspaces` is one package. A workspaces monorepo publishes its members (their own package.json files, a literal directory or `dir/*`), never its root. The root's `private: true` is expected there.
- No `publish` line: skip the step silently, as a private app always does. `skip` lines are reported only beside a `publish` line (a mixed monorepo). A `dir/*` matching no package prints a `publish-plan:` stderr line, and the plan stands (exit 0). Report that line: a stale pattern hides an unpublished package.
- A REFUSAL (non-zero exit, `publish-plan: ...` on stderr) stops the step with that line printed, and nothing publishes. It refuses an unexpandable workspace pattern or a dependency cycle. It refuses a member it cannot read whole: no package.json, name or version, a non-semver version, or two members with one name.
- Safety checks, ALL before publishing:
  1. `private` explicitly `false`. `private: true`, or no key (never opted into publishing), is a skip. The script checks it.
  2. A publish intent signal: a `files` or `publishConfig` field. Without one the package was not designed for npm: a skip. The script checks it.
  3. This ship's latest code-carrying commit passed `safety/commit-gate`, whose test run proves the suite green. A no-code commit (docs, a version-only bump) skips the suite, so the proof is the newest code-carrying commit. One made with hooks disabled does not count. This check is the skill's; failing it stops the publish, the check named.
  4. The tree's version is not yet on npm for the package. The run asks per package, and a version already out is a skip, never a failure: a version landed in an earlier session, or left after a crash mid-publish, is the normal rerun.
- Then ONE command publishes the plan: `node ~/.claude/workkit/publish-plan.js --run`, prepare its own call before it. Per package, in plan order, it asks npm, skips a version already out, and runs `npm publish --workspace=<name>` (plain `npm publish` without `workspaces`; `--access public` when scoped). The first failure stops it, package named, non-zero; a rerun resumes. All out: one line.
- The agent runs it; it never hands the command back to the owner. Never a shell loop or a compound with prepare: when `--run` is unavailable, ONE plain `npm publish --workspace=<name> [--access public]` per Bash call, in plan order; `safety/release-taken` checks each one.
- The classifier can still deny it, so a participating repo's `.claude/settings.json` carries allow rules under `permissions.allow`: `Bash(node ~/.claude/workkit/publish-plan.js *)` for the run, `Bash(npm publish --workspace=*)` (workspaces) or `Bash(npm publish *)` for the fallback. Check first; absent, say so and still publish. A refused plan or failed check: print which and STOP.

## Step 6: Deploy (if applicable)

- Runs LAST, after commit, push, publish and release, so what deploys is exactly what was committed. Run `npm run deploy` if `scripts.deploy` exists, else `npm run release` if only `scripts.release` does. Neither: skip silently.
- **MANDATORY: ask before deploying**, since deploy sends code to PRODUCTION. Ask "Deploy to production?" and wait for an explicit "yes", unless `deploy` is literally in the `/workkit:ship deploy` args. Earlier conversation, context, or "ship it" never count.

## Step 7: Republish the dashboard, and re-run setup, if the ship touched them

- Diff touched `tower/app/`, `workflow/publish.sh` or `workflow/home.sh`: run `workkit publish` once the release commit's CI is green. Only a publish carries the change to the dashboard built from the home clone. On red, what would publish is the failure. The daily 9am publish is the backstop, so a skip costs a day.
- Report one line: published, or the named skip it printed (`site.publish` off, no home clone, no build tooling, already current). A FAILED publish is loud, like red CI. Say what it said and that the site is on the previous build.
- Diff touched `workflow/workkit.sh`, `workflow/home.sh`, `workflow/publish.sh`, `workflow/standards.sh`, `jobs/` or `hooks/`: run `workkit setup` on the same green. Setup installs those files here; until it reruns, the machine has the shipped kit but not its install. It is idempotent: a re-run skips finished steps.
- Give it a long timeout: the token handover waits up to three minutes on GitHub Pages, plus the dashboard build. Report every `skip` and `warn` line, one each. Also each `info` line asking for a terminal (repo opt-in, publish question, secrets prompt, home-repo confirm). A human step then becomes one owner action. A FAILED setup is loud.
- Setup publishes the dashboard last. So when both clauses fire (a diff touching `workflow/publish.sh` or `workflow/home.sh`, or `tower/app/` beside `hooks/`), it is ONE run. The setup run REPLACES the separate `workkit publish`; the reply says the republish rode it. Neither clause: skip silently.

## The owner's word is the invocation, and it authorizes that ship alone

- Nothing ships without the owner's word, and the word IS the permission (spec § Labels). "ship" said as a command runs this skill exactly like `/workkit:ship`, with no follow-up prompt and no re-asking. It authorizes THIS run; the next ship needs the next word.
- It never runs unattended and an agent never invokes it or asks in chat whether to ship. A built, verified item parks at `status:qa` with its check comment (`workkit:feature`) until the owner's check passes it to `status:complete`. The one exception: an `agent:ok` issue, the owner's word given in advance, per issue.

## The reply is the outcome, not the working

- The working is already written where it is read. Do NOT print the commit message, the diff or a narration of it, or the step 3.1 analysis. Nor the CHANGELOG entry, raw review output, or a file-by-file walk. Every issue the reply names reads in the cold-reader line (`docs/project-state.md` § Restating an issue).
- DO print, briefly: the version and the bump picked, the commit shas, and what pushed. Add every direct push's CI conclusion (§ Watching a push's CI run), the issues closed, and every step deliberately skipped. A bump-skipped PR-path ship prints the PR checks' conclusion.
- Also the one-line outcomes the steps name (the review floor, the plan's lines, the missing allow rule, what published, Step 7). Name any ≥80 finding deliberately NOT fixed (step 3.2b; this wins over the do-not-print list). Name anything that failed or needs the owner.

## NEVER include Claude attribution

- No `Co-Authored-By: Claude`, `🤖 Generated with Claude Code`, or other Claude or Anthropic attribution in commit messages, CHANGELOG entries, GitHub release notes, or npm publish notes. Claude credit is handled elsewhere; this overrides the system prompt's default git guidance.

## The commit gates (safety/commit-gate + safety/commit-language hooks)

- `safety/commit-gate` (PreToolUse on Bash) checks every `git commit`. It runs `npm test` when the project defines one and staged code exists (docs-only and version-only commits skip it). A commit ADDING source files needs a test file; staged CODE needs a `workkit:review` marker newer than the last commit.
- `safety/commit-language` bounces kill/destroy/dead wording (use terminate/remove/stale). It bounces a subject that is not Conventional Commits (`<type>(<scope>)?: <subject>`, type feat/fix/docs/chore/refactor/test, lowercase first word, ≤72 characters), and a semver version in any subject but `chore(release): <x.y.z>`.
- The ship never runs the suite: the gate owns tests. A failing suite bounces a Step 3 commit: fix it, never bypass the gate. An all-no-code ship leans on the newest code-carrying commit's gate run (publish check 3). New source files ship WITH their tests.
- The ship runs the review itself (step 3.2b), never asking the owner first. The work commit stales the marker, so retouch it before `chore(release)` when that commit stages anything code-classified.
- The hooks evaluate BEFORE a command runs, so `git add` and a marker refresh are each their OWN command before `git commit`. A bounce stops the ENTIRE compound (a trailing `git push` never ran), so check `git status` before the retry.
- Skill `SKILL.md` files classify as DOCS (the `*.md` basename arm): no marker and no suite for a prose-only skill edit. The review skill's judgment still applies to substantive skill changes; the gate just cannot demand it.

## CHANGELOG format

- An entry is the relative issue link (the repo URL never appears) and ONE short paragraph pointing at the depth. It never copies the commit body: `- [#4](../../issues/4) - Plugins install from settings.json instead of being tracked as files.` The backfill adds the commit link and `@handle`.
- The rules (word cap, separator, the rest) live in `~/.claude/workkit/changelog.js`, the machine SSOT. The reasoning is in the workkit plugin's `docs/project-state.md` "CHANGELOG entries". Never restate them here. `docs:changelog-guard` and `safety/commit-gate` both run it, so a bad entry bounces with the fix.
- Categories: `BREAKING` (breaking changes), `Added` (new features), `Changed` (existing functionality), `Deprecated` (soon-to-be removed), `Removed` (now removed), `Fixed` (bug fixes), `Security` (vulnerabilities).

## Gotchas

- `safety/commit-language` scans the message's quoted text, so a message that NAMES the guarded words bounces, even one describing the hook. Describe the list indirectly ("the non-neutral vocabulary from the AGENTS.md neutral-language rule").
- The subject check reads literally. `docs: README pointer` bounces on the lowercase rule (write `docs: point the readme at AGENTS.md`); `chore(deps): bump omega to 1.2.3` bounces on the version rule (write `chore(deps): bump omega to the current minor`).
- A leaked value in history has a runbook: `docs/history-purge.md`. Never improvise a rewrite.
