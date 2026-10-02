---
name: feature
description: Scaled feature flow (explore, interview, propose, gate, build, review); ceremony scales with the task. - Use when starting a non-trivial feature or change ("build", "add", "implement", "create a feature"), on issue work (the workflow:feature hook loads it), or when invoked (/workkit:feature).
user-invocable: true
---

# Feature flow: ceremony scales with the task

Each phase prevents one failure: building the wrong thing, missing a consumer, shipping unreviewed. Skip a phase only when its failure cannot happen at this size.

## 0a. Pipeline gate: build only from `status:specced`

- When the work has an issue, check its stage before anything else.
- A build starts ONLY from `status:specced` with a real `## Spec`: the implementation layer, or the literal `None needed: small item.`
- A written Spec (anything but the literal) with no `### Contract` part (Files, Names, Cases; spec § Specs) is refused the same way: it goes back through the spec pass below for its Contract.
- An issue at `status:inbox`, or a specced one whose Spec lacks the implementation layer, gets the SPEC PASS first:
  - a `workkit:scout` maps the territory (its brief from `briefs/recon-scout.md`), and the spec drafts against the issue and the map;
  - any Spec beyond the literal gets the [workkit:interview](../interview/SKILL.md) BEFORE acceptance is requested, never a whole draft handed over for a yes (spec § Specs; `agent:ok` issues are exempt);
  - the manager reviews, the owner accepts, the deepened Spec lands on the issue carrying its `### Contract`, and the label moves to `status:specced`.
- That flip IS the authorization, then build. On an issue carrying `agent:ok`, an agent may make the flip itself.
- Whatever you write onto the issue follows spec § Issue anatomy. That includes the introduction rule: the first mention of an outside project or repo carries a link and a one-line description of what it is.

### The claim, and the road the labels take

- Claim the issue before working it: assign yourself, move it to `status:building`, AND add `agent:working`:
  `gh issue edit <N> --add-assignee @me --remove-label status:specced --add-label status:building,agent:working`
- Skip an issue already assigned to someone else. Re-read the label and the assignee when you start, not when you listed the queue.
- `agent:working` tells an agent claim from a human one. An agent runs `gh` as the owner, so the assignee cannot.
- Remove `agent:working` when you release the issue, finished or not. The standards heal sweeps a claim left idle for 24 hours.
- Never take `status:building` off by hand. It carries build and verify, phase 6 flips it to `status:qa`, the owner's passing check moves it to `status:complete`, and the ship close ends it.
- The road and the rules: the workkit plugin's `docs/project-state.md` § Labels.

## 0. Size the task: say the size out loud

- **Trivial** (one file, no design choice, obvious spec): skip to phase 4. State "trivial: building directly."
- **Standard** (a few files, some choices, clear goal): phases 1, 2, 4, 5. Skip formal proposals (3); state your chosen approach in one paragraph before building.
- **Large** (new subsystem, architectural choice, multiple valid shapes): all phases, inside plan mode.

### Plan mode (large automatically, any size on request)

- A large task enters plan mode (EnterPlanMode) BEFORE exploring. The session goes read-only, phases 1–3 run inside it, and the plan approved at exit IS the phase-4 gate.
- The whole-system thinking happens where nothing can be edited yet.
- Any size enters it on the owner's word ("plan this", or the plan-mode toggle). A standard task without it keeps the chat gate in phase 4.

## 1. Explore

- Map the territory before designing. Dispatch Explore subagents that return **key-file LISTS, not content**, then read those files yourself.
- Find the existing utilities and patterns the feature must reuse. Never propose new code where a suitable implementation exists.
- Note every consumer a contract change would imply (global §4).

## 2. Clarify: interview, never skip

- Run [workkit:interview](../interview/SKILL.md): the full category sweep, asked in chat rounds, never the AskUserQuestion tool.
- It CLOSES by drafting the `## Spec` from the answers, so the interview and the spec pass are one motion.
- Standard and large tasks NEVER skip this phase. One round of "zero open decisions" is cheap; building the wrong thing is not.

## 3. Approaches (large only)

- Produce 2–3 proposals with genuinely different mandates, each with its tradeoffs, your recommendation first:
  - **minimal**: the smallest correct change;
  - **clean**: the right architecture, even if bigger;
  - **pragmatic**: the best value per change.

## 4. Gate, then build

- Standard and large: get explicit approval of the approach before writing code. Large: the plan-mode approval at exit. Standard: a stated go-ahead in chat.
- Build with the test obligation scaled per global §6. Red first where possible.
- On large tasks, tracer-bullet the thinnest end-to-end slice (`js:patterns` `resources/tdd.md`).

### Crew staging

- Stage the class agents by phase, never all at once.
- A batch builds in parallel groups on the shared tree, grouped and launched as `docs/agents.md` § Batches says.
- Build: ONE pair of `workkit:worker` briefs per group, a feature-developer and a test-developer on the shared tree. The rule is `docs/agents.md` § Crew sizing.
  - The feature-developer's brief starts from `briefs/feature-developer.md` and names its source paths and the issue's `### Contract`.
  - The test-developer's brief starts from `briefs/test-developer.md` and names its test paths, the Contract and the Description.
  - A group with no test surface gets one worker, its brief from `briefs/docs-developer.md`.
- Verify: one blind `workkit:verifier` per group over the pair's merged diff, its brief from `briefs/group-verifier.md`, red first proven through `scripts/red-proof.sh` (the form: `docs/agents.md` § Crew sizing), one fix round; then ONE review panel over the batch diff (phase 5), then park every issue.
- The `workkit:verifier` runs twice: when the build claims done, and after the review (phase 5). The full review panel assembles only in phase 5. `workkit:scout` is recon: dispatch it at any point.
- A finding that names a class ("one more site reads the value the same wrong way") gets one `workkit:scout` sweep of the whole class before the worker round, so the class is one round, never one round per instance.
- An edit that touches many test files rides its own batch: the batch's first qa flip runs every test file the working diff touched, so a wide edit makes every other item in the batch wait on them.

## 5. Verify + review

- Each agent runs only the test files touched by the edit it made or checks, by path (`docs/project-state.md` § The proof). The park runs no root suite: its proof is the flip to `status:qa`, which runs every test file the working diff touched, once per tree (`safety/proof-guard`). The full suite runs once, a root `npm test` before the commit. So no brief asks an agent for the whole touched set.
- Then [workkit:review](../review/SKILL.md) on the diff. Trivial tasks skip formal review.
- A ≥80 finding is fixed in the batch or filed before calling it done, per the fix-or-file rule (`docs/project-state.md` § How big is one issue). The review's simplification lens covers post-green cleanup.
- After the review: ONE light verification pass over the fixes (its brief from `briefs/fix-verifier.md`), ONE worker round for what it finds, then retouch the review marker so it covers the parked diff, with `full` only when that review was the full panel (the retouch closes its round; `workkit:review` § 5), then the park:
  `bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/workkit/..}/scripts/review-marker.sh"` (add `full` after a full panel)
- A finding made after that round is filed per the fix-or-file rule and worked in the next batch, never in another round. The one exception is a bug in a `safety/` hook, fixed before the park.
- Done-criteria:
  - green at every layer the change has a surface on (`docs/project-state.md` § The proof);
  - review verdict "ship";
  - the issue and docs updated per the doc-parity rules.

## 6. Park at `status:qa`: the flow ends here, not at a ship

- Build done, tests green, review passed: the work STAYS IN THE WORKING TREE, uncommitted until the owner's pass. `safety/commit-gate` bounces a commit whose message names an open issue not at `status:complete`.
- The park is MECHANICAL, not a question. It happens the moment the done-criteria above are met.
- Say what to check, then flip. The comment lands FIRST so the park carries the record: the proof is a hard gate, and without it an item can neither reach `status:complete` nor close (spec § The proof).
- The comment's first line is `Proof:`, one entry per layer: the command, or the reason it was skipped, and beside them the red-proof run (the `scripts/red-proof.sh` line the verifier printed). The check reads it first.
- The rest of the comment is the whole handover: what changed, what to look at, and where. Where is the page to open, the command to run, or the diff to read when the change has no surface.

```
gh issue comment <N> --body "Proof: <one entry per layer: the command, or why it was skipped>; <the red-proof run>

<what to check, and where>"
gh issue edit <N> --remove-label status:building,agent:working --add-label status:qa
```

- `agent:working` comes off with the flip: the agent is done and the wait is the owner's. The assignee stays, and the work stays in that tree.
- Do not ship, and do not ask in chat whether to ship. The owner's word runs [workkit:ship](../ship/SKILL.md), and asking for it asks them to approve their own gate (spec § Labels).
- A failed check comes back here: fix it in place and re-comment; the label does not move.
- A batch parks together: every issue goes to `status:qa` with its own comment once the batch's one panel and its fix round are done (`docs/agents.md` § Batches). The batch is the plan in `.workkit/agents/session.md`, or the Batches bullet of `docs/project-state.md` § Queue semantics when no plan is written.
- The commit word comes once, when the whole batch is parked. Commit and ship still wait on the owner's word, and a commit naming the batch's issues waits on their pass; the batch only decides what rides it.

### The pass: only the owner's word moves it on

- When the owner says the check passed (in chat, in their own words), flip the issue to `status:complete` and record the pass:

```
gh issue edit <N> --remove-label status:qa --add-label status:complete
gh issue comment <N> --body "QA passed by <owner>, <date>."
```

- That stage means "checked, ready to ship", and the ship reads from it. Note the pass in the session notes too, so the next session knows the item is good to go.
- The verdict is the OWNER'S, like `agent:ok`. Never grant it on their behalf, and never infer it from silence or your own confidence in the work.

### The one exception: `agent:ok`

- `agent:ok` is the owner's word given in advance, so the park is a pass-through.
- Flip to `status:qa` and comment as always, but KEEP `agent:working` on that flip (`--remove-label status:building --add-label status:qa`). The claim holds because the agent is still working.
- Then perform the check yourself, flip to `status:complete` with the same pass comment, and ship and close in the same run. The ship close releases the labels (spec § the qa stage).
