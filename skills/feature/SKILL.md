---
name: feature
description: Scaled feature-development flow — explore, interview, propose, gate on approval, build, review; ceremony scales with the task. - Use when starting a non-trivial feature or change ("build", "add", "implement", "create a feature") or when invoked (/workkit:feature).
user-invocable: true
---

# Feature flow — ceremony scales with the task

Every phase exists to prevent a specific failure (building the wrong thing, missing a consumer, shipping unreviewed). Skip a phase only when its failure can't happen at this size.

## 0a. Pipeline gate — build only from `status:specced`

When the work has an issue, check its stage before anything else. Builds start ONLY from `status:specced` with a real `## Spec` (the implementation layer, or the literal `None needed — small item.`). An issue at `status:inbox` — or a specced one whose Spec is missing its implementation layer — gets the SPEC PASS first: a `workkit:scout` maps the territory, the spec drafts against the issue and the map — and any Spec beyond the literal `None needed — small item.` gets the [workkit:interview](../interview/SKILL.md) BEFORE acceptance is requested, never a whole draft handed over for a yes (spec § Specs; `agent:ok` issues are exempt) — the manager reviews, the owner accepts; the deepened Spec lands on the issue and the label moves to `status:specced`. That flip IS the authorization; on an issue carrying `agent:ok` an agent may make it itself. Then build. Whatever you write onto the issue follows the anatomy rules (spec § Issue anatomy), including the introduction rule: the first mention of an outside project or repo carries a link and a one-line description of what it is.

Claim the issue before working it: assign it to yourself, move it to `status:building`, AND add `agent:working` (`gh issue edit <N> --add-assignee @me --remove-label status:specced --add-label status:building,agent:working`), skip an issue already assigned to someone else, and re-read the label and the assignee at the moment you start — not at the moment you listed the queue. Remove `agent:working` when you release the issue, finished or not; a claim left behind is swept by the standards heal after 24 idle hours. `status:building` is not taken off by hand — it carries the work through verify and ship, and the ship close ends it. The `agent:working` label is what tells an agent claim from a human one — an agent runs `gh` as the owner, so the assignee cannot. (The road and the rules: the workkit plugin's README and `docs/project-state.md`.)

## 0. Size the task — say the size out loud

- **Trivial** (one file, no design choice, obvious spec): skip to phase 4. State "trivial — building directly."
- **Standard** (a few files, some choices, clear goal): phases 1, 2, 4, 5 — skip formal proposals (3); state your chosen approach in one paragraph before building.
- **Large** (new subsystem, architectural choice, multiple valid shapes): all phases, inside plan mode.

### Plan mode (large automatically, any size on request)

A large task enters plan mode (EnterPlanMode) BEFORE exploring: the session goes read-only, phases 1–3 run inside it, and the plan approved at exit IS the phase-4 gate — the whole-system consideration happens where nothing can be edited yet. Any size enters it on the owner's word ("plan this", or the plan-mode toggle). Standard tasks without it keep the chat gate in phase 4.

## 1. Explore

Map the territory before designing: dispatch Explore subagents that return **key-file LISTS, not content** — then read those files yourself. Find the existing utilities and patterns the feature must reuse (never propose new code where a suitable implementation exists). Note every consumer a contract change would imply (global §4).

## 2. Clarify — interview, never skip

Run [workkit:interview](../interview/SKILL.md) — the full category sweep, asked in chat rounds, never the AskUserQuestion tool. It CLOSES by drafting the `## Spec` from the answers, so the interview and the spec pass are one motion. Standard+ tasks NEVER skip this phase — one round of "zero open decisions" is cheap; building the wrong thing is not.

## 3. Approaches (large only)

Produce 2–3 proposals with genuinely different mandates — **minimal** (smallest correct change), **clean** (right architecture even if bigger), **pragmatic** (best value-per-change) — each with tradeoffs and your recommendation first.

## 4. Gate → build

Standard/large: get explicit approval of the approach before writing code (large: the plan-mode approval at exit; standard: a stated go-ahead in chat). Then build with the test obligation scaled per global §6 — red first where possible; tracer-bullet the thinnest end-to-end slice on large tasks (`js:patterns` `resources/tdd.md`).

### Crew staging

Stage the class agents by phase, never all at once. Build = ONE `workkit:worker` against a brief; a test-writer + feature-writer pair only when each has its own worktree, and the dispatcher merges. The `workkit:verifier` runs ONCE, when the build claims done. The full review panel assembles only in phase 5. `workkit:scout` is recon — dispatch it at any point.

## 5. Verify + review

Run the suite. Then [workkit:review](../review/SKILL.md) on the diff (trivial tasks: skip formal review; the green suite is the proof). Fix ≥80 findings before calling it done. Optional final pass: [workkit:simplify](../simplify/SKILL.md) — only after green. Done-criteria: suite green, review verdict "ship", the issue and docs updated per the doc-parity rules.
