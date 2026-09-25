---
name: triage
description: Route each entry to one home, then print the Filed trail. - Use on "triage", "file my notes", "empty the inbox" (the bare word drains everything), numbers with a triage word ("215 211 triage", "accept 215") for those only, a merge or dedupe ask, or when state-check reports inbox items.
argument-hint: "[merge | <issue numbers>]"
---

# Triage: drain the inbox, visibly

Work items live as **GitHub issues**. Triage is the ACTION that drains `status:inbox`, not a state.

Labels (SSOT: `~/.claude/workkit/labels.json`, and every repo's own `gh label list`):
- `status:inbox|specced|building|qa|complete|blocked|backlog`: the PIPELINE, mapped in the workkit plugin's README, one per issue (§ Rules) · `type:bug|enhancement|idea` · `priority:high|low` (absence = normal).
- `agent:ok`: an agent may work it autonomously at every stage: spec, accept, build, the `status:qa` check that grants `status:complete`, ship.

## Marker (opens the capture file)

FULL drain only; a scoped run sets none (§ Scoped mode). Run it before reading anything:

```sh
bash "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude/workkit/..}/scripts/triage-marker.sh"
```

- It records that triage is running. `safety/capture-guard` checks it before a read of `.workkit/capture.md` or the rewrite that clears drained entries. That rewrite is an agent's only write to the file. Adding to it is the owner's alone; it is their capture surface at every other moment.
- The script keys the marker to the session's repo root, which the capture file belongs to (`$HOME` outside every repo). It names the marker through the hook's own helper, so the two cannot drift.
- `CLAUDE_PLUGIN_ROOT` is set only inside hook commands. The fallback reaches the plugin root through the engine's stable address. `~/.claude/workkit` is the engine folder INSIDE the plugin; its parent is the plugin.

## Sources to drain (the FULL drain; § Scoped mode reads only the named issues)

1. **Open `status:inbox` issues** on the cwd repo: `gh issue list --state open --label status:inbox --json number,title,body,labels --limit 1000`.
2. **`.workkit/capture.md`**: the local, gitignored capture file (offline moments, free-form dumps).
3. **Mid-chat note dumps**: same routing, no file needed first.
4. **The HQ pass**: the home repo's open `status:inbox` issues, routed with the same table, from any repo: `gh issue list --repo <site.repo> --state open --label status:inbox ... --limit 1000` (`site.repo` from `~/.workkit/settings.json`).
   - This is how the nursery drains, since no session ever opens in the clone. `wk.sh note` files a capture made outside every participating repo straight onto the home repo, so it drains here. Captures cluster around one project: propose graduation (§ Graduation).

Split every source into discrete entries. A wall of mixed notes fans out to MANY destinations, never one blob. A dump issue fans out to N new issues and comments. Then close it with the Filed trail as its closing comment.

## Route each entry to exactly ONE home

1. **Search first**, open AND closed: `gh issue list --state all --search "<key words>" --limit 1000`.
2. **Filing litmus test**: *would closing an OPEN issue automatically mean this entry is done too?* Yes: it goes on THAT issue, as a Spec checklist line or a comment. Only a no earns a new issue (spec § How big is one issue). Then route by the table.

| Entry is... | Route |
|---|---|
| Already covered by an existing issue | `gh issue comment <N>` on that issue, never a duplicate |
| Already rejected (a closed **not planned** issue) | Cite the rejection in the Filed trail; do NOT re-file |
| Actionable, spec written and accepted (or a small item: Spec is `None needed: small item.`) | Relabel `status:specced` (+ `type:`, + `priority:` if clearly high/low). The flip AUTHORIZES the build: make it only on a genuinely accepted spec |
| Actionable, but still needs design or detail | Stays `status:inbox`; draft what you have into `## Spec` (or a comment). QUEUE the interview and say so. Never show a whole drafted spec for a bare yes (spec § Specs, the collaborative rule). Its later acceptance earns `status:specced` |
| A polish nit, docs nit, or cosmetic finding | A checklist line in the `## Spec` of the surface's open `polish: <surface>` issue. None open: open one (`status:inbox` + `type:enhancement`). Mechanics, the freeze rule and "bugs never batch" included: spec § How big is one issue |
| Waiting on the owner's decision, or needs their yes/no before it is even accepted | `status:blocked` + a comment naming the question. The yes/no case first drafts the proposal into `## Spec` |
| Worth keeping, deliberately not now | `status:backlog` |
| Cross-project / business / no single repo, and no repo on this machine owns it | An issue on the **home repo**, the `site.repo` in `~/.workkit/settings.json` (`docs/project-state.md` § The global layer). Last resort: the rows below resolve FIRST |
| Names a workkit skill, hook, agent, or engine file | An issue on the KIT'S OWN repo (below), from any session, never the home repo. Never a hardcoded slug |
| Belongs to a DIFFERENT project | An issue on that repo, RESOLVED, never guessed: its checkout from the roster (`~/.workkit/.repos.json`, each enabled repo's absolute path), its slug from `git -C <path> remote get-url origin`, then `gh issue create --repo <owner/name>` |
| An idea for a project that has no repo yet | A `type:idea` issue on the **home repo**; later notes are comments on it. Never create a repo or a folder here. Graduation: § Graduation |
| A durable fact about how things work | The right `docs/*.md` (or AGENTS.md if doctrinal), then close the issue pointing at it |

**The kit's own repo** resolves from the plugin's own checkout, a CHAIN, not a default: `[ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && git -C "${CLAUDE_PLUGIN_ROOT}" remote get-url origin || git -C ~/.claude/workkit remote get-url origin`.
- The variable is set only inside hook commands. An empty `-C` would answer with the session's own repo, so the guard makes the second link run. A published install's plugin root is a cache folder with no git, and the second link takes over there too. `gh issue create --repo` accepts the URL git prints as is.

**A destination that cannot be reached** keeps the entry local, the skip named in the Filed trail. Never drop it or invent a destination.
- The home repo is optional. With no `site.repo`, or a failed `gh` call against it, an entry routed there stays in `.workkit/capture.md`. The HQ pass names its skip the same way; its entries already live on HQ, so nothing is held locally.
- Unresolvable kit repo, or a different project with no roster match: never fall back to the home repo.

## Draining `.workkit/capture.md`

Each entry becomes an issue: `gh issue create --label status:inbox,type:<kind>` then route it, or file it routed directly. Delete only the entries that actually landed somewhere; keep the file header. Offline: leave the file untouched and say the queue could not be reached.

## Graduation (the HQ pass's proposal)

The system proposes, the owner creates. No automation makes a repo or moves an issue on its own. When HQ captures cluster around one project, propose graduation in chat, then wait for the owner's word. A cluster is several issues or comments naming the same not-yet-project. No standing "ripe for graduation" surface exists: this proposal is the mechanism, and the tower Board shows HQ's issues.

- **To an existing repo**: `gh issue transfer <n> <owner>/<repo>` where GitHub allows it (same owner or org). Otherwise recreate the issue on the target with pointers both ways. Either way the HQ issue closes with a comment naming where it went.
- **To a project with no repo**: the proposal asks three things in chat. The repo name; the OWNER, never assumed (the personal account or an org the owner belongs to); the visibility (private default).
- On that yes: `gh repo create <owner>/<name>`, then clone beside the machine's other checkouts (read the roster, `~/.workkit/.repos.json`, to learn the layout). Ask the participation question (`workkit enable`), never assuming the opt-in. Then transfer the issues as above.

## Always end with the Filed trail

- The trail IS the reply's `**🗂️ Filed**` section: the same heading and bullet shape as every other Filed section the owner reads.
- Each bullet's bold lead carries its number, the issue link and five words. The bullet reads in the cold-reader line (`docs/project-state.md` § Restating an issue). An entry that landed with no issue (a docs page, another repo's path) leads with that destination instead.

```
**🗂️ Filed**
- **1. [#N](url) <five words>**: <what the entry is, what this run did with it, what is needed next>
- **2. <repo or docs path>**: <what the entry is and why it landed there>
- ...
```

## Scoped mode (`/workkit:triage 215 211`)

Numbers in the ask mean SCOPED: only the named issues are read, nothing else is touched. The `#` is optional (`215`, `#215`). Plain words mean the same: "215 211 triage", "triage 215", "accept 215", "spec 215 and 211". The FULL drain needs the bare word with NO numbers ("triage", "empty the inbox").

1. Read only the named issues (`gh issue view <N> --comments`). One already past `status:inbox` is REPORTED as it stands, never re-routed. Only the owner's word in the same ask moves a label it already carries.
2. Route each through the SAME table. Scoped changes only WHICH entries are read, never how. A named issue still parks to `status:backlog`, goes `status:blocked` with its question in a comment, or becomes a polish line or a fold into another issue, whichever it is.
3. End with the Filed trail, listing only the numbers named. Nothing else runs: no capture-file drain, no HQ pass, and no marker, since the capture file is never read.

**"Accept" flips only on a real spec.**
- `accept 215` earns `status:specced` only on a `## Spec` with content: a spec the owner accepted, or the table's literal small-item line. An issue that still needs real design takes the table's interview row instead (spec § Specs).
- An empty Spec or a `None yet` placeholder: draft one from the body and comments, print it, and wait for the owner's yes. The flip follows the yes, never the draft. The ask itself is the accept, so a small drafted spec shown in chat flips on that yes.

## Merge mode (`/workkit:triage merge`)

Instead of draining the inbox, sweep the OPEN board and apply the same litmus test across the existing issues. Never unattended, never on its own judgment: a wrong merge buries a real bug.

1. List and read the open issues (`gh issue list --state open --json number,title,labels,body --limit 1000`). Group them by the test: *would closing one of these automatically mean the other is done too?*
2. Present a merge PLAN and stop: **merge these** (which survives, which closes, what moves), **attach that** (an issue that becomes a checklist line or a comment on another), **keep these separate**. Every group gets one line of why, separations included.
3. Execute ONLY on the owner's approval, group by group. Content moves to the survivor BEFORE the close: `gh issue comment <N> --body "Merged into #<survivor>."` then `gh issue close <N> --reason "not planned"`.
   - GitHub files a duplicate under that reason, and nothing was built on the duplicate. So `safety/proof-guard` passes the close without a `Proof:` line. End with the Filed trail.

## Rules

- One home per entry (SSOT). If two homes seem right, pick the lowest-owning layer and point from the other.
- An open `polish: <surface>` issue is a DESTINATION, never a capture to drain. It stays `status:inbox` while it collects and the drain never re-routes it. The state-check announcing it is expected (spec § How big is one issue).
- Exactly one `status:` label per open issue. Every relabel removes the old one in the same command: `gh issue edit <N> --remove-label status:inbox --add-label status:specced,type:enhancement`.
- Every issue body you create or route follows the anatomy (spec § Issue anatomy): `## Description` then `## Spec`, both always present. A small item's Spec is the literal `None needed: small item.`
- Introduction rule (same section): link an outside project or repo at its first mention, in a body or a comment, with a one-line description.
- Idempotent: re-running with nothing captured does nothing and says so.
- Never invent priority. `priority:` is the owner's call unless the entry states urgency.
- Ambiguous entries: file your best call and flag it `(check placement)` in the Filed trail. Do NOT stop to ask per entry.
- Never `agent:ok` on the owner's behalf. That permission is theirs to grant.
