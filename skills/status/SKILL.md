---
name: status
description: Plain-language brief on the open issues, here or across every project — what each does in the product, the QA walkthrough, the queue in batches. - Use when the user asks "what's next", "where are we", "status", "what's left", "what am I waiting on", "what do I check", "qa walkthrough", "brief me".
disallowed-tools: AskUserQuestion
---

# Status — tell, don't do

**READ-ONLY.** This skill answers; it never starts work, edits an issue, or "helpfully" begins the top item — and `qa` mode never closes one: the owner confirms a check in chat and the manager acts on it there. After answering, stop.

## Modes

- **Bare** (the default, and every plain-English ask — "what's next", "where are we", "brief me") — the full digest.
- **`qa`** ("what do I check", "qa walkthrough") — the **Waiting on your check** walkthrough alone, commands included.
- **`build`** — **Up next** plus **The recommendation** alone: the batched queue and the pick. Reached by the `build` argument or the manager's judgment; it has no auto-trigger phrase of its own.

A mode reply carries only the sections it names — the tally opens the full digest alone. Every rule below holds in all three.

## Repo mode (default — a project repo is the cwd)

One query does it: `gh issue list --state open --json number,title,labels,assignees,blockedBy --limit 100`.
Answer in this shape, plain language, one to two sentences per item:

0. **The tally** — the digest OPENS with one count line: total open issues, then the count per `status:` label and per `type:` label (e.g. "12 open — status: 2 qa, 3 blocked, 4 specced, 3 backlog · type: 5 bugs, 6 enhancements, 1 idea").

1. **Waiting on your check** — `status:qa` issues: built, verified, and parked in the working tree until you say "ship". Report them as a WALKTHROUGH, not a list. The section OPENS with the literal command(s) in code spans (`npm run tower`, `npm start`, a URL — they come from each issue's check comment: `gh issue view <N> --comments`), then walks the items in the order that costs the fewest app switches: issues sharing one surface go together under the one boot command that covers the group. Each item is its link plus one sentence of what to look at and where. Only what a human has to SEE belongs here — flows and visual checks (checkout, dialogs, badges, dashboards); anything a file read or a command run proves is the agent's own verification and never the owner's list. These lead because the tree holds their work, so nothing else finishes until they do.
2. **Waiting on you** — `status:blocked` issues. Name the actual question for each (it is in a comment: `gh issue view <N> --comments`).
3. **In flight** — `status:building` issues. Say who and what.
4. **Up next** — `status:specced` issues, grouped into themed BATCHES of roughly 3–8 so the owner can authorize a batch at once. Group by dependency chains first, then by a shared seam or surface, then by the otherwise-alike; each batch carries one line of why-together, and an item that groups with nothing stands alone.
   Order the batches, and the items inside each: `priority:high` first, then unlabeled (= normal), then `priority:low`; within one priority, by dependency, risk, and reviewability — blockers first (work other issues wait on — the native relationship where it exists, which the `blockedBy` field above carries, with a parent's open siblings, an inline `Depends on:` line and anything another issue names in prose as the fallback signal; an edge onto a CLOSED issue is satisfied and orders nothing), then bugs, then shared seams (the file or module several queued items all touch), and only then dependent feature work. Say WHY the top batch is top in its why-together line ("first because #12 unblocks the other two"). This is the order the autonomy loop uses; the rule's home is `docs/project-state.md` § Queue semantics.
5. **Inbox** — the `status:inbox` count → offer the `workkit:triage` skill.
6. **The recommendation** — the digest ENDS with one explicit recommendation: the FIRST BATCH from section 4, or the single next item when nothing groups ("Start with #12, the auth bug, because #14 and #15 wait on it."). A batch is NEVER crammed into one sentence (owner, 2026-08-17): each of its issues gets its own bullet carrying its outcome brief, and the why-together is its own closing line ("Why together: all three touch the auth flow, and #12 unblocks the other two."). One recommendation either way, never a second ranked list. Then stop.

Also mention `.workkit/` if a lease/notes file says this session or developer is mid-work on an issue (`.workkit/` is per-developer session state, not shared truth).

Omit empty sections. No jargon without a plain-words gloss. Note `agent:ok` where it exists — that item can be worked autonomously.

## Global mode ("across all projects" / cwd is the home repo)

1. Read the roster — the `repos` map in `~/.workkit/.repos.json`, every entry whose value is not `"declined"`. Its keys are absolute PATHS, not slugs: resolve each to `owner/name` through its git remote (`git -C <path> remote get-url origin`) before any `gh issue list --repo <owner/name> ...`. (A machine missing these files: say so and answer from the cwd repo alone; the retired published-data recipe lives in git history — the state skill, removed in #163.) It is this machine's index; a repo it has never opened is not on it.
2. Per project, ONE line: `<name> — <in-flight item or "idle">; waiting on your check: <count or none>; blocked: <count or none>; specced: <count>`.
3. Then the home repo's own issues (`site.repo` in `~/.workkit/settings.json`), same shape as repo mode — that is where the cross-project and business queue lives. No `site.repo` set: say so.
4. Flag unreachable repos (`(no remote)` / `(path missing)`) instead of skipping silently.

## Rules

- Generated on demand, never stored — no digest files.
- Plain sentences over tables; this is the "explain simpler" surface.
- Every issue is RESTATED wherever it appears, as an OUTCOME brief: number + one to two sentences (two is the hard cap) saying what it concretely does or fixes IN THE PRODUCT, plus where to check it or what it affects. Codenames and pipeline words are never the substance — the section heading already carries the state, the sentence carries the meaning. A bare "#10" is never an answer — a FIRST-TIME reader should know what the issue is about without opening it.
  - Right: "#158 — `npm run tower` used to dump omega's whole startup wall or hide everything; now it prints a starting line, hides the boot chatter, and shows the web server's live request logs. Check by running it."
  - Wrong: "#158 (the tower filter work) is parked at status:qa waiting on your check — nothing ships until then."
- The reply IS the deliverable: end with the last section the mode carries (the recommendation, in the full digest and `build`) and STOP — never the AskUserQuestion tool (the frontmatter removes it). The owner picks in chat, and the manager acts on that word; this skill never edits an issue or writes a file.
- Offline or no `gh`: say so plainly, then report from `.workkit/` alone — never guess at the queue.
- If nothing is in flight and nothing is blocked, say what is top of the queue and that it needs a go-ahead.
