---
name: checkpoint
description: Apply the chat to the board before a compaction — every owner verdict, decision and question filed, commented or status-flipped onto its issue, session.md trimmed to what is in flight. - Use when the user says "checkpoint", "before I compact", "harden this chat", "save the conversation".
user-invocable: true
---

# Checkpoint — apply the chat to the board before it is compacted

A long chat holds verdicts and findings that exist NOWHERE ELSE. Compaction throws them away. This skill WRITES the conversation onto the board first: it files what is new, updates what exists, and moves every issue the owner's words moved. Afterwards "go", "continue" or "resume" starts from the issues, not the scrollback.

**Invoking it is the owner's word to file AND to apply every status change they spoke**, for this run only. It drains the CONVERSATION, never the capture file — that stays `workkit:triage`'s (spec § Capture).

## 1. Enumerate FIRST — before touching anything

Read the whole chat back, not just the last exchange. Write out ONE line per owner comment, concern, ruling, verdict, decision, and question, plus every finding the agent made that has no home yet. Quote the owner's words on each line. A single exchange usually fans out to several lines; never one blob.

The list is built from the chat, never from memory of what was filed. "Already on #652" is not a line; if it is on #652, the line names #652 and the run confirms it with `gh issue view`.

The list is a WORKING document, never chat output (owner ruling, 2026-08-27): keep it in reasoning or a scratch file, act on it, and print only the trail in §5. The owner sees what changed, not the checklist.

## 2. Route each line to exactly one home

Search first, open AND closed: `gh issue list --state all --search "<key words>" --limit 1000`. Then:

- **An issue exists** → update it: a dated comment quoting the owner's words, a spec line, a label.
- **No issue exists** → file one, following the `workkit:triage` routing table (the SSOT for destination, the filing litmus test, and the issue anatomy — spec § Issue anatomy).
- **An unanswered owner question** → `status:blocked` with the question in the owner's own words. A question the agent answered in chat is not blocked; the answer goes on the issue.

## 3. Apply the status the owner spoke

Status changes ARE checkpoint work (owner ruling, 2026-08-27). Every owner word that moves an issue's stage is applied, with the words quoted on the issue, dated:

| The owner said | The flip |
|---|---|
| "X is done", "X looks good", "X works" about a `status:qa` item | `status:qa` → `status:complete` — this IS the owner's grant (spec § the qa stage) |
| A decision that settles a `status:blocked` question | `status:blocked` → `status:specced` |
| Accepts a spec, or dictates one, for an inbox item | `status:inbox` → `status:specced` |
| "Park that", "not now" | → `status:backlog` |
| Asks a question no one answered | → `status:blocked` |

One `status:` label per issue: remove the old one in the same command (`gh issue edit <N> --remove-label status:qa --add-label status:complete`). Never `agent:ok`, and never a flip the owner did not speak — a verdict is applied, never inferred.

## 4. Update `.workkit/agents/session.md`

One bullet per item now in flight or queued, each pointing at its issue; DELETE the bullets the issues now hold. The file is a queue, not a journal — the 40-line bar and the 350-character bullet cap hold (spec § Capture, `docs:session-guard`).

## 5. End with the Filed trail — what this run CHANGED

The trail is a report of actions, not an audit log. ONE line per issue this run touched, the issue number as a markdown link, listing everything done to it in plain words (comments, filings, flips). Never one line per action, never a raw URL. Items verified as already on the board get ONE closing count line, never a line each.

```
Filed:
- [#209](url): commented your "watch it a few days" ruling.
- [#637](url): quoted "637 looks good", flipped to status:complete.
- [#211](url): filed — findings from other repos' sessions land on the home repo.
- Verified 6 earlier items already on their issues.

**✅ Safe to compact or continue in a new session.**
```

The trail is the whole reply: nothing printed before it but the timestamp. `**✅ Safe to compact or continue in a new session.**` prints ONLY when every enumerated item is on the board; otherwise the last line names what is still unfiled.

## Rules

- Every rule under `workkit:triage` § Rules binds here: one home per entry, one `status:` label, never invent priority, never `agent:ok` on the owner's behalf, `(check placement)` for the ambiguous ones.
- Idempotent: a run with nothing new says so and writes nothing.
- No capture-file drain here. An entry belonging to another repo or to the home repo routes the same way triage routes it.
