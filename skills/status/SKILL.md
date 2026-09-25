---
name: status
description: Plain-language brief on the open issues, here or across every project (what each does in the product, the QA walkthrough, the queue in batches). - Use when the user asks "what's next", "where are we", "status", "what's left", "what am I waiting on", "what do I check", "qa walkthrough", "brief me".
disallowed-tools: AskUserQuestion
---

# Status: tell, don't do

**Read-only.** A plain-language answer about the open issues, never an action on them.

## Modes

- **Bare** (the default, and every plain-English ask: "what's next", "where are we", "brief me"): the full digest.
- **`qa`** ("what do I check", "qa walkthrough"): the **Waiting on your check** walkthrough alone, commands included.
- **`build`**: **Up next** plus **The recommendation** alone: the batched queue and the pick. Reached by the `build` argument or the manager's judgment; it has no auto-trigger phrase of its own.
- A mode reply carries only the sections it names. The tally opens the full digest alone. Every rule below holds in all three.

## Repo mode (default: a project repo is the cwd)

One query does it: `gh issue list --state open --json number,title,labels,assignees,blockedBy --limit 1000`. Answer in plain language, in this shape:

0. **The tally**: the digest OPENS with one count line. It gives total open issues, then the count per `status:` and per `type:` label (e.g. "12 open, status: 1 complete, 2 qa, 3 blocked, 4 specced, 2 backlog · type: 5 bugs, 6 enhancements, 1 idea").
1. **Ready to ship**: `status:complete` issues: checked, passed, waiting on nothing but the word "ship". One bullet each, then one closing line saying they all go in the next ship. They lead because they are the shortest path to an empty tree.
2. **Waiting on your check**: `status:qa` issues. They are built, verified, and parked in the working tree until your check passes them to `status:complete`.
   - Report a WALKTHROUGH, not a list, and carry EVERY qa item. The check is yours in whatever form it takes, so none is filtered out.
   - OPEN with the literal command(s) in code spans (`npm run tower`, `npm start`, a URL), taken from each issue's check comment.
   - Walk in the order that costs the fewest app switches. Issues sharing one surface go together under the one boot command covering them. Items no boot covers come last.
   - Each item names HOW to check it, one of:
     - SEE it: the screen or flow to open, and what to look for.
     - READ the evidence: the diff or the verification comment, named.
     - RUN it: the literal command in a code span.
   - This section asks the most of you. The tree holds their work, and nothing else finishes until they are checked.
3. **Waiting on you**: `status:blocked` issues. Name the actual question for each.
4. **In flight**: `status:building` issues. Say who and what.
5. **Up next**: `status:specced` issues, grouped into themed BATCHES of roughly 3–8 so the owner can authorize a batch at once.
   - Group by dependency chains first, then by a shared seam or surface, then by the otherwise-alike. Each batch carries one line of why-together. An item that groups with nothing stands alone.
   - Order the batches, and the items inside each, by priority: `priority:high`, then unlabeled (= normal), then `priority:low`.
   - Within one priority, order by dependency, risk, and reviewability. Blockers first, then bugs, then shared seams, then dependent feature work.
   - A shared seam is the file or module several queued items all touch.
   - A blocker is work other issues wait on: the native relationship where it exists (the `blockedBy` field above). Fallback signals: a parent's open siblings, an inline `Depends on:` line, anything another issue names in prose.
   - An edge onto a CLOSED issue is satisfied and orders nothing.
   - The top batch's why-together line says WHY it is top ("first because #12 unblocks the other two").
   - This is the order the autonomy loop uses; the rule's home is `docs/project-state.md` § Queue semantics.
6. **Inbox**: the `status:inbox` count, then offer the `workkit:triage` skill.
7. **The recommendation**: the digest ENDS with ONE explicit recommendation.
   - It is the FIRST batch from section 5, or the single next item when nothing groups ("Start with #12, the auth bug, because #14 and #15 wait on it.").
   - Never cram a batch into one sentence. Each of its issues gets its own bullet with its outcome brief. The why-together is its own closing line ("Why together: all three touch the auth flow, and #12 unblocks the other two.").
   - One recommendation either way, never a second ranked list.

- A qa item's check command and a blocked item's question both live in its comments: `gh issue view <N> --comments`.
- Omit empty sections. No jargon without a plain-words gloss.
- Note `agent:ok` where it exists: that item can be worked autonomously.
- Mention `.workkit/` if a lease or notes file says this session or developer is mid-work on an issue. `.workkit/` is per-developer session state, not shared truth.

## Global mode ("across all projects" / cwd is the home repo)

1. Read the roster: the `repos` map in `~/.workkit/.repos.json`, every entry whose value is not `"declined"`. It is this machine's index; a repo it has never opened is not on it.
   - Its keys are absolute PATHS, not slugs. Resolve each to `owner/name` through its git remote (`git -C <path> remote get-url origin`) before any `gh issue list --repo <owner/name> ...`.
   - A machine missing these files: say so and answer from the cwd repo alone.
2. Per project, ONE line: `<name>: <in-flight item or "idle">; ready to ship: <count or none>; waiting on your check: <count or none>; blocked: <count or none>; specced: <count>`.
3. Then the home repo's own issues (`site.repo` in `~/.workkit/settings.json`), same shape as repo mode. That is where the cross-project and business queue lives. No `site.repo` set: say so.
4. Flag unreachable repos (`(no remote)` / `(path missing)`) instead of skipping them.

## Rules

- Never start work, begin the top item, edit an issue, or write a file. No digest files: the answer is generated on demand, never stored. `qa` mode never closes an issue: the owner confirms a check in chat and the manager acts on it there.
- **The reply IS the deliverable.** End with the last section the mode carries, then STOP. In the full digest and `build`, that is the recommendation.
- Never the AskUserQuestion tool (the frontmatter removes it). The owner picks in chat, and the manager acts on that word.
- Every issue is RESTATED wherever it appears, as an OUTCOME brief in the cold-reader line. Its shape, cap and example pair have one home, `docs/project-state.md` § Restating an issue; this skill carries none of its own.
- Plain sentences over tables; this is the "explain simpler" surface.
- Offline or no `gh`: say so plainly, then report from `.workkit/` alone. Never guess at the queue.
- Nothing in flight and nothing blocked: say what is top of the queue and that it needs a go-ahead.
