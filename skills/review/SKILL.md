---
name: review
description: Multi-lens code review (parallel lenses, a separate scorer, only findings ≥80 confidence reach the report). - Use when the user asks to "review this", "review the diff", "code review", "check my changes", "review the PR", "simplify this", or before shipping substantial work.
user-invocable: true
---

# Review: parallel lenses, separate scorer, one report

Finder lenses read the diff in parallel, a separate scorer rates every finding, and one report carries what clears the bar.

## 1. Scope

- Default: uncommitted changes, else the last commit. The user may name a range, PR, or files.
- Collect the diff and the task context: what was ASKED, from the conversation, the issue, or its `## Spec`. Spec-faithfulness is judged against it.

## 1b. Tier: full by default, light by criteria

- **Default is FULL.** An explicit invocation arg wins both ways: `/workkit:review light` forces light, `/workkit:review full` forces full.
- **Full tier**: every applicable lens in §2, in parallel, plus the §3 scorer.
- **Light tier**: ONE `workkit:verifier` agent carrying the combined finder mandate, plus the §3 scorer:
  - bugs, compliance, spec-faithfulness, and simplification;
  - one line of the Parity mandate (§2): name each changed file's siblings and report where the new code differs;
  - the same brief discipline, and it still execution-verifies its claims.
- Both tiers run the §3 scorer: it is never skipped.

Downgrade to light ONLY when ALL of these hold (any miss = stay full):

1. Small diff: under ~150 changed lines AND ~5 files.
2. No guard surface touched: nothing under `.claude/` (hooks, skills, agents, `.claude/settings.json`), and in the dotfiles repo nothing under `setup/`. Those are the surfaces where a one-liner is catastrophic. Other repos' own config files are ordinary code, judged by criteria 1 and 3.
3. Fix-scope: a bug fix or tweak to existing behavior, not a new feature or a new source file.

- The light reviewer may return `NEEDS_FULL`, with one line of why, instead of a report. The skill then upgrades to the full panel immediately.
- A wrong downgrade costs one escalation, so never argue with the escape hatch.

## 2. Lenses: parallel subagents

- Dispatch per the file-handoff convention: the brief goes to a file in the session scratchpad, and each lens returns its full findings INLINE.
- Launch every lens in ONE message:
  - **Compliance + spec**: a user-level agent named `reviewer` if one exists (personal preloads), else `workkit:reviewer`. It derives its checklist from live docs and judges Spec-faithfulness against the task context.
  - **Bugs**: `workkit:scout` agent. Trace the diff for defects: logic, edge states, silent fallbacks. Read the surrounding code, not just the diff.
  - **Simplification**: `workkit:scout` agent. Run the deletion test over the diff's ADDITIONS (`js:patterns` `resources/code-design.md`): wrappers that add nothing, options with one caller, defensive branches for impossible states, needless indirection.
    - Clarity over brevity. Clearer sometimes means more lines, and an abstraction serving a NAMED second consumer is not clutter (global §3).
    - Findings name the collapse, never apply it.
  - **History**: `workkit:scout` agent. `git log`/`blame` on touched files: does the diff fight a past fix, revert intent, or repeat a reverted approach?
  - **Firestore rules**: `workkit:scout` agent, ONLY when the diff touches BEM/Firestore work. Check reads against rules coverage, both ways.
  - **Parity**: `workkit:scout` agent, full tier only. This entry is the kit's one home of the mandate's wording; the light tier and the per-issue drift question in `agents/verifier.md` both quote it.
    - For every file the diff adds or changes, name its siblings from the repo's docs and directory shape: the same kind of thing on another surface, target, command, or package.
    - Report where the new code's shape, naming, entry point, logging, or call form differs from them.
    - The principle is the global AGENTS.md parity rule (like things use like systems). The lens quotes it, never owns it.
    - Findings name the sibling and the mismatch, never apply a fix.
- Never tell a lens what NOT to flag, and never pre-rate severity in the brief. That manufactures false negatives.
- The `manager/resolver` hook supplies each class agent's model per spawn, so never pass a `model` param.

## 3. Scorer: separate pass

- The `workkit:verifier` agent scores every collected finding 0–100: "how certain is this a real issue a maintainer would fix?"
- It is never a finder in the same pass. Finder-never-scores is the integrity core of both tiers.
- It gets the finding and the relevant code, and re-checks the claim against the actual file before scoring.
- The false-positive list scores 0: linter-catchable, unmodified lines, pre-existing, no written rule, unreachable hypotheticals. So does a Parity finding whose file has no sibling.
- Where a lens attached its own confidence, the scorer's number wins.
- The final ship/fix/rework verdict stays with the dispatching session: frontier-or-session judgment by construction.

## 4. Report

- One consolidated report:
  - findings **≥80**: actionable items (file:line, issue, fix);
  - 40–79: compressed into a "lower confidence" note;
  - below 40: dropped silently.
- End with a verdict: ship / fix-then-ship / rework.
- Every item in the report, and every issue one names, reads in the cold-reader line (`docs/project-state.md` § Restating an issue).
- Done-criteria: every ≥80 finding names its file:line and a concrete fix; no lens output pasted raw into chat.
- A finding that gets FILED rather than fixed passes the filing litmus test first: *would closing an open issue automatically mean this is done too?*
  - Yes: it attaches to that issue, never as a sibling issue.
  - Polish-grade findings batch as checklist lines onto the surface's rolling `polish: <surface>` issue.
  - The rules: `docs/project-state.md` § How big is one issue.

## 5. Marker (feeds the commit gate)

- After the report, record that review ran, from inside the repo under review.
- The `safety/commit-gate` hook checks this marker before it allows a code commit. The script names the marker through the same helper the hook reads it with, so the two cannot drift.

```sh
bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/workkit/..}/scripts/review-marker.sh"
```

- `CLAUDE_PLUGIN_ROOT` is set only inside hook commands. The fallback reaches the plugin root through the engine's stable address: `~/.claude/workkit` is the engine folder INSIDE the plugin, and its parent is the plugin itself.

## Gotchas

- The inline return IS the convention. The reviewer, `workkit:scout`, and `workkit:verifier` toolsets have no Write anyway.
- A report FILE is the explicit-ask exception. Name its path in the brief only for a large artifact meant to be read selectively, and never ask a lens without Write for one.
- Do not re-run a full panel over edits that merely implement findings the scorer already judged this session: that reviews the review's own output.
  - The honest check is a light verification pass: "does each edit implement its finding without contradictions?"
  - The one exception is the `workkit:ship` panel: it runs full over the whole ship diff every time (its step 3.2b).
