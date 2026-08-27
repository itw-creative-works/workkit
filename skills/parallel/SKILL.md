---
name: parallel
description: Opt-in parallel mode — group the batch's issues, run a worktree-isolated crew per group at once, merge the groups serially, ship them as one release. - Use ONLY when invoked (/workkit:parallel) or when the user asks to work several issues in parallel. NEVER fires on its own.
user-invocable: true
---

# Parallel — one manager, worktree groups, serial merges

**Opt-in, always.** Without this invocation nothing changes: the queue is worked one issue at a time, as everywhere else. Say that the mode is ON when you start it, and say when it ends.

One manager throughout. The session is the only dispatcher (`docs/agents.md` § Definition rules) — parallelism comes from WORKTREE ISOLATION, never from a manager inside a manager.

## 1. Batch — say which issues, out loud

The batch is the issues the user names; when they name none, propose one from the open board and get a yes before grouping. Every issue in it is `status:specced` with an accepted `## Spec` — an unspecced issue leaves the batch and takes the spec pass first ([workkit:feature](../feature/SKILL.md) phase 0a), never a spec written inline while groups are running. Pipeline rules: `docs/project-state.md`.

## 2. Group — manager judgment, recorded before any spawn

Three forces, in ORDER; a later one never overrides an earlier:

1. **Dependency edges.** A blocker and its dependent never run in different concurrent groups — same group in sequence, or the blocker's group merges first (§4). Read the edges from the issues (GitHub's blocked-by, plus any inline `Depends on:` line).
2. **Shared seams.** Issues touching one file or module go in one group, so no two worktrees can write the same lines.
3. **Size balance.** Only then, even the groups out.

State the grouping and the reasoning in chat, then CLAIM each issue as everywhere — assign it, `status:building`, `agent:working` — and post its claim comment naming its group and that group's other issues. That comment is the record; no spawn happens before it exists. An issue already assigned to someone else drops out of the batch.

## 3. Run the groups — concurrently, each on its own worktree

Per group, by the file-handoff convention (`docs/agents.md`):

- ONE `workkit:worker` against ONE per-group brief — the group's issues and their Specs, the seam it owns, its done-criteria. Dispatch it with the Agent tool's `isolation: "worktree"` param: the group builds on its own tree, and two groups never share one. An ordinary spawn writes the shared checkout — that one field is the whole isolation.
- A `workkit:verifier` judges THAT worktree's diff against THAT brief, blind, before the group is eligible to merge. Findings ≥80 go back to the group's worker on the same worktree; the group does not land until they are answered.

Launch the group WORKERS in ONE message so they run concurrently (each verifier follows its own group's worker, never alongside it), and stay out of the volume while they do — a manager editing the main tree under running groups is the one thing worktrees cannot isolate.

## 4. Merge — serial, green between landings

One group at a time onto the main tree, dependency order first and verified-first after that. A landing is the MANAGER applying the group's worktree diff onto the main tree — workers never commit, so the worktree's uncommitted diff is the group's whole output, and ship (§5) makes the batch's only commits. The FULL suite is green after each landing before the next begins; a red suite stops the queue and belongs to the group that just landed. A conflict surfaces at apply time and is the landing group's crew's to resolve on its own worktree, never patched blind on main.

## 5. Ship — one release closes the batch

A landed batch parks like everything else: every issue in it goes to `status:qa` with its own check comment, and the batch says in one line that its items sit there until the owner's check passes each to `status:complete`, which is the stage the ship reads them from — one ship for the batch. `agent:ok` issues park too, as they do anywhere — the check on them is the agent's own, and so is the flip to `status:complete`.

Default: a single [workkit:ship](../ship/SKILL.md) over the whole batch — one release, its CHANGELOG carrying every group's entries, its commit trailers closing every issue. A group whose result is urgent may ship alone; say so out loud and say why. Done-criteria: every issue in the batch verified in its group, landed with the suite green, parked at `status:qa`, and closed by the ship once its check passed it to `status:complete` — or named, with its reason, as dropped from the batch, its claim released (unassign, labels back).

## Never

- Never spawn a manager inside a group — dispatch stays one level deep.
- Never run a blocker and its dependent in concurrent groups.
- Never land a group the verifier has not passed, and never start the next landing over a red suite.
- Never let this mode be assumed: no invocation, no parallel work.
