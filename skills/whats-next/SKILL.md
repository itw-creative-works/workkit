---
name: whats-next
description: Plain-language status digest from the repo's GitHub issues (or across all projects via HQ) — one sentence per item, tells and never does. - Use when the user asks "what's next", "whats next", "where are we", "status", "what's left", "what am I waiting on", "what's next everywhere / across all projects".
---

# What's Next — tell, don't do

**READ-ONLY.** This skill answers; it never starts work, edits an issue, or "helpfully" begins the top item. After answering, stop.

## Repo mode (default — a project repo is the cwd)

One query does it: `gh issue list --state open --json number,title,labels,assignees --limit 100`.
Answer in this shape, plain language, one sentence per item:

1. **Waiting on you** — `status:blocked` issues. Name the actual question for each (it is in a comment: `gh issue view <N> --comments`).
2. **In flight** — open issues with an assignee. Say who and what.
3. **Up next** — `status:queued`, in priority order: `priority:high` first, then unlabeled (= normal), then `priority:low`. First 3–5.
4. **Inbox** — the `status:inbox` count → offer the `workkit:triage` skill.

Also mention `.workkit/` if a lease/notes file says this session or developer is mid-work on an issue (`.workkit/` is per-developer session state, not shared truth).

Omit empty sections. No jargon without a plain-words gloss. Note `agent:ok` where it exists — that item can be worked autonomously.

## HQ mode ("across all projects" / cwd is the HQ repo)

1. Read HQ `projects.json` → for each `active` project, query its issues (`gh issue list --repo <owner/name> ...`).
2. Per project, ONE line: `<name> — <in-flight item or "idle">; blocked: <count or none>; queued: <count>`.
3. Then hq's own issues, same shape as repo mode.
4. Flag unreachable repos (`(no remote)` / `(path missing)`) instead of skipping silently.

## Rules

- Generated on demand, never stored — no digest files.
- Plain sentences over tables; this is the "explain simpler" surface.
- Offline or no `gh`: say so plainly, then report from `.workkit/` alone — never guess at the queue.
- If nothing is in flight and nothing is blocked, say what is top of the queue and that it needs a go-ahead.
