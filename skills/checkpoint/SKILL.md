---
name: checkpoint
description: Harden the conversation into issues before a compaction — every finding, decision and open question filed to its one home, session.md trimmed to what is in flight. - Use when the user says "checkpoint", "before I compact", "harden this chat", "save the conversation".
user-invocable: true
---

# Checkpoint — harden the chat before it is compacted

A long design chat holds findings that exist NOWHERE ELSE. Compaction throws them away. This skill turns the conversation into durable state first, so that "go", "continue" or "resume" afterwards starts from the issues.

**Invoking it is the owner's word to file**, for this run only. It drains the CONVERSATION, never the capture file — that stays `workkit:triage`'s (spec § Capture).

## 1. Read the conversation

Read the whole chat back, not just the last exchange. Pull out every finding, decision, ruling and open question, and split them into DISCRETE entries — one entry per thing that has its own home. A single long exchange usually fans out to several destinations; never file it as one blob.

## 2. Route each entry to exactly one home

Before creating anything, search what already exists, open AND closed: `gh issue list --state all --search "<key words>"`. Then apply the routing table in the `workkit:triage` skill — it is the SSOT for where an entry goes, including the filing litmus test (*would closing an open issue mean this entry is done too?*) and the issue anatomy every body follows (spec § Issue anatomy). An open question the owner has not answered is `status:blocked` plus a comment naming the question in the owner's own terms.

## 3. Update `.workkit/agents/session.md`

One bullet per item now in flight or queued, each pointing at its issue; DELETE the bullets the issues now hold. The file is a queue, not a journal — the 40-line bar and the 350-character bullet cap hold here as everywhere (spec § Capture, `docs:session-guard`).

## 4. End with the Filed trail

```
Filed:
- "<entry summary>" → <#N + what changed>
- ...

Safe to compact.
```

The trail is the deliverable — the last line says the conversation is now safe to lose.

## Rules

- Every rule under `workkit:triage` § Rules binds here: one home per entry, one `status:` label, never invent priority, never `agent:ok` on the owner's behalf, `(check placement)` for the ambiguous ones.
- Idempotent: a run with nothing new to file says so and writes nothing.
- No capture-file drain here. An entry belonging to another repo or to the home repo routes the same way triage routes it.
