---
name: triage
description: Route each entry to one home, then print the Filed trail. - Use on "triage", "file my notes", "empty the inbox" (the bare word drains everything), numbers with a triage word ("215 211 triage", "accept 215") for those only, a merge or dedupe ask, or when state-check reports inbox items.
argument-hint: "[merge | <issue numbers>]"
---

# Triage: drain the inbox, visibly

Work items live as **GitHub issues**. Triage is the ACTION that drains `status:inbox`; it is not a state.

Label vocabulary (SSOT: `~/.claude/workkit/labels.json`, and every repo's own `gh label list`):
`status:inbox|specced|building|qa|complete|blocked|backlog` (exactly ONE per open issue: the PIPELINE, mapped in the workkit plugin's README) · `type:bug|enhancement|idea` · `priority:high|low` (absence = normal) · `agent:ok` (an agent may work it autonomously at every stage: spec, accept, build, the `status:qa` check that grants `status:complete`, ship).

## Marker (opens the capture file)

In the FULL drain only (a scoped run never reads the capture file and sets no marker, § Scoped mode), before reading anything, record that triage is running. The `safety/capture-guard` hook checks this marker before allowing a read of `.workkit/capture.md` OR the rewrite that clears the drained entries, which is the only write this file ever takes from an agent (adding to it is the owner's alone). It is the owner's capture surface at every other moment. The marker is keyed to the repo root the capture file belongs to:

```sh
mkdir -p "${TMPDIR:-/tmp}/claude-triage-marker" && touch "${TMPDIR:-/tmp}/claude-triage-marker/$({ git rev-parse --show-toplevel 2>/dev/null || echo "$HOME"; } | tr -d '\n' | shasum | cut -d' ' -f1)"
```

## Sources to drain (the FULL drain; § Scoped mode reads only the named issues)

1. **Open `status:inbox` issues** on the cwd repo: `gh issue list --state open --label status:inbox --json number,title,body,labels --limit 1000`.
2. **`.workkit/capture.md`**: the local, gitignored capture file (offline moments, free-form dumps).
3. **Mid-chat note dumps**: same routing, no file needed first.
4. **The HQ pass** (#100): the home repo's own open `status:inbox` issues (`gh issue list --repo <site.repo> --state open --label status:inbox ... --limit 1000`, the `site.repo` in `~/.workkit/settings.json`), routed with the same table below, from any repo. This is how the nursery drains, since no session ever opens in the clone. When captures cluster around one project, propose graduation (§ Graduation). No `site.repo`, or HQ unreachable: name the skip in the Filed trail, never silent.

A capture made outside every participating repo is already a `status:inbox` issue on the home repo. `wk.sh note` files it there directly, so the HQ pass is where it gets drained.

Split every source into discrete entries. A wall of mixed notes fans out to MANY destinations. Never route a mixed dump as one blob.

## Route each entry to exactly ONE home

Before creating anything, **search what already exists**, open AND closed:
`gh issue list --state all --search "<key words>" --limit 1000`.

Then, before creating anything, apply the **filing litmus test**: *would closing an OPEN issue automatically mean this entry is done too?* Yes → it goes on THAT issue, as a checklist line in its Spec or as a comment. Only a no earns a new issue (spec § How big is one issue).

| Entry is... | Route |
|---|---|
| Already covered by an existing issue | `gh issue comment <N>` on that issue, never a duplicate |
| Already rejected (a closed **not planned** issue) | Cite the rejection in the Filed trail; do NOT re-file |
| Actionable, spec written and accepted (or a small item: Spec is `None needed: small item.`) | Relabel to `status:specced` (+ `type:`, + `priority:` if clearly high/low). The flip AUTHORIZES the build. Only make it when the spec is genuinely accepted |
| Actionable, but it still needs design or detail | Leave it `status:inbox` and draft what you have into the `## Spec` (or a comment). Then QUEUE the interview and say so; a spec drafted whole is never presented for a bare yes (spec § Specs, the collaborative rule). Accepting that spec later is what earns `status:specced` |
| A polish nit, docs nit, or cosmetic finding | A checklist line in the `## Spec` of the surface's open `polish: <surface>` issue. Open one (`status:inbox` + `type:enhancement`) when none is open. Mechanics, including the freeze rule and "bugs never batch": spec § How big is one issue |
| Waiting on the owner's decision | `status:blocked` + a comment naming the question |
| Worth keeping, deliberately not now | `status:backlog` |
| Cross-project / business / no single repo, and no repo on this machine owns it | An issue on the **home repo**, the `site.repo` named in `~/.workkit/settings.json` (`docs/project-state.md` § The global layer). The rows below are resolved FIRST: this one is the last resort. No `site.repo` set: leave the entry in the capture file and say so |
| Names a workkit skill, hook, agent, or engine file | An issue on the KIT'S OWN repo, from any session, never the home repo: resolve the repo from the plugin's own checkout, a CHAIN not a default: `[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && git -C "${CLAUDE_PLUGIN_ROOT}" remote get-url origin || git -C ~/.claude/workkit remote get-url origin` (the variable is set only inside hook commands, and an empty `-C` would silently answer with the session's own repo, so the guard is what makes the second link run; a published install's plugin root is a cache folder with no git, and the second link takes over there too); the URL git prints is accepted by `gh issue create --repo` as is. Never a hardcoded slug. Unresolvable: the entry stays local with the skip named in the Filed trail |
| Belongs to a DIFFERENT project | An issue on that repo, with the project RESOLVED rather than guessed: find the project's checkout in this machine's roster (`~/.workkit/.repos.json`, each enabled repo's absolute path), read its slug with `git -C <path> remote get-url origin`, then `gh issue create --repo <owner/name>`. No roster match: the entry stays local with the skip named in the Filed trail, never the home repo |
| An idea for a project that has no repo yet | A `type:idea` issue on the **home repo**, later notes as comments on it. Never create a repo or a folder here. Graduation is the owner's word, proposed and executed per § Graduation |
| A durable fact about how things work | The right `docs/*.md` (or AGENTS.md if doctrinal). Then close the issue pointing at it |
| Needs the owner's yes/no before it is even accepted | Draft the proposal into the `## Spec`; label `status:blocked` with the question |

Relabel with one command so the status stays single:
`gh issue edit <N> --remove-label status:inbox --add-label status:specced,type:enhancement`

**Dump issues** (a wall of mixed notes in one issue): fan out to N new issues and comments, then close the dump with the Filed trail as its closing comment.

**Every issue body you create or route follows the anatomy** (spec § Issue anatomy): `## Description` then `## Spec`, both always present; a small item's Spec is the literal `None needed: small item.` The same section carries the introduction rule: the first mention of an outside project or repo, in a body or a comment, gets a link and a one-line description of what it is.

**The home repo is optional.** With no `site.repo` key, or when a `gh` call against it fails: an entry being routed TO the home repo stays in `.workkit/capture.md` with the skip named in the Filed trail (never dropped, never given an invented destination) and the HQ pass itself names its skip the same way (its entries already live on HQ; there is nowhere to hold them locally).

## Draining `.workkit/capture.md`

Each entry becomes an issue (`gh issue create --label status:inbox,type:<kind>` then route it, or file it routed directly). Delete only the entries that actually landed somewhere; keep the file header. Offline: leave the file untouched and say the queue could not be reached.

## Graduation (the HQ pass's proposal, #100)

The system proposes, the owner creates; no automation ever makes a repo or moves an issue on its own. When HQ captures cluster around one project (several issues or comments naming the same not-yet-project), propose graduation in chat and wait for the owner's word.

- **To an existing repo**: `gh issue transfer <n> <owner>/<repo>` where GitHub allows it (same owner or org); otherwise recreate the issue on the target with pointers both ways. Either way the HQ issue ends closed with a comment naming where it went.
- **To a project with no repo**: the proposal names three things and asks them in chat: the repo name, the OWNER (the personal account or an org the owner belongs to, never assumed), and the visibility (private default). On the yes: `gh repo create <owner>/<name>`, clone beside the machine's other checkouts (the roster in `~/.workkit/.repos.json` records every enabled repo's absolute path: read it to learn this machine's layout), then ask the participation question (`workkit enable`) rather than assuming the opt-in. Then transfer the issues as above.
- No standing "ripe for graduation" surface exists anywhere. This proposal is the mechanism, and the tower Board already shows HQ's issues.

## Always end with the Filed trail

The trail IS the reply's `**🗂️ Filed**` section, the same heading and bullet shape as every other Filed section the owner reads, so the two never differ. Each bullet leads with the issue link and reads in the cold-reader line (`docs/project-state.md` § Restating an issue); an entry that went somewhere with no issue (a docs page, another repo's path) leads with that destination instead.

```
**🗂️ Filed**
- [#N](url): <what the entry is, what this run did with it, what is needed next>
- <repo or docs path>: <what the entry is and why it landed there>
- ...
```

## Scoped mode (`/workkit:triage 215 211`)

Numbers in the ask mean SCOPED: only the issues named are read, and nothing else is touched. The `#` is optional (`215`, `#215`), and plain words carry the same meaning, so "215 211 triage", "triage 215", "accept 215" and "spec 215 and 211" are all this mode. The FULL drain needs the bare word with NO numbers ("triage", "empty the inbox"); a number in the ask is never the whole-inbox run.

1. Read only the named issues (`gh issue view <N> --comments`). An issue already past `status:inbox` is REPORTED as it stands, never re-routed: only the owner's word in the same ask moves a label it already carries.
2. Route each one through the SAME table above. Scoped changes only WHICH entries are read, never how they are routed: a named issue still parks to `status:backlog`, still goes `status:blocked` with its question in a comment, still becomes a polish line or a fold into another issue when that is what it is.
3. End with the Filed trail, listing only the numbers named.

Nothing else runs: no `.workkit/capture.md` drain, no HQ pass, and no marker for the capture guard, since the capture file is never read.

**"Accept" flips only on a real spec.** `accept 215` earns `status:specced` only when the issue already carries a `## Spec` with content: a spec the owner accepted, or the literal small-item line the routing table names. An empty Spec, or a `None yet` placeholder, is not acceptance ready. Draft one from the issue's body and comments, print it, and wait for the owner's yes; the flip follows the yes, never the draft (owner ruling, 2026-09-09: the ask itself is the accept, so a small drafted spec shown in chat earns the flip on that yes). An issue that still needs real design is the routing table's interview row, not this shortcut (spec § Specs).

## Merge mode (`/workkit:triage merge`)

A separate mode: instead of draining the inbox, sweep the OPEN board and apply the same litmus test across the issues that already exist.

1. List the open issues (`gh issue list --state open --json number,title,labels,body --limit 1000`) and read them.
2. Group by the test: *would closing one of these automatically mean the other is done too?*
3. Present a merge PLAN and stop: **merge these** (which survives, which closes, what moves), **attach that** (an issue that becomes a checklist line or a comment on another), **keep these separate**, with one line of why for every group, including the separations.
4. Execute ONLY on the owner's approval, group by group. Content moves to the survivor BEFORE the close; a closed-as-merged issue gets a closing comment naming the survivor (`gh issue comment <N> --body "Merged into #<survivor>."` then `gh issue close <N> --reason "not planned"`). The reason is what GitHub itself files a duplicate under, and nothing was built on the duplicate, so `safety/proof-guard` passes the close instead of asking it for a `Proof:` line. End with the Filed trail.

This mode never runs unattended and never merges on its own judgment. A wrong merge buries a real bug.

## Rules

- One home per entry (SSOT). If two homes seem right, pick the lowest-owning layer and point from the other.
- An open `polish: <surface>` issue is a DESTINATION, never a capture to drain: it stays `status:inbox` while it collects, the drain never re-routes it, and the state-check announcing it is expected (spec § How big is one issue).
- Exactly one `status:` label per open issue. Removing the old one is part of every relabel.
- Idempotent: re-running with nothing captured does nothing and says so.
- Never invent priority. `priority:` is the owner's call unless the entry states urgency; absence = normal.
- Ambiguous entries: file your best call and flag it in the Filed trail with `(check placement)`. Do NOT stop to ask per-entry.
- Never `agent:ok` on the owner's behalf. That permission is theirs to grant.
