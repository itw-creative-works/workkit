---
name: parallel
description: Opt-in parallel mode (group the batch's issues, run a worktree-isolated crew per group at once, merge the groups serially, ship them as one release). - Use ONLY when invoked (/workkit:parallel) or when the user asks to work several issues in parallel. NEVER fires on its own.
user-invocable: true
---

# Parallel: one manager, worktree groups, serial merges

Work a batch of issues at once: worktree-isolated groups, serial merges, one release.

## 0. The mode: opt-in, one manager

- **Opt-in, always.** No invocation, no parallel work: the queue is worked one issue at a time, as everywhere else. Never assume this mode.
- Say the mode is ON when you start it, and say when it ends.
- One manager throughout: the session is the only dispatcher (`docs/agents.md` § Definition rules). Parallelism comes from WORKTREE ISOLATION, never from a manager inside a group.

## 1. Batch: say which issues, out loud

- The batch is the issues the user names. When they name none, propose one from the open board and get a yes before grouping.
- Every issue in it is `status:specced` with an accepted `## Spec`. Pipeline rules: `docs/project-state.md`.
- An unspecced issue leaves the batch and takes the spec pass first ([workkit:feature](../feature/SKILL.md) phase 0a). Never write a spec inline while groups are running.

## 2. Group: manager judgment, recorded before any spawn

Three forces, in ORDER; a later one never overrides an earlier:

1. **Dependency edges.** Never run a blocker and its dependent in different concurrent groups. Put them in one group in sequence, or merge the blocker's group first (§4). Read the edges from the issues (GitHub's blocked-by, plus any inline `Depends on:` line).
2. **Shared seams.** Issues touching one file or module go in one group. No two worktrees can then write the same lines.
3. **Size balance.** Only then, even the groups out.

- State the grouping and the reasoning in chat.
- Then CLAIM each issue as everywhere (assign it, `status:building`, `agent:working`) and post its claim comment naming its group and that group's other issues.
- That comment is the record: no spawn happens before it exists.
- An issue already assigned to someone else drops out of the batch.

## 3. Run the groups: concurrently, each on its own worktree

Per group, by the file-handoff convention (`docs/agents.md`):

- ONE `workkit:worker` against ONE per-group brief: the group's issues and their Specs, the seam it owns, its done-criteria.
- Dispatch it with the Agent tool's `isolation: "worktree"` param. The group builds on its own tree; two groups never share one. That one field is the whole isolation: an ordinary spawn writes the shared checkout.
- A `workkit:verifier` judges THAT worktree's diff against THAT brief, blind. Never land a group the verifier has not passed.
- Findings ≥80 go back to the group's worker on the same worktree. The group does not land until they are answered.
- Launch the group WORKERS in ONE message so they run concurrently. Each verifier follows its own group's worker, never alongside it.
- Stay out of the volume while they run. A manager editing the main tree under running groups is the one thing worktrees cannot isolate.

## 4. Merge: serial, green between landings

- One group at a time onto the main tree: dependency order first, verified-first after that.
- A landing is the MANAGER applying the group's worktree diff onto the main tree. Workers never commit, so that uncommitted diff is the group's whole output, and ship (§5) makes the batch's only commits.
- The FULL suite is green after each landing before the next begins: the manager's one deliberate full run (`WORKKIT_SUITE=1 npm test`). A landing is not a commit, so the gate does not run there.
- A red suite stops the queue and belongs to the group that just landed. Never start the next landing over a red suite.
- A conflict surfaces at apply time. The landing group's crew resolves it on its own worktree, never patched blind on main.

## 5. Ship: one release closes the batch

- A landed batch parks like everything else: every issue goes to `status:qa` with its own check comment.
- Say in one line that the batch's items wait there until the owner's check passes each to `status:complete`, the stage the ship reads them from. One ship for the batch.
- `agent:ok` issues park too, as anywhere. The check on them, and the flip to `status:complete`, are the agent's own.
- Default: a single [workkit:ship](../ship/SKILL.md) over the whole batch. One release: its CHANGELOG carries every group's entries, its commit trailers close every issue.
- A group whose result is urgent may ship alone; say so out loud and say why.
- Done-criteria: every issue in the batch ends one of two ways.
  - Verified in its group and landed with the suite green. Then parked at `status:qa`, and closed by the ship once its check passed it to `status:complete`.
  - Named, with its reason, as dropped from the batch, its claim released (unassign, labels back).
