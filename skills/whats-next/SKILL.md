---
name: whats-next
description: Plain-language status digest of the repo's open issues, or across every project via the roster — a one-to-two sentence brief per item, tells and never does. - Use when the user asks "what's next", "where are we", "status", "what's left", "what am I waiting on".
disallowed-tools: AskUserQuestion
---

# What's Next — tell, don't do

**READ-ONLY.** This skill answers; it never starts work, edits an issue, or "helpfully" begins the top item. After answering, stop.

## Repo mode (default — a project repo is the cwd)

One query does it: `gh issue list --state open --json number,title,labels,assignees,blockedBy --limit 100`.
Answer in this shape, plain language, one to two sentences per item:

0. **The tally** — the digest OPENS with one count line: total open issues, then the count per `status:` label and per `type:` label (e.g. "12 open — status: 2 qa, 3 blocked, 4 specced, 3 backlog · type: 5 bugs, 6 enhancements, 1 idea").

1. **Waiting on your check** — `status:qa` issues: built, verified, and parked in the working tree until you say "ship". Name what each one wants checked (it is in a comment: `gh issue view <N> --comments`). These lead because the tree holds their work, so nothing else finishes until they do.
2. **Waiting on you** — `status:blocked` issues. Name the actual question for each (it is in a comment: `gh issue view <N> --comments`).
3. **In flight** — `status:building` issues. Say who and what.
4. **Up next** — `status:specced` issues, in priority order: `priority:high` first, then unlabeled (= normal), then `priority:low`. First 3–5.
   Within one priority, order by dependency, risk, and reviewability: blockers first (work other issues wait on — the native relationship where it exists, which the `blockedBy` field above carries, with a parent's open siblings, an inline `Depends on:` line and anything another issue names in prose as the fallback signal; an edge onto a CLOSED issue is satisfied and orders nothing), then bugs, then shared seams (the file or module several queued items all touch), and only then dependent feature work. Say WHY the top item is top in the same sentence ("first because #12 waits on it"). This is the order the autonomy loop uses; the rule's home is `docs/project-state.md` § Queue semantics.
5. **Inbox** — the `status:inbox` count → offer the `workkit:triage` skill.
6. **The recommendation** — the digest ENDS with one explicit recommendation: the single next item, OR a logical grouping worked as one batch — dependent issues, issues sharing a seam, or otherwise alike — with the why in the same sentence ("Start with #12, the auth bug, because #14 and #15 wait on it." / "Work #12, #14, #15 together — all three touch the auth flow."). One recommendation either way, never a second ranked list. Then stop.

Also mention `.workkit/` if a lease/notes file says this session or developer is mid-work on an issue (`.workkit/` is per-developer session state, not shared truth).

Omit empty sections. No jargon without a plain-words gloss. Note `agent:ok` where it exists — that item can be worked autonomously.

## Global mode ("across all projects" / cwd is the home repo)

1. Read the roster — the `repos` map in `~/.workkit/.repos.json`, every entry whose value is not `"declined"`. Its keys are absolute PATHS, not slugs: resolve each to `owner/name` through its git remote (`git -C <path> remote get-url origin`) before any `gh issue list --repo <owner/name> ...`. (The full state-reading recipe, including the published fallback, is the `workkit:state` skill's.) It is this machine's index; a repo it has never opened is not on it.
2. Per project, ONE line: `<name> — <in-flight item or "idle">; waiting on your check: <count or none>; blocked: <count or none>; specced: <count>`.
3. Then the home repo's own issues (`site.repo` in `~/.workkit/settings.json`), same shape as repo mode — that is where the cross-project and business queue lives. No `site.repo` set: say so.
4. Flag unreachable repos (`(no remote)` / `(path missing)`) instead of skipping silently.

## Rules

- Generated on demand, never stored — no digest files.
- Plain sentences over tables; this is the "explain simpler" surface.
- Every issue is RESTATED wherever it appears: number + a one-to-two sentence plain-words brief of what it is (two is the hard cap). A bare "#10" is never an answer — a FIRST-TIME reader should know what the issue is about without opening it.
- The reply IS the deliverable: end with the ranked suggested queue and STOP — never the AskUserQuestion tool (the frontmatter removes it). The owner picks in chat.
- Offline or no `gh`: say so plainly, then report from `.workkit/` alone — never guess at the queue.
- If nothing is in flight and nothing is blocked, say what is top of the queue and that it needs a go-ahead.
