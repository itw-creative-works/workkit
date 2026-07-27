---
name: triage
description: Route every captured entry to its one correct home — relabel or comment on GitHub issues, hand cross-project items to HQ — then print the Filed trail. - Use when the user says "triage", "file my notes", "empty the inbox", "process the inbox", "route the inbox", dumps a batch of notes and asks to file them, or when the state-check hook reports open status:inbox issues or a non-empty .workkit/inbox.md.
---

# Triage — drain the inbox, visibly

Work items live as **GitHub issues**. Triage is the ACTION that drains `status:inbox`; it is not a state.

Label vocabulary (SSOT: `~/.claude/workkit/labels.json`, and every repo's own `gh label list`):
`status:inbox|spec|queued|blocked|parked` (exactly ONE per open issue — the PIPELINE, mapped in the workkit plugin's `docs/pipeline.md`) · `type:bug|enhancement|idea` · `priority:high|low` (absence = normal) · `agent:ok` (an agent may work it autonomously; pulls only from `status:queued`).

## Sources to drain

1. **Open `status:inbox` issues** on the cwd repo — `gh issue list --state open --label status:inbox --json number,title,body,labels`.
2. **`.workkit/inbox.md`** — the local, gitignored capture file (offline moments, free-form dumps).
3. **Mid-chat note dumps** — same routing, no file needed first.

Split every source into discrete entries. A wall of mixed notes fans out to MANY destinations — never route a mixed dump as one blob.

## Route each entry to exactly ONE home

Before creating anything, **search what already exists** — open AND closed:
`gh issue list --state all --search "<key words>"`.

| Entry is... | Route |
|---|---|
| Already covered by an existing issue | `gh issue comment <N>` on that issue — never a duplicate |
| Already rejected (a closed **not planned** issue) | Cite the rejection in the Filed trail; do NOT re-file |
| Actionable, plan ready (or a small item — Plan is `None needed — small item.`) | Relabel to `status:queued` (+ `type:`, + `priority:` if clearly high/low) |
| Actionable, but the plan needs design or detail first | Relabel to `status:spec` — the planning pass (deepen the `## Plan`, the human ratifies) is what earns `status:queued` |
| Waiting on the owner's decision | `status:blocked` + a comment naming the question |
| Worth keeping, deliberately not now | `status:parked` |
| Cross-project / business / no single repo | An issue on the **HQ** repo (the global layer per `docs/project-state.md` § HQ — its `projects.json` is the registry) |
| Belongs to a DIFFERENT project | An issue on that repo (`gh issue create --repo <owner/name>`) |
| A durable fact about how things work | The right `docs/*.md` (or AGENTS.md if doctrinal) — then close the issue pointing at it |
| Needs the owner's yes/no before it is even accepted | Draft the proposal into the `## Plan`; label `status:blocked` with the question |

Relabel with one command so the status stays single:
`gh issue edit <N> --remove-label status:inbox --add-label status:queued,type:enhancement`

**Dump issues** (a wall of mixed notes in one issue): fan out to N new issues and comments, then close the dump with the Filed trail as its closing comment.

**Every issue body you create or route follows the anatomy** (spec § Issue anatomy): `## Description` then `## Plan`, both always present; a small item's Plan is the literal `None needed — small item.`

**hq may have no remote yet.** If any `gh` call against hq fails, leave that entry in `.workkit/inbox.md` and say so in the Filed trail — never drop it.

## Draining `.workkit/inbox.md`

Each entry becomes an issue (`gh issue create --label status:inbox,type:<kind>` then route it, or file it routed directly). Delete only the entries that actually landed somewhere; keep the file header. Offline: leave the file untouched and say the queue could not be reached.

## Always end with the Filed trail

```
Filed:
- "<entry summary>" → <#N + what changed, or the repo/path it went to>
- ...
```

## Rules

- One home per entry (SSOT). If two homes seem right, pick the lowest-owning layer and point from the other.
- Exactly one `status:` label per open issue — removing the old one is part of every relabel.
- Idempotent: re-running with nothing captured does nothing and says so.
- Never invent priority. `priority:` is the owner's call unless the entry states urgency; absence = normal.
- Ambiguous entries: file your best call and flag it in the Filed trail with `(check placement)` — do NOT stop to ask per-entry.
- Never `agent:ok` on the owner's behalf — that permission is theirs to grant.
