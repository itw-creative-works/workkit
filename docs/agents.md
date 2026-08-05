# Agents — the workkit crew

Agent definitions shipped by the workkit plugin. They surface in a session namespaced as `workkit:<name>`. **An agent exists here only if a flow dispatches it** — unrouted agents are dead weight. Every definition names its dispatcher below.

## Roster

| Agent | File | Dispatched by |
|---|---|---|
| `workkit:reviewer` | `reviewer.md` | the `workkit:review` flow (compliance lens) |
| `workkit:scout` | `scout.md` | the manager profile (recon) + `workkit:review` lenses |
| `workkit:worker` | `worker.md` | the manager profile (implementation) |
| `workkit:verifier` | `verifier.md` | `workkit:review` scorer/light tier + the manager profile |
| `workkit:advisor` | `advisor.md` | the manager profile, in sessions below the frontier tier |

## Classes (the manager system)

`scout` / `worker` / `verifier` / `advisor` are the CAPABILITY CLASSES of the manager system. Their concrete model is supplied per spawn by the `manager/resolver` hook from `../hooks/manager/ladder.json` (the tier SSOT) and the LIVE session model — a mid-session `/model` switch takes effect on the next spawn. The `model:` frontmatter in these four files is only the static fallback for when the hook is disabled; never treat it as the routing truth, and never pass a `model` param when dispatching them.

### Crew sizing

The manager stages the crew to the task rather than assembling it all at once: a small change is the manager alone or ONE worker; a feature is one worker, or a worker pair only when each has its own worktree and the manager merges; the `verifier` runs ONCE, when the build claims done; the full review panel assembles only inside `workkit:review` and `workkit:ship`. `scout` is recon — dispatch it at any point. Dispatch is one level deep throughout (§ Definition rules), so every stage is the manager's to open and close, and the manager keeps `.workkit/session.md` current as it goes — the task queue and quick notes, with durable facts promoted to their issue the moment they exist. Design calls, contract changes, final verdicts, and anything security-adjacent stay the manager's, never the crew's. The self-edit line (#131, owner ruling 2026-08-04): the manager edits inline only when doing the edit costs fewer tokens than briefing a worker — in practice up to a line or a function; anything larger goes to a worker and gets the blind verify.

### Parallel mode (opt-in)

Several issues may be worked at once, but only when a `workkit:parallel` invocation turns that on; the default stays one issue at a time. It changes nothing about who dispatches — the session is still the only manager, and the concurrency lives in the WORKTREES.

The manager groups the batch's issues before any spawn, by three forces in order: dependency edges (a blocker and its dependent never in different concurrent groups), then shared seams (issues touching one file or module group together, so no two worktrees write the same lines), then size balance. The grouping is recorded on each issue as its claim comment. Each group then gets ONE worker against ONE per-group brief on its own worktree and ONE blind verifier over that worktree's diff, and the group crews run concurrently. Merges are SERIAL — one group lands on the main tree at a time, the full suite green before the next begins, and a conflict is the landing group's to resolve on its worktree. One ship closes the batch by default: a single release carrying every group's CHANGELOG entries and closing every issue; a group whose result is urgent may ship alone, said out loud. The skill executes this; it is not a second set of rules.

### Questions to the owner

A decision put to the owner is SELF-CONTAINED: the question carries its full background in plain words — what the item is, why it needs a decision now, and what each choice means in consequence — written for an owner who has read nothing else this session. Option labels are plain outcomes, never internal shorthand, and the recommended option says why it is recommended. The chat message before a question dialog briefs each decision in its own short paragraph, so the dialog confirms choices the owner already understands rather than introducing them. Unrelated decisions still batch into one pass — the questions arrive together, each standing alone (owner ruling, 2026-08-04).

## Agents from other repos

A session's agents come from three places: any plugin ships them in its own `agents/` directory (this repo's, namespaced `workkit:`, is one such set), a repo ships them in `.claude/agents/`, and a user in `~/.claude/agents/`. Precedence on a name collision is **project > user > plugin**.

The `manager/resolver` hook routes ONLY the four workkit classes above — every other `subagent_type`, foreign or built-in, passes through untouched. So a foreign agent's `model:` frontmatter IS its contract: nothing here overrides it, and nothing here needs to know it exists. Ladder routing for foreign agents is deliberately unbuilt; it waits for a real consumer to name what it needs.

## File-handoff convention (all dispatches)

A chat-inline brief bloats the dispatching context; a report file the dispatcher then has to open is a round trip nobody needs. So the two halves go opposite ways:

1. **Brief in a file.** The dispatcher writes the task brief to a file (session scratchpad dir) and passes the path plus a 1–3 sentence dispatch line. Briefs are **behavioral, not procedural**: state the goal, constraints, and done-criteria — not step-by-step file paths that go stale.
2. **Report inline.** The agent's final message IS the report: a completion status, commits if any, and the findings the dispatcher needs to act — written for a reader who has not seen the work. No report file, and no summary file beside it.
3. **A report FILE is the exception.** Only when the brief explicitly asks for one — a large artifact meant to be read selectively rather than in chat. Then the final message stays status, commits, and ONE line of result plus the path.

Each agent file inlines the slice of this it needs, so it stays portable — this README is the full statement, not an import target.

### Completion statuses

| Status | Meaning |
|---|---|
| `DONE` | Done-criteria met, verified this run |
| `DONE_WITH_CONCERNS` | Done-criteria met; report lists risks/follow-ups |
| `BLOCKED` | Cannot proceed — report says what's missing and what was tried |
| `NEEDS_CONTEXT` | Brief is ambiguous — report lists the specific questions |

After **3 failed attempts** at the same obstacle, stop and return `BLOCKED` with the attempts documented — don't burn the run retrying.

## Definition rules

- **Subagents NEVER spawn subagents.** One level of dispatch only — the main session is the only dispatcher (reference: https://code.claude.com/docs/en/sub-agents).
- Frontmatter: `name`, `description`, `tools` (minimum set — the list is also what mechanically keeps an agent from spawning subagents), and for the class agents `model` (fallback only, § Classes) + `effort`.
- **No knowledge in agent files** — agents define behavior and preloads; knowledge lives in skills/docs. The reviewer's "derive the checklist from live docs" pattern is the model.
- **No machine-specific paths.** These files ship to any repo on any machine: no absolute paths, no pointers into a personal `~/.claude` tree beyond what every Claude Code install has.
- Repo-doc entry point: AGENTS.md (CLAUDE.md is a one-line pointer in migrated repos; a repo that hasn't migrated may still carry content in CLAUDE.md — read whichever bears content).
