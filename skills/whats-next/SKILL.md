---
name: whats-next
description: Plain-language status digest from the repo's GitHub issues (or across all projects via the roster) — one sentence per item, tells and never does. - Use when the user asks "what's next", "whats next", "where are we", "status", "what's left", "what am I waiting on", "what's next everywhere / across all projects".
---

# What's Next — tell, don't do

**READ-ONLY.** This skill answers; it never starts work, edits an issue, or "helpfully" begins the top item. After answering, stop.

## Repo mode (default — a project repo is the cwd)

One query does it: `gh issue list --state open --json number,title,labels,assignees --limit 100`.
Answer in this shape, plain language, one sentence per item:

1. **Waiting on you** — `status:blocked` issues. Name the actual question for each (it is in a comment: `gh issue view <N> --comments`).
2. **In flight** — `status:building` issues, plus a `status:specced` issue with an assignee (the pre-flip claim shape). Say who and what.
3. **Up next** — `status:specced` and unassigned, in priority order: `priority:high` first, then unlabeled (= normal), then `priority:low`. First 3–5.
   Within one priority, order by dependency, risk, and reviewability: blockers first (work other issues wait on — a parent's open siblings and anything another issue names), then bugs, then shared seams (the file or module several queued items all touch), and only then dependent feature work. Say WHY the top item is top in the same sentence ("first because #12 waits on it"). This is the order the autonomy loop uses; the rule's home is `docs/project-state.md` § Queue semantics.
4. **Inbox** — the `status:inbox` count → offer the `workkit:triage` skill.

Also mention `.workkit/` if a lease/notes file says this session or developer is mid-work on an issue (`.workkit/` is per-developer session state, not shared truth).

Omit empty sections. No jargon without a plain-words gloss. Note `agent:ok` where it exists — that item can be worked autonomously.

## Global mode ("across all projects" / cwd is the home repo)

1. Read the roster — the `repos` map in `~/.workkit/.repos.json`, every entry whose value is not `"declined"` — and query each one's issues (`gh issue list --repo <owner/name> ...`). It is this machine's index; a repo it has never opened is not on it.
2. Per project, ONE line: `<name> — <in-flight item or "idle">; blocked: <count or none>; specced: <count>`.
3. Then the home repo's own issues (`site.repo` in `~/.workkit/settings.json`), same shape as repo mode — that is where the cross-project and business queue lives. No `site.repo` set: say so.
4. Flag unreachable repos (`(no remote)` / `(path missing)`) instead of skipping silently.

## Rules

- Generated on demand, never stored — no digest files.
- Plain sentences over tables; this is the "explain simpler" surface.
- Offline or no `gh`: say so plainly, then report from `.workkit/` alone — never guess at the queue.
- If nothing is in flight and nothing is blocked, say what is top of the queue and that it needs a go-ahead.
