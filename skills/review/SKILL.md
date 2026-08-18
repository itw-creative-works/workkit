---
name: review
description: Multi-lens code review — parallel lenses, a separate scorer, only findings ≥80 confidence reach the report. - Use when the user asks to "review this", "review the diff", "code review", "check my changes", "review the PR", "simplify this", or before shipping substantial work.
user-invocable: true
---

# Review — parallel lenses, separate scorer, one report

## 1. Scope

Default: uncommitted changes (else the last commit); the user may name a range, PR, or files. Collect the diff + the task context (what was ASKED — from the conversation, the issue, or its `## Spec`) so Spec-faithfulness is judgeable.

## 1b. Tier — full by default, light by criteria

Two tiers. **Default is FULL.** An explicit invocation arg wins both ways: `/workkit:review light` forces light, `/workkit:review full` forces full.

- **Full tier**: every applicable lens in §2, in parallel, plus the §3 scorer.
- **Light tier**: ONE `workkit:verifier` agent carrying the combined finder mandate (bugs + compliance + spec-faithfulness + simplification, same brief discipline, still execution-verifies its claims), plus the §3 scorer. The scorer is never skipped — finder-never-scores is the integrity core of both tiers.

Downgrade to light ONLY when ALL of these hold (any miss = stay full):
1. Small diff: under ~150 changed lines AND ~5 files.
2. No guard surface touched: nothing under `.claude/` (hooks, skills, agents, `.claude/settings.json`) and, in the dotfiles repo, nothing under `setup/` — the surfaces where a one-liner is catastrophic. Other repos' own config files are ordinary code, judged by criteria 1 and 3.
3. Fix-scope: a bug fix or tweak to existing behavior, not a new feature or new file of source.

The light reviewer may return `NEEDS_FULL` (with one line of why) instead of a report; the skill then upgrades to the full panel immediately. A wrong downgrade costs one escalation; never argue with the escape hatch.

## 2. Lenses — parallel subagents

Dispatch per the file-handoff convention: the brief goes to a file in the session scratchpad, and each lens returns its full findings INLINE. Launch in ONE message:

| Lens | Agent | Mandate |
|---|---|---|
| Compliance + spec | a user-level agent named `reviewer` if one exists (personal preloads), else `workkit:reviewer` | Derive checklist from live docs; Spec-faithfulness vs the task context |
| Bugs | `workkit:scout` agent | Trace the diff for defects: logic, edge states, silent fallbacks — read surrounding code, not just the diff |
| Simplification | `workkit:scout` agent | Run the deletion test over the diff's ADDITIONS (`js:patterns` `resources/code-design.md`): wrappers that add nothing, options with one caller, defensive branches for impossible states, needless indirection. Clarity over brevity — clearer sometimes means more lines, and an abstraction serving a NAMED second consumer is not clutter (global §3). Findings name the collapse, never apply it |
| History | `workkit:scout` agent | `git log`/`blame` on touched files: does the diff fight a past fix, revert intent, or repeat a reverted approach? |
| Firestore rules | `workkit:scout` agent | ONLY when the diff touches BEM/Firestore work: reads vs rules coverage both ways |

Never tell a lens what NOT to flag and never pre-rate severity in the brief — that manufactures false negatives. The `manager/resolver` hook supplies each class agent's model per spawn — never pass a `model` param.

## 3. Scorer — separate pass

The `workkit:verifier` agent (never a finder in the same pass) scores every collected finding 0–100: "how certain is this a real issue a maintainer would fix?" It gets the finding + the relevant code, applies the false-positive list (linter-catchable, unmodified lines, pre-existing, no written rule, unreachable hypotheticals → score 0) and re-checks the claim against the actual file before scoring. Where a lens attached its own confidence, the scorer's number wins. The final ship/fix/rework verdict stays with the dispatching session — frontier-or-session judgment by construction.

## 4. Report

One consolidated report: findings **≥80** as actionable items (file:line, issue, fix); 40–79 compressed into a "lower confidence" note; below 40 dropped silently. End with a verdict: ship / fix-then-ship / rework. Done-criteria: every ≥80 finding names its file:line and concrete fix; no lens output pasted raw into chat.

A finding that gets FILED rather than fixed now passes the filing litmus test first — *would closing an open issue automatically mean this is done too?* Yes → it attaches there, never as a sibling issue; polish-grade findings batch as checklist lines onto the surface's rolling `polish: <surface>` issue. The rules: `docs/project-state.md` § How big is one issue.

## 5. Marker (feeds the commit gate)

After the report, record that review ran — the `safety/commit-gate` hook checks this marker before allowing a code commit:

```sh
mkdir -p "${TMPDIR:-/tmp}/claude-review-marker" && touch "${TMPDIR:-/tmp}/claude-review-marker/$(git rev-parse --show-toplevel | tr -d '\n' | shasum | cut -d' ' -f1)"
```

## Gotchas

- The inline return IS the convention (#133) — the reviewer, `workkit:scout`, and `workkit:verifier` toolsets have no Write anyway. A report FILE is the explicit-ask exception: name the path in the brief only when the output is a large artifact meant to be read selectively, and never ask a lens without Write for one.
- Do not re-run a full panel over edits that merely implement findings the scorer already judged this session — that reviews the review's own output. A light verification pass ("does each edit implement its finding without contradictions?") is the honest check (2026-07-23).
