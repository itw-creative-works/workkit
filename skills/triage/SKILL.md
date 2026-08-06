---
name: triage
description: Route every captured entry to its one home, then print the Filed trail; the merge mode sweeps the board and proposes merges. - Use when the user says "triage", "file my notes", "empty the inbox", asks to merge or dedupe the board, or when the state-check hook reports inbox items.
argument-hint: "[merge]"
---

# Triage — drain the inbox, visibly

Work items live as **GitHub issues**. Triage is the ACTION that drains `status:inbox`; it is not a state.

Label vocabulary (SSOT: `~/.claude/workkit/labels.json`, and every repo's own `gh label list`):
`status:inbox|specced|building|blocked|parked` (exactly ONE per open issue — the PIPELINE, mapped in the workkit plugin's README) · `type:bug|enhancement|idea` · `priority:high|low` (absence = normal) · `agent:ok` (an agent may work it autonomously at every stage — spec, accept, build, ship).

## Marker (opens the inbox)

Before reading anything, record that triage is running — the `safety/inbox-guard` hook checks this marker before allowing a read of `.workkit/inbox.md` OR the rewrite that clears the drained entries, which is the only write this file ever takes from an agent (adding to it is the owner's alone). It is the owner's capture surface at every other moment. The marker is keyed to the repo root the inbox belongs to:

```sh
mkdir -p "${TMPDIR:-/tmp}/claude-triage-marker" && touch "${TMPDIR:-/tmp}/claude-triage-marker/$({ git rev-parse --show-toplevel 2>/dev/null || echo "$HOME"; } | tr -d '\n' | shasum | cut -d' ' -f1)"
```

## Sources to drain

1. **Open `status:inbox` issues** on the cwd repo — `gh issue list --state open --label status:inbox --json number,title,body,labels`.
2. **`.workkit/inbox.md`** — the local, gitignored capture file (offline moments, free-form dumps).
3. **Mid-chat note dumps** — same routing, no file needed first.
4. **The HQ pass** (#100) — the home repo's own open `status:inbox` issues (`gh issue list --repo <site.repo> --state open --label status:inbox ...`, the `site.repo` in `~/.workkit/settings.json`), routed with the same table below, from any repo. This is how the nursery drains, since no session ever opens in the clone. When captures cluster around one project, propose graduation (§ Graduation). No `site.repo`, or HQ unreachable: name the skip in the Filed trail — never silent.

A capture made outside every participating repo is already a `status:inbox` issue on the home repo — `wk.sh note` files it there directly, so the HQ pass is where it gets drained.

Split every source into discrete entries. A wall of mixed notes fans out to MANY destinations — never route a mixed dump as one blob.

## Route each entry to exactly ONE home

Before creating anything, **search what already exists** — open AND closed:
`gh issue list --state all --search "<key words>"`.

Then, before creating anything, apply the **filing litmus test**: *would closing an OPEN issue automatically mean this entry is done too?* Yes → it goes on THAT issue, as a checklist line in its Spec or as a comment. Only a no earns a new issue (spec § How big is one issue).

| Entry is... | Route |
|---|---|
| Already covered by an existing issue | `gh issue comment <N>` on that issue — never a duplicate |
| Already rejected (a closed **not planned** issue) | Cite the rejection in the Filed trail; do NOT re-file |
| Actionable, spec written and accepted (or a small item — Spec is `None needed — small item.`) | Relabel to `status:specced` (+ `type:`, + `priority:` if clearly high/low). The flip AUTHORIZES the build — only make it when the spec is genuinely accepted |
| Actionable, but it still needs design or detail | Leave it `status:inbox` and draft what you have into the `## Spec` (or a comment) — then QUEUE the interview and say so; a spec drafted whole is never presented for a bare yes (spec § Specs, the collaborative rule). Accepting that spec later is what earns `status:specced` |
| A polish nit, docs nit, or cosmetic finding | A checklist line in the `## Spec` of the surface's open `polish: <surface>` issue — open one (`status:inbox` + `type:enhancement`) when none is open. Mechanics, including the freeze rule and "bugs never batch": spec § How big is one issue |
| Waiting on the owner's decision | `status:blocked` + a comment naming the question |
| Worth keeping, deliberately not now | `status:parked` |
| Cross-project / business / no single repo | An issue on the **home repo** — the `site.repo` named in `~/.workkit/settings.json` (`docs/project-state.md` § The global layer). No `site.repo` set: leave the entry in the inbox and say so |
| Belongs to a DIFFERENT project | An issue on that repo (`gh issue create --repo <owner/name>`) |
| An idea for a project that has no repo yet | A `type:idea` issue on the **home repo**, later notes as comments on it. Never create a repo or a folder here — graduation is the owner's word, proposed and executed per § Graduation |
| A durable fact about how things work | The right `docs/*.md` (or AGENTS.md if doctrinal) — then close the issue pointing at it |
| Needs the owner's yes/no before it is even accepted | Draft the proposal into the `## Spec`; label `status:blocked` with the question |

Relabel with one command so the status stays single:
`gh issue edit <N> --remove-label status:inbox --add-label status:specced,type:enhancement`

**Dump issues** (a wall of mixed notes in one issue): fan out to N new issues and comments, then close the dump with the Filed trail as its closing comment.

**Every issue body you create or route follows the anatomy** (spec § Issue anatomy): `## Description` then `## Spec`, both always present; a small item's Spec is the literal `None needed — small item.` The same section carries the introduction rule — the first mention of an outside project or repo, in a body or a comment, gets a link and a one-line description of what it is.

**The home repo is optional.** With no `site.repo` key, or when a `gh` call against it fails: an entry being routed TO the home repo stays in `.workkit/inbox.md` with the skip named in the Filed trail — never dropped, never given an invented destination — and the HQ pass itself names its skip the same way (its entries already live on HQ; there is nowhere to hold them locally).

## Draining `.workkit/inbox.md`

Each entry becomes an issue (`gh issue create --label status:inbox,type:<kind>` then route it, or file it routed directly). Delete only the entries that actually landed somewhere; keep the file header. Offline: leave the file untouched and say the queue could not be reached.

## Graduation (the HQ pass's proposal — #100)

The system proposes, the owner creates; no automation ever makes a repo or moves an issue on its own. When HQ captures cluster around one project (several issues or comments naming the same not-yet-project), propose graduation in chat and wait for the owner's word.

- **To an existing repo**: `gh issue transfer <n> <owner>/<repo>` where GitHub allows it (same owner or org); otherwise recreate the issue on the target with pointers both ways. Either way the HQ issue ends closed with a comment naming where it went.
- **To a project with no repo**: the proposal names three things and asks them in chat — the repo name, the OWNER (the personal account or an org the owner belongs to, never assumed), and the visibility (private default). On the yes: `gh repo create <owner>/<name>`, clone beside the machine's other checkouts (the roster in `~/.workkit/.repos.json` records every enabled repo's absolute path — read it to learn this machine's layout), then ask the participation question (`workkit enable`) rather than assuming the opt-in. Then transfer the issues as above.
- No standing "ripe for graduation" surface exists anywhere — this proposal is the mechanism, and the tower Board already shows HQ's issues.

## Always end with the Filed trail

```
Filed:
- "<entry summary>" → <#N + what changed, or the repo/path it went to>
- ...
```

## Merge mode (`/workkit:triage merge`)

A separate mode: instead of draining the inbox, sweep the OPEN board and apply the same litmus test across the issues that already exist.

1. List the open issues (`gh issue list --state open --json number,title,labels,body`) and read them.
2. Group by the test — *would closing one of these automatically mean the other is done too?*
3. Present a merge PLAN and stop: **merge these** (which survives, which closes, what moves), **attach that** (an issue that becomes a checklist line or a comment on another), **keep these separate** — with one line of why for every group, including the separations.
4. Execute ONLY on the owner's approval, group by group. Content moves to the survivor BEFORE the close; a closed-as-merged issue gets a closing comment naming the survivor (`gh issue comment <N> --body "Merged into #<survivor>."` then `gh issue close <N>`). End with the Filed trail.

This mode never runs unattended and never merges on its own judgment — a wrong merge buries a real bug.

## Rules

- One home per entry (SSOT). If two homes seem right, pick the lowest-owning layer and point from the other.
- An open `polish: <surface>` issue is a DESTINATION, never a capture to drain: it stays `status:inbox` while it collects, the drain never re-routes it, and the state-check announcing it is expected (spec § How big is one issue).
- Exactly one `status:` label per open issue — removing the old one is part of every relabel.
- Idempotent: re-running with nothing captured does nothing and says so.
- Never invent priority. `priority:` is the owner's call unless the entry states urgency; absence = normal.
- Ambiguous entries: file your best call and flag it in the Filed trail with `(check placement)` — do NOT stop to ask per-entry.
- Never `agent:ok` on the owner's behalf — that permission is theirs to grant.
