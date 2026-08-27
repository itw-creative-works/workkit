---
name: ship
description: Ship a release — commit (or PR), bump the version, publish, create the GitHub release, run the deploy. - Use when the OWNER commands a ship: /workkit:ship, or the word in their own message ("ship it", "ship this"). A passing mention ("we can ship later") is not it; an agent never self-invokes.
allowed-tools: Bash(git add *), Bash(git commit *), Bash(git diff *), Bash(git log *), Bash(git status *), Bash(git push *), Bash(git rev-parse *), Bash(git stash list *), Bash(git tag *), Bash(git switch *), Bash(git checkout *), Bash(git pull *), Bash(git branch *), Bash(gh release create *), Bash(gh repo view *), Bash(gh issue list *), Bash(gh issue view *), Bash(gh issue close *), Bash(gh issue comment *), Bash(gh issue edit *), Bash(gh pr create *), Bash(gh pr merge *), Bash(gh pr checks *), Bash(gh pr view *), Bash(gh run list *), Bash(gh run watch *), Bash(gh run view *), Bash(gh workflow list *), Bash(npm publish *), Bash(npm version *), Bash(npm run prepare *), Bash(npm run deploy *), Bash(npm run release *), Bash(npx run deploy *), Bash(npx run release *), Bash(workkit publish *)
user-invocable: true
---

# Ship a Release

Autonomous ship pipeline. Reads the project config, picks the version bump itself (asking only when it believes the change is a breaking major), then executes everything deterministically. No round-based questioning — just ship it.

## Invocation args

Parse the user's invocation text BEFORE doing anything. Args pre-resolve decisions so the pipeline runs without asking.

**Bump type:**
- `patch` / `minor` / `major` → use that bump, don't ask
- `skip` / `no bump` → no version bump, don't ask

**File scope:**
- `all` / `everything` → stage the entire working tree (`git add -A`). This is also the DEFAULT when no file scope is given.
- Explicit paths / globs (e.g. `src/` `docs/`) → stage ONLY those files
- Specific descriptions (e.g. "just the prompt changes", "only the route files") → identify and stage only the matching files

**Step overrides (opt OUT of a step):**
- `no deploy` / `skip deploy` → skip the deploy step without asking
- `no publish` / `skip publish` → skip the publish step without asking
- `no prepare` → skip the prepare step even if `scripts.prepare` exists
- `no release` → skip GitHub release even if the repo is public
- `no changelog` → skip CHANGELOG update

**Step overrides (opt IN / skip the confirmation prompt):**
- `deploy` → run deploy WITHOUT asking (skips the confirmation prompt)
- `publish` → run npm publish WITHOUT asking (skips the confirmation prompt; still validated for safety)
- `pr` → ship through a pull request (branch, checks, squash merge) instead of the default direct commit

**Examples:**
| Invocation | Bump | Files | Overrides |
|---|---|---|---|
| `/ship` | picked from the diff (ask only if major) | all | none |
| `/ship patch` | patch | all | none |
| `/ship minor no deploy` | minor | all | skip deploy (no prompt) |
| `/ship patch no prepare` | patch | all | skip prepare |
| `/ship src/ docs/` | picked from the diff | only those paths | none |
| `/ship patch publish` | patch | all | publish to npm |
| `/ship minor deploy` | minor | all | deploy to production |
| `/ship major publish deploy` | major | all | publish + deploy |

If all decisions are resolved by args (bump type given, file scope clear, no ambiguity), ask NOTHING and execute the full pipeline.

## Step 0: Resolve target project

**BEFORE reading any config**, determine WHICH project is being shipped. This matters because a session often touches multiple repos (e.g., a framework repo AND a consumer project).

1. Check what the user typed. If they named a project (e.g., "BEM", "optiic", a repo name, a path), target that project.
2. If they didn't name one, check the session context: were changes made in multiple repos during this session? Look at:
   - The primary working directory (from the environment)
   - Any additional working directories
   - Repos you've run `git` commands in, edited files in, or `cd`'d into
3. **If multiple repos have uncommitted changes or were edited this session, ASK which project to ship.** Don't guess — shipping the wrong repo is a hard-to-reverse mistake. This, a major bump, and the `status:qa` call in Step 0c are the only questions the pipeline ever asks.
4. If only one repo was touched, or the user's intent is unambiguous, proceed without asking.

Once the target is resolved, `cd` into that project's root (or the appropriate subdirectory like `functions/`) before continuing.

## Step 0b: Read project config

**Use the `Read` tool to inspect `package.json`** — NEVER `node -e`, `cat`, `jq`, `grep`, or any shell command. Read it once and extract:
- `version` (current)
- `name`
- `private` (true/false)
- `scripts.prepare` (exists?)
- `scripts.deploy` or `scripts.release` (exists?)

Also run `git log --oneline -5` to understand recent commit style.

## Step 0c: What this ship carries — the `status:qa` call

A ship finishes the items that PASSED their check: `status:complete` is the stage it reads from (spec § the qa stage). Items still at `status:qa` are waiting on a check and are not this ship's to close.

1. List both stages, if the repo participates: `gh issue list --state open --label status:complete --json number,title` and the same for `status:qa`.
2. Nothing at `status:qa` → say nothing about it and carry on.
3. Anything at `status:qa` → its code sits in the SAME working tree this ship is about to commit, so the owner has to call it. List each one (number, title, one line of what it is waiting on from its check comment) and ask per item:
   - **include** — the owner's check passed right there: grant the stage on the spot (`gh issue edit <N> --remove-label status:qa --add-label status:complete`) with the pass comment (`gh issue comment <N> --body "QA passed by <owner>, <date>."`), and the ship carries it like any other complete item.
   - **delay the ship** — STOP the pipeline and say so. Nothing is committed; the item gets its check first.
   The owner may also say to ship anyway, in which case the qa item's code rides along in the commit while its issue stays open, keeping its `[Unreleased]` entry — it is untouched by this ship's close step.
4. This is a question the pipeline DOES ask, alongside the major bump and the target repo. Never grant `status:complete` on the owner's behalf: the verdict is theirs, exactly like `agent:ok`. An `agent:ok` issue is the one exception, where the agent's own passing check already moved it.

## Step 1: Pick the bump type (ask ONLY for major)

**Parse invocation args first.** If the user typed `/workkit:ship patch`, `/workkit:ship minor`, `/workkit:ship major`, or `/workkit:ship skip` — use that directly. Don't ask.

If no bump type was given, PICK it from the session's changes and say which was picked in the ship summary (owner ruling, 2026-08-03 — no prompt):
- **patch** for bug fixes, config changes, prompt tweaks, dependency bumps, internal refactors
- **minor** for new features, new endpoints, new commands, new capabilities

The ONE exception is **major**: a breaking change is never assumed. When the analysis says the changes break consumers, ask — Options: **Major** (X.0.0), **Minor** (0.X.0), **Skip** (no bump), with Major first as "(Recommended)".

Everything else is deterministic; no other bump question is ever asked.

## Step 2: Prepare (if applicable)

If `scripts.prepare` exists, run `npm run prepare`. This builds outputs (compiled files, generated configs, fetched data) that need to land in the working tree for the commit/tarball. Run it BEFORE analyzing the diff so generated changes are visible. If it fails, surface the error and STOP.

Do NOT run `scripts.setup` — setup is environment/machine provisioning, not release work. A repo whose ship needs codegen expresses that as `prepare`.

**No test step.** The skill never runs the test suite: the `safety/commit-gate` hook runs it deterministically on every commit that carries code (issue #151 — docs-only commits and version-only bumps skip it) — that is the single owner of test enforcement. A failing suite surfaces as a blocked commit in Step 3; fix the failure, never bypass the gate. A ship whose commits are all no-code leans on the newest code-carrying commit's gate run, which is the proof publish check 3 reads.

## Step 3: Analyze, commit, and push

Run `git status` and `git diff HEAD` now — AFTER prepare has run, so any generated file changes are visible.

**No-changes guard:** if `git status` shows a clean working tree AND bump was skipped, say "Nothing to ship — working tree is clean and no version bump selected" and STOP. Don't run any subsequent steps.

This step runs if there are changes in the working tree (from the session's work, git status showing modified/untracked files, or the version bump itself).

1. **Analyze all changes** — review the diff and session context to understand what changed and why.

2. **Doc-parity review** — scan the diff for behavioral changes (new commands, flags, env vars, changed defaults, new patterns). If any are undocumented, update the relevant docs (README.md, AGENTS.md, docs/*.md) in the same commit. Skip for internal refactors, test-only changes, and config/prompt tweaks with no user-facing impact.

2b. **Code review** — when the changes include CODE (anything that is not docs-only), invoke the `workkit:review` skill on this diff and act on its findings before committing. Ship OWNS this step: the `safety/commit-gate` hook requires a review marker newer than the last commit, so a ship that skipped it would do all its work and then bounce at the commit. The skill tiers itself (full panel by default, light for a small low-risk diff) — do not pre-judge the tier here.
   - Fix every finding it scores ≥80 before proceeding. A finding you deliberately do not fix gets said out loud in the ship summary, never dropped silently.
   - Already reviewed this diff earlier in the session, with no code edits since? Skip — re-reviewing an unchanged diff reviews the review's own output. Any edit after the review means it runs again.
   - Docs-only ship: skip entirely; the gate does not ask for a marker.

3. **Update CHANGELOG** — add the entry under `[Unreleased]` (keepachangelog categories below), in the entry format: `- [#4](../../issues/4) — What changed.` (a relative link — the repo URL never appears in the file) Write ONLY the issue link and one short paragraph; the commit link and the `@handle` are generated in step 5. The move from `[Unreleased]` to a version section belongs to the release commit, not the work commit.

4. **Draft commit message** — Conventional Commits. Write it straight into the commit; do NOT print it in the chat first (see § "The reply is the outcome, not the working").
   ```
   <type>(<scope>): <subject>

   <body: what and why, plain sentences>

   Fixes #<issue>
   ```
   Types: feat/fix/docs/chore/refactor/test. Subject lowercase, imperative, ≤72 chars. NO version numbers in ordinary commits. Add a `Fixes #N` trailer for every issue this ship completes — GitHub closes them when the commit carrying the trailer lands on the default branch.

5. **Commit — direct by default, PR when the work calls for it** (spec: the workkit plugin's `docs/project-state.md` → "Queue semantics", the delivery bullet):
   A supervised session ships DIRECT: the local hook gates are the enforcement, and a PR would re-review work the gates already reviewed. The PR path is for work the local gates never saw — take it when the invocation says `pr`, when shipping agent-authored or unattended work, or when the session is on a work branch that already has a PR open.

   **Direct path (the default):**
   - Stage the session's changes as their OWN command (`git add -A`, or only the invocation's named paths), then commit with the drafted message in a second command — the gate reads the index before the command runs, so it bounces a compound that stages and commits in one call (#155).
   - **Push the work commit** — always, bump or no bump. When a bump follows, the push must land BEFORE the release commit: the backfill resolves each `@handle` through the GitHub API, which cannot map a sha it has never seen.
   - **Watch the push's CI run** (see § "Watching a push's CI run"). When a bump follows immediately, don't block here — go make the release commit while this run works — but this run's conclusion is still owed: BOTH runs complete (nothing cancels the first — this run is the only one that ever lints the `[Unreleased]` entries, since the release commit empties that section), so after the release sha's watch, collect this one's conclusion too and hold it to the same red-is-loud standard.

   **PR path (on `pr`, agent-authored work, or an already-open PR):**
   - Resolve the default branch (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name` — not always `main`). If on it, branch `issue/<N>-slug` (no issue → `ship/<slug>`); already on a work branch, stay.
   - Commit on the branch (the local gates run identically), `git push -u origin <branch>`, `gh pr create` — title = the commit subject, body ends with the `Fixes #N` trailer.
   - Wait on `gh pr checks --watch`. A FAILING check gets fixed on the branch and pushed again — never merged around. "no checks reported" is NOT a failure: the repo may have no CI on the base branch yet, or GitHub has not queued the run (it can lag minutes) — retry before concluding there are no checks.
   - Squash merge: `gh pr merge --squash --delete-branch` with an explicit `--subject` (commit subject + ` (#<PR>)`) and a `--body` carrying the `Fixes #N` trailer — the squash commit is what lands, so the trailer must live there. An AGENT never merges without being asked in words: `agent:ok` authorizes the work, not the merge, so an agent-authored PR stops at green and says so.
   - Check out the default branch and `git pull`.

   **Release commit** (either path, only if bump not skipped): use the `Edit` tool to bump `version` in `package.json` (NOT `npm version` — it auto-commits), run `node ~/.claude/workkit/changelog-links.js` to fill each entry's commit link and contributor handle (idempotent), move the CHANGELOG `[Unreleased]` content to a new `[<x.y.z>] <date>` section — EXCEPT any entry whose issue this ship leaves open (a qa ride-along from Step 0c): that entry stays under `[Unreleased]` for the ship that closes it — commit as `chore(release): <x.y.z>`, and push directly to the default branch — the release commit is generated bookkeeping and never takes a PR. Then watch THAT push's CI run (below): it is the final sha, and the ship never ends without its conclusion.

   **Watching a push's CI run** — a direct push is unreviewed by any check until CI runs, so ship waits on it the way the PR path waits on `gh pr checks --watch`:
   - Resolve the pushed head sha (`git rev-parse HEAD`) and find its run: `gh run list --commit <sha> --json databaseId,name,status,conclusion`.
   - Empty list? GitHub can lag queuing a run by minutes — retry a few times over ~a minute before concluding. Still empty: check whether the repo has a workflow that runs on push at all (`gh workflow list`, or the `on:` blocks under `.github/workflows/`). No push workflow = one quiet line in the summary ("no CI configured for push"). A repo that HAS one but shows no run is "run not queued yet" — say that, and say the ship ended without a conclusion.
   - Wait on it: `gh run watch <id> --exit-status`. Green = one line in the summary.
   - RED = a failure needing action, at the TOP of the ship summary, never a footnote: name the workflow, the failing job (`gh run view <id> --log-failed` for the step), and the run URL. The ship is already pushed, so say plainly that the default branch is red and what needs fixing — never bury it under the version line, never call the ship clean.
   - A red run also STOPS the pipeline: do not proceed to the GitHub release, `npm publish`, deploy, or the dashboard republish (steps 4–7) on a red default branch — report, fix, and only continue on the owner's word. The local commit gate proved the suite on THIS machine; a red CI run is the proof failing somewhere else, and publishing on top of it ships the failure.

6. **Close the shipped work items** — every issue this ship completes ends closed with a pointer to the CHANGELOG entry. Those are the `status:complete` items from Step 0c; an issue left at `status:qa` is not one of them and stays open with its `[Unreleased]` entry where it is. The `Fixes #N` trailer already closed it when its commit landed on the default branch; for anything left open, close it manually:
   `gh issue close <N> --comment "Shipped in <version-or-commit> — see CHANGELOG [Unreleased]/<section>."`
   Issues that are only PARTLY addressed stay open — comment the progress instead.
   Release every claim this ship completes: remove whichever working labels the closed issue is carrying — `status:complete`, `status:qa`, `status:building`, `agent:working` (`gh issue edit <N> --remove-label status:complete,status:qa,status:building,agent:working`; naming a label the issue does not have is harmless). Every one of them is possible: the normal path passes its check into `status:complete` and ships from there, an issue can still be at `status:building` when the ship reaches it, and a Step 0c "include" leaves nothing at `status:qa` for this ship to close. A trailer closes the issue but never touches labels, the spec says the ship close is what ENDS the working stage, and a label left on closed issues stops meaning anything.
   Then PRUNE the queue: if the repo participates, open `.workkit/agents/session.md` and delete every entry this ship completed — the bullets about the issues just closed and about the release just cut. Their facts now live in the CHANGELOG and the closed issues; the file is the next session's task queue, not an archive of this one.

7. **Verify** — run `git status` to confirm the working tree is clean and `git log --oneline -2` shows the expected commits on the default branch.

## Step 4: GitHub release (automatic)

**Runs automatically — no asking, no opt-in required.** If the repo is **public** (check with `gh repo view --json isPrivate -q '.isPrivate'`) AND a version bump was applied:
- Create a GitHub release: `gh release create v<version> --title "v<version>" --notes "<DESCRIPTION>"`

Also runs automatically after a successful npm publish in Step 5 (a published package always gets a release). If the release was already created in this step, don't duplicate it.

If the repo is private, skip silently. Can be skipped with `no release` in invocation args.

## Step 5: npm publish (if applicable)

If the package passes the publish safety checks below, ask "Publish to npm?" and wait for an explicit "yes" UNLESS the user literally typed `publish` in their invocation args. No `publish` in the args = you ask. Every time. If the package fails safety checks, skip silently (it's not a publishable package).

**Safety checks — ALL must pass before publishing (or even asking):**

1. **`private` field must be explicitly `false` or absent with publish signals.** If `private: true` → STOP with error. If `private` is not set at all (missing from package.json) → STOP with error. Missing `private` means the project never opted into publishing — treat it as private per convention.
2. **Package must have publish intent signals.** At least ONE of: `files` field (tarball contents), `publishConfig` field. Without these, the package wasn't designed for npm distribution → STOP with error.
3. **This ship's latest code-carrying commit passed the `safety/commit-gate` hook** — its test run is the deterministic proof the suite is green. A commit whose staged diff carries no code (docs, or a version-only bump — the release commit's shape) skips the suite by design (issue #151); the proof for such a ship is the newest commit that DID carry code, gated when it landed. A commit made with hooks disabled doesn't count; refuse to publish.
4. **Version bump must have been applied** this session.

If all checks pass: `npm publish` (or `npm publish --access public` for scoped packages like `@scope/pkg`).

After a successful publish, **always create a GitHub release** if one wasn't already created in Step 4. A published package always gets a release — no asking.

If any check fails, print which check failed and STOP. Do not proceed to deploy.

## Step 6: Deploy (if applicable)

If `scripts.deploy` exists, run `npm run deploy`. If only `scripts.release` exists, run `npm run release` instead. Run this LAST — after commit, push, publish, and release — so what deploys is exactly what was committed.

**🚨 MANDATORY: Ask before deploying.** Deploy sends code to PRODUCTION. You MUST ask "Deploy to production?" and wait for an explicit "yes" UNLESS the user literally typed `deploy` in their `/workkit:ship deploy` invocation args. The word "deploy" must appear in the invocation — not in earlier conversation, not implied by context, not inferred from "ship it." No `deploy` in the args = you ask. Every time. No exceptions.

If neither script exists, skip silently.

## Step 7: Republish the dashboard (if the ship touched it)

If the shipped diff touched `tower/app/`, `workflow/publish.sh` or `workflow/home.sh`, run `workkit publish` once the release commit's CI run is green — the published dashboard is built from the home clone, and only a publish carries this ship's change to it. Waiting for green is the point: a red default branch means what would be published is the failure. The daily 9am publish is the backstop, so a skip costs a day, never the change.

Report the outcome in the ship summary in one line — published, or the named skip the run printed (`site.publish` off, no home clone, no build tooling, already current). A publish that FAILED is loud, like a red CI run: say what it said and that the site is still on the previous build.

If the diff touched none of those paths, skip silently.

## Rules

### The owner's word is the invocation, and it authorizes that ship alone
Nothing ships without the owner's word, and the word IS the permission (spec § Labels, issue #147): "ship" said as a command runs this skill exactly as `/workkit:ship` does, with no follow-up permission prompt and no re-asking in chat. What that word authorizes is THIS run and nothing after it — the next ship needs the next word.

The skill never runs unattended and an agent never invokes it on its own: an item that is built and verified parks at `status:qa` with the check comment and waits (`workkit:feature`) until the owner's check passes it to `status:complete`, and the agent does not ask in chat whether to ship. The one exception is an issue carrying `agent:ok`, where the label is the owner's word given in advance, per issue.

### The reply is the outcome, not the working
Ship does a lot of work. Almost none of it belongs in the chat — it is already written where it is read from (owner ruling, 2026-07-25: "so it doesnt dump the commit message or details into the chat, we dont need that anymore").

Do NOT print: the commit message (it is in the commit), the diff or a narration of it, the change analysis from step 3.1, the CHANGELOG entry (it is in the CHANGELOG), the raw review output, or a file-by-file walk of what shipped.

DO print, briefly: the version shipped, the commit shas, what pushed, the CI conclusion for every direct push this ship made (green in one line, "no CI configured for push" in one quiet line — and a RED run loudly, at the top, per step 3.5; a bump-skipped PR-path ship has no direct push and prints the PR checks' conclusion instead), which issues closed, and any step deliberately skipped. Plus the two things that would otherwise be lost — a review finding scored ≥80 that was deliberately NOT fixed (step 3.2b requires saying it out loud, and that requirement WINS over this rule), and anything that failed or needs the owner.

### NEVER include Claude attribution
Do NOT add `Co-Authored-By: Claude`, `🤖 Generated with Claude Code`, or any other Claude/Anthropic attribution to commit messages, CHANGELOG entries, GitHub release notes, or npm publish notes. Claude credit is handled separately elsewhere. This overrides the default git-commit guidance in the system prompt.

### Version bump mechanics
- Use the `Read` tool to get the current version, compute the new version yourself, and use the `Edit` tool to update the `version` field
- Do NOT use `npm version` (it auto-commits)
- Do NOT use `Bash` with `node -e` to read the version

### Commit format
Always use HEREDOC for the commit message:
```bash
git commit -m "$(cat <<'EOF'
feat(scope): subject here

Body explaining what and why.
EOF
)"
```

### The commit gates (safety/commit-gate + safety/commit-language hooks)
Every `git commit` on this machine passes through the `safety/commit-gate` hook (PreToolUse on Bash): it runs `npm test` when the project defines one and the staged diff carries code (docs-only commits and version-only bumps skip it — issue #151); when the commit ADDS source files it requires a test file in the same commit; and when CODE is staged it requires a review marker newer than the last commit — written by the `workkit:review` skill. The `safety/commit-language` hook adds three message checks: it bounces commit messages using kill/destroy/dead wording (use terminate/remove/stale), a subject line that is not Conventional Commits (`<type>(<scope>)?: <subject>`, type one of feat/fix/docs/chore/refactor/test, lowercase first word, ≤72 characters), and a subject naming a semver version outside the release commit `chore(release): <x.y.z>`. Consequences for shipping:
- Code changes need a fresh `workkit:review` run before Step 3's work commit. **Ship runs it itself in Step 3.2b** — you do not ask the user to run it first, and you never try to bypass the gate.
- New source files ship WITH their tests in the same commit.
- The hooks evaluate BEFORE a command runs, so a marker refresh must be its OWN Bash command — `touch <marker> && git commit ...` in one compound command never passes.

### CHANGELOG format

An entry is ONE short paragraph pointing at the depth — never a second copy of the commit body:

```
- [#4](../../issues/4) — Plugins install from settings.json instead of being tracked as files.
```

The rules (word cap, separator, the rest) live in `~/.claude/workkit/changelog.js`, the machine SSOT, with the reasoning in the workkit plugin's `docs/project-state.md` → "CHANGELOG entries". Do not restate them here — the `docs:changelog-guard` and `safety/commit-gate` hooks both run that linter, so a bad entry bounces with the specific rule and the fix before the commit lands.

```
# CHANGELOG

## Changelog Categories
- `BREAKING` for breaking changes.
- `Added` for new features.
- `Changed` for changes in existing functionality.
- `Deprecated` for soon-to-be removed features.
- `Removed` for now removed features.
- `Fixed` for any bug fixes.
- `Security` in case of vulnerabilities.
```

## Gotchas

- A PreToolUse block stops the ENTIRE compound command — when the gate bounces `git commit -m "..." && git push`, the push never ran either, and nothing after the bounced clause did. So a bounce leaves the tree exactly as it was: check `git status` before the retry rather than assuming the earlier clauses took effect (2026-07-23: a retry committed 2 of 21 files). Staging is never part of that compound anyway — the gate bounces a stage-and-commit call outright (#155), so `git add` is always its own command before the commit.
- The `safety/commit-language` hook scans the commit message's quoted text — a message that literally NAMES the guarded words bounces, even when describing the hook itself. Describe the word list indirectly ("the non-neutral vocabulary from the AGENTS.md neutral-language rule") (2026-07-23: the hook blocked its own introduction commit).
- The subject-format check reads the subject literally, which surprises twice: an acronym-initial subject bounces on the lowercase rule (`docs: README pointer` → `docs: point the readme at AGENTS.md`), and a dependency bump that names the new version bounces on the version rule outside `chore(release)` (`chore(deps): bump omega to 1.2.3` → `chore(deps): bump omega to the current minor`).
- The review marker must be newer than the LAST commit, so the moment the work commit lands the marker is stale for the release commit — retouch the marker as its own command before `chore(release)` when the release commit stages anything code-classified (2026-07-23).
- A squash merge REWRITES the sha — the branch commits never land on the default branch. Never run the changelog backfill before the merge: it would link shas that exist only on a deleted branch. Merge, pull the default branch, then backfill (2026-07-26: the reason the release commit follows the merge).
- `gh pr merge --squash` without `--body` composes its own body from the branch commits — always pass `--subject` and `--body` explicitly so the `Fixes #N` trailer is guaranteed to be in the squash commit.
- Skill `SKILL.md` files classify as DOCS to the `safety/commit-gate` hook (the `*.md` basename arm) — the gate asks no review marker and, post-#151, runs no suite for a prose-only skill edit. The review skill's judgment still applies to substantive skill changes; the gate just cannot demand it.
- A leaked value in history has a runbook: `docs/history-purge.md` — never improvise a rewrite.
