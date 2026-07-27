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

## File-handoff convention (all dispatches)

Chat-inline briefs and reports bloat the dispatching context. Instead:

1. **Brief in a file.** The dispatcher writes the task brief to a file (session scratchpad dir) and passes the path plus a 1–3 sentence dispatch line. Briefs are **behavioral, not procedural**: state the goal, constraints, and done-criteria — not step-by-step file paths that go stale.
2. **Report to a file.** The brief names a report path. The agent writes its full findings/build report there.
3. **Return status only.** The agent's final message is: a completion status, commits if any, and ONE line of result. The dispatcher reads the report file only if the status demands it.

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
