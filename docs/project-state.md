# Project State Spec (v4) — issues · workflow · attic · the global layer

> The ONE definition of how project state is captured, tracked, and cleaned across every repo.
> Provider-agnostic: GitHub Issues + plain markdown + JSON + git. Agents of any provider implement it; Claude adapters = the `workkit:triage`, `workkit:status`, `workkit:ship`, `workkit:migrate` skills + the `workflow:standards`, `docs:state-check`, `docs:change-tracker`, `docs:board-guard`, `docs:changelog-guard` hooks.
> **v4 is the only format. No backwards compat.** `PROGRESS.md` (the board) and `INBOX.md` are RETIRED — work-item state lives in GitHub Issues. Migration recipe at the bottom.

## The model

| Job | Home | Committed? |
|---|---|---|
| Work items — capture, queue, findings, per-item decisions | **GitHub Issues** (comments carry the trail) | Cloud (the SSOT) |
| Per-repo workflow opt-in + config | **`.workkit/settings.json`** in the repo | Yes — the project's answer |
| Per-developer decisions about repos (declined, never asked) | **`~/.workkit/.repos.json`** (`$WORKFLOW_HOME` overrides) | Never into a PROJECT repo — it is one developer's file, written by the engine. Track it in your own dotfiles if you want declines to survive a new machine |
| Per-developer, per-session working state | **`.workkit/`** in the repo, everything but `settings.json` gitignored — `capture.md` is the owner's, `agents/` is the agents' | Never |
| How the system works (doctrine, durable rules) | `AGENTS.md` + `docs/<topic>.md` | Yes |
| Shipped record | `CHANGELOG.md` + git + Releases | Yes |
| "Removed but not gone" | `_attic/` — gitignored FOLDER; evicted files keep their names (`_attic/CLAUDE.proposed.md`), harvested scraps go to topical files (`_attic/inbox.md`) with a `from <path>, <date>, <why>` header line. Attic contents are NEVER source material for doctrine (owner ruling, 2026-07-20) — harvest facts only from live sources | Never |

- The queue is a QUERY, never a file: `gh issue list`. Nothing about work state is stored in the repo.
- **Promotion rule**: anything durable — a finding, a decision, a blocker — is promoted to its issue as a comment the moment it exists. `.workkit/` holds only in-flight session state; it is private per developer, so nobody else ever reads it. It is a routing stop, never a destination.
- **`.workkit/` splits by owner** (owner ruling, 2026-08-05). Three things live there and nothing else: `settings.json`, the tracked opt-in · `capture.md`, the ONE owner-editable file (§ Capture) · `agents/`, everything the agents maintain — `session.md`, the `docs:change-tracker` fingerprint, anything future. The boundary is structural rather than a convention: the owner writes above `agents/`, the agents write inside it, and the one file that crosses is `capture.md`, which an agent only ever CLEARS, during a triage run.
- **Participation is a tri-state, split across the two settings files.** Only a real yes (or a deliberate project-level no) belongs in the repo; never-asked and declined are personal (owner ruling, 2026-07-24) — a teammate reading `enabled: false` in a shared repo would take it for the project's decision when it was one developer undecided.

| Repo state | What happens |
|---|---|
| Committed `.workkit/settings.json` with `"enabled": true` (or no `enabled` key — a file that predates it is still a yes) | Healed as usual |
| Committed `.workkit/settings.json` with `"enabled": false` | Silent. The project turned it off on purpose |
| No committed file, no record in `~/.workkit/.repos.json` | One line per session offering to enable. **Nothing is written into the repo** — no stub settings.json, no `.gitignore` line, no templates |
| No committed file, `repos["<absolute repo root>"] == "declined"` in the user file | Silent, forever |
| The tower clone at `~/.workkit/tower` | Silent, always. It is engine territory — never offered, never healed, never registered, and `--enable` refuses it |

  **The standard version.** `settings.json`'s `version` records which standard a repo was last healed to, and `standards.sh` carries the current one — so "does this repo need attention?" is an integer compare, not a scan. A repo below the current version also gets a DRIFT REPORT naming what it still carries from a retired convention (`PROGRESS.md`, `INBOX.md`, `TODO.md`, `plans/`, a CHANGELOG whose entries are not in the entry format), then has its version stamped forward once the mechanical heals succeed. The report never acts: deleting a retired file deletes work items nobody migrated, and rewriting CHANGELOG prose needs judgment — both are a human's call, and the report says which skill to run.

  Both answers are deliberate commands, never a hook's doing: `bash ~/.claude/workkit/standards.sh --enable [repo]` writes the committed `{ "version": 1, "enabled": true }` and then heals; `--decline [repo]` records the repo under `repos` in `~/.workkit/.repos.json` (writing only that key, leaving every other key and value intact). The gitignore pattern in a participating repo is two lines: `.workkit/*` then `!.workkit/settings.json`.

  **Other systems may add their own key.** The top-level keys above (`version`, `enabled`) belong to this spec; a separate system claims a separate key and leaves them alone. The one in use today is `manager`, carrying per-repo overrides for the Claude harness's manager system (agent model tiers, and an `enabled` of its own) — a Claude-harness concern, documented in `~/.claude/hooks/README.md`, with no effect on the issue workflow.
- **Rulings split by scope**: project doctrine → `AGENTS.md`/`docs/`; per-item calls → a comment on that issue.

## Pointer doctrine (CLAUDE.md → AGENTS.md)

Repo instructions live in `AGENTS.md` (provider-agnostic); `CLAUDE.md` is exactly one line — a bare `@AGENTS.md` import. `AGENTS.md` itself stays ≤250 lines AND carries no line over 400 BYTES — it is the architectural overview; deep references live in `docs/<topic>.md` and AGENTS.md points at them. The DENSITY half is the second budget (#161): a markdown paragraph is one source line, so the line count alone let the file pass every check while growing into a book. The unit is bytes, pinned there (`LC_ALL=C`) so one measurement holds on every machine. All three rules enforced at write time by the `docs:board-guard` hook.
- New repo: create `AGENTS.md` first, then the one-line `CLAUDE.md` pointer.
- Existing content-bearing `CLAUDE.md` — convert the first time you touch it, in TWO commits: `git mv CLAUDE.md AGENTS.md`, commit, THEN add the pointer `CLAUDE.md` in a SEPARATE commit. A pointer in the same commit breaks git's rename detection (`log --follow`/blame lose the history).

## Labels — the universal state machine

**Every label is `group:value`.** Values are single lowercase words, never hyphenated. The set is identical in every participating repo. The machine SSOT is `~/.claude/workkit/labels.json` (groups, values, descriptions, colors, and each group's `exclusive`/`required` rules); the standards script creates the labels from it AND writes each label's GitHub description from it — so `gh label list` teaches the vocabulary to any human or agent with no harness at all.

| Label | Meaning |
|---|---|
| `status:inbox` | Captured, nothing authorized. Raw notes, half-thoughts, and accepted-but-unspecced items all sit here. Triage is the ACTION that drains it, not a state. |
| `status:specced` | The issue's `## Spec` is written AND accepted. The label flip IS the authorization to build — the only stage builds start from. |
| `status:building` | Authorized and in flight — the work has started. Carried through build and verify, then the flip to `status:qa` — on an `agent:ok` issue too, where the agent performs the check itself, moves it to `status:complete` and ships in the same run. |
| `status:qa` | Built, tests green, review passed — WAITING on the check: the owner's normally, the agent's own on an `agent:ok` issue. The work sits in the working tree; a passing check moves it to `status:complete`, a failing one leaves it here. |
| `status:complete` | The check PASSED — QA'd, ready to ship. The verdict is the owner's: only their explicit word flips `qa` → `complete`, or the agent's own check on an `agent:ok` issue. The ship reads from this stage, and the ship close ends it. |
| `status:blocked` | Waiting on a human decision — the question lives in the issue body or a comment. |
| `status:backlog` | Kept on purpose, not now. |
| `type:bug` · `type:enhancement` · `type:idea` | What kind of thing it is — exactly one per open issue, like `status:`. Applied by the issue templates at capture (a dump is `type:idea`); rarely changes. (Native GitHub issue types are org-only, so labels carry this.) |
| `priority:high` · `priority:low` | Order within the queue. **Absence = normal** — there is no `priority:normal` label. |
| `agent:ok` | An agent may work this issue autonomously at every stage, the ship included — the owner's gate, exercised in advance at labeling time. Absence means humans only. |
| `agent:working` | An agent has this issue claimed. The agent applies it at claim time, alongside assigning itself, and removes it at release. It is the marker that tells an agent claim from a human one — agents run `gh` as the owner, so the assignee cannot. The standards heal releases a claim idle for 24 hours. |

- **Exactly one `status:` label per open issue.** Every relabel removes the old one in the same command: `gh issue edit <N> --remove-label status:inbox --add-label status:specced`.
- The four groups are orthogonal and compose: `status:specced` + `priority:high` + `agent:ok` on one issue is legal and means exactly what it says.
- `area:*` is deliberately NOT bootstrapped — it is project-specific; a repo adds its own if it wants one. Adopt a group deliberately, never speculatively.
- **A label rename is applied once, at rename time.** Moving every issue off a retired label — open and closed — and deleting it is the job of the rename itself, done by hand or by a one-off sweep. No standing code in the heal carries old vocabulary forward; `labels.json` describes the vocabulary as it is now.

**The statuses read as a PIPELINE** — intent to implemented: `status:inbox` → `status:specced` → `status:building` (build → verify) → `status:qa` (waiting on the check — the owner's, or the agent's own under `agent:ok`) → `status:complete` (the check passed) → closed against the CHANGELOG entry, with `blocked` and `backlog` as side pockets — an answered `blocked` issue rejoins at `status:specced`, a revived `backlog` one re-enters triage. The flip to `building` happens the moment work starts; the assignee is still the claim, and the label is what makes in-flight work visible on a board. No working label comes off by hand — the flip to `qa` is mechanical, the flip to `complete` is the owner's verdict, and the ship close ends whichever one the issue is carrying.

The one gate is the flip from `inbox` to `specced`, and it is a deliberate act: it says the `## Spec` is written, it is accepted, and building this is now authorized. Nobody flips it casually. A small item is specced the moment someone accepts it with the literal Spec `None needed — small item.`; a large one is specced when its implementation layer is written and accepted. "Accepted but not yet specced" is deliberately NOT a visible stage — it stays `status:inbox`, with a triage comment or a `priority:` label carrying that signal. The `workkit:feature` skill refuses to build an issue that is not `status:specced`. The visual map — the road and the crew that works it — is in the [README](../README.md).

**The qa stage is where a built item waits for its check** (owner ruling, 2026-08-05, amended 2026-08-06 and 2026-08-26). EVERY item parks at `status:qa` when it is built — the label means "built, WAITING on the check", and what varies is WHO performs that check: the owner normally, the agent itself on an `agent:ok` issue, which is what that grant means. What checking looks like varies per item too: a visual pass on one, reading the diff and the verification comment on another. A passing check does not ship the item, it moves it one stage on — to `status:complete`, the stage a ship reads from.

- **The park.** Build done, tests green, review passed → the work STAYS IN THE WORKING TREE, uncommitted or committed-but-unpushed → the agent flips `building` → `qa` and comments naming what to check and where. That flip is MECHANICAL: no human moves a status, and the agent never asks in chat whether to ship. It releases `agent:working` in the same edit — the agent is done and the wait is the owner's, and a claim left standing is swept as stale after 24 idle hours — while the assignee stays, because the work is still in that tree. On an `agent:ok` pass-through the claim HOLDS through the park: the agent is still working, its own check comes next, and the ship close is what releases the labels.
- **The pass** (#196). A check that PASSES flips `qa` → `complete` and lands a comment naming who passed it and when ("QA passed by <owner>, <date>"); the agent's session notes record it too. The verdict is the OWNER'S, exactly like `agent:ok` — an agent never applies it on their behalf, and only their explicit word moves the label. On an `agent:ok` issue the agent's own passing check IS that word: it flips the label itself, comments the same way, and ships in the same run. The stage exists so "checked and good to go" is queryable at a glance, however long the gap between the check and the ship.
- **The nod.** The owner's word — "ship", or `/workkit:ship` — runs the normal ship over the `status:complete` items: the CHANGELOG move, the commit, and the close of each issue against its entry, which releases the label. Nothing else ends a complete stage.
- **A failed check** is fixed in place and re-commented on the same issue. The label does not move; qa is where the item stays until it passes.
- **An item still at qa survives a ship untouched** (#196) — its issue stays open and its `[Unreleased]` entry stays where it is. Its code sits in the same shared tree, though, so the ship LISTS every qa item and the owner calls each one: "include" grants `complete` on the spot and that ship carries it, or the ship waits for the check. File-level hold mechanics — shipping around un-passed work — are deliberately out of scope.
- **The tree holds unshipped work while an item sits in qa**, so the next item waits. That is the accepted cost of the simple version: no branches, no PRs, no worktrees, no previews. Parking the work on a branch instead is a later upgrade under the same label — the label and its meaning never change, only the parking mechanics, and nothing migrates when it lands.
- **Ship authorization** — nothing ships without the owner's word, and THE WORD IS THE PERMISSION: "ship" in chat or `/workkit:ship` authorizes that run, with no follow-up permission prompt and no re-asking (harness-level git prompts were considered and rejected). A passing mention — "we'll ship this later" — is not the word. `agent:ok` is the one exception, granted per issue in advance.

## Capture

Three surfaces, all converging on issues. There is no store outside a participating repo: the capture that belongs to no project is filed straight onto the home repo as a `status:inbox` issue.

1. **Issue templates** (`.github/ISSUE_TEMPLATE/`: bug · enhancement · idea · dump) — markdown templates that pre-fill the body with the issue anatomy (`## Description` then `## Spec`) and auto-apply `status:inbox` + the `type:` label, so a first-day teammate files a correctly shaped issue from the web or phone.
2. **A dump issue** — one issue holding a wall of mixed notes. The template stamps it `type:idea` (every issue carries exactly one `type:`); triage reads the body and fans it out.
3. **`.workkit/capture.md`** — the local, gitignored free-form dump for offline moments. Triage drains it into issues the same way. The standards script creates it empty (with its capture header) so dumping is always zero-friction; it never overwrites one that has entries. It is the OWNER'S CAPTURE SURFACE: the owner adds to it freely from any shell, and the AGENT'S ONE SANCTIONED TOUCH IS THE TRIAGE DRAIN (owner ruling, 2026-08-05) — during a triage run its contents are read and the entries that landed somewhere are deleted. The `safety/capture-guard` hook holds both directions: the marker the `workkit:triage` skill records opens a read and a rewrite, nothing opens an APPEND (`>>`, `tee -a`, the capture CLI run by an agent), since adding to it is never the agent's, and counting the entries is always free. A finding an agent cannot file as an issue goes in chat, never here. The engine's capture CLI (`wk.sh note "the thought"`) appends here from any shell — and standing outside every participating repo it files a `status:inbox` issue on the home repo instead, since there is no capture file out there; with no clone on this machine, or no way to reach GitHub, it writes nothing, hands the note back and names `workkit setup`.

**`.workkit/agents/session.md`** is the first of the agents' own files — the session's scratchpad, created by the standards script from a fixed template and never overwritten once it has content. Three sections, always the same: `## Active` (the one issue being worked), `## Queue` (what comes next, in queue order), `## Notes` (scratch — durable findings are promoted to their issue as a comment before stopping). One file named for the session, not for a task, so it is found and updated instead of rotting.

Its one job is keeping the LOCAL AGENT on task across a compaction, a resume, or a restart, which is why it is READ BACK at every session start (the `docs:session` hook injects it on every source, silent when the file holds only its header). It is a queue, not a journal, and not long-term storage: past 40 content lines the injection says so, and the `docs:session-guard` hook bounces the write itself — the same 40-line bar plus a 350-character cap per bullet — because everything durable belonged on an issue the moment it existed. A session.md growing into the retired `PROGRESS.md` shape is the failure the bar exists to catch.

Before a deliberate compaction, the `workkit:checkpoint` skill hardens the CONVERSATION into issues the same way — routed by the triage table, with `session.md` trimmed to what is in flight — so the chat's findings survive on the board instead of in the scrollback.

## Issue anatomy

Every issue body has the SAME two sections, always present, always in this order (owner ruling, 2026-07-24: one enforced structure so every issue reads the same):

| Section | Holds |
|---|---|
| `## Description` | What the thing is and why, in prose — never restating the title. Background, evidence, links, and success criteria all live here. |
| `## Spec` | How it will be built — the editable, single-current-version part. Specs are for BIG items; a small item's Spec is the literal line `None needed — small item.` An agent that picks up a "None needed" issue and finds real complexity writes the spec in before building. Accepting what is written here is what earns `status:specced`. |

The body is the current version of the thinking; comments are the trail of how it got there.

**An outside project is introduced on first mention.** The first time an issue body or comment names a project or repo other than this one, it carries a link and a one-line description of what that thing is — "workkit (ITW-Creative-Works/workkit), the issue-pipeline workflow system this repo's hooks come from", not a bare "workkit". Later mentions in the same issue need nothing. The reader is a future human or agent arriving cold, with no memory of the week the issue was filed (owner ruling, 2026-07-27, prompted by an omega issue that named workkit without saying what it is).

**Every repo this system touches is assumed PUBLIC — issues, PRs, and comments included.** Issue content carries no secrets, no credentials, no tokens, and no private business or personal details. Sensitive context stays in chat or in local files. The `safety/issue-guard` hook blocks the outbound `gh issue`/`gh pr` write when it can see a secret; the rest is judgment.

The issue templates in `.github/ISSUE_TEMPLATE/` pre-fill exactly this anatomy, so every issue conforms from the moment it is filed — no rewriting at triage.

## How big is one issue

**One issue = one thing that ships at one moment.** Size is not the test — a large piece of work that lands as a single release is one issue. The test is whether the parts would ever need DIFFERENT states at the same time. Cut VERTICAL slices where it makes sense: an issue that runs thin through the whole stack (schema, backend, UI, test) and works end to end beats one horizontal layer that proves nothing on its own. An issue carries exactly one `status:` label and closes against one CHANGELOG entry, so parts that disagree about their state cannot share a row (owner ruling, 2026-07-24).

| The parts... | Shape |
|---|---|
| always ship together | ONE issue; list the parts as a checklist in the Spec |
| serve one goal but ship separately, each needing its own state | a PARENT issue with GitHub sub-issues (`gh issue edit <child> --add-parent <N>`) — a checkbox cannot hold a status label, a sub-issue can |
| share only a theme | SEPARATE issues, no parent |

Sub-issues are also the dependency mechanism: work that waits on OTHER WORK stays `status:specced` under its parent — the open siblings say what comes first, and each child is a real issue the queue query can see (a checkbox is not). `status:blocked` stays reserved for waiting on a human decision. A checklist line can be converted to a sub-issue from the GitHub UI the moment it turns out to need its own state, so starting small costs nothing.

**A later idea is always its own issue** — never appended to an existing one, however related (owner ruling, 2026-07-26). Two MCP integrations decided days apart are two issues: they ship at different moments, which is the whole test. Add a `relates to #N` line when the connection matters; merge two issues only on deciding they will ship as one; reach for a parent only when separate shipments serve one coordinated goal, never for taxonomy. The litmus test below is this same ruling read from the other end: a later idea FAILS it — closing the existing issue would not finish the idea — so ideas stay separate, while a nit that would ship in the same sitting passes and attaches.

**The filing litmus test**, applied every time an issue is about to be created: *would closing an OPEN issue automatically mean this is done too?* Yes → it belongs THERE, as a checklist line in that issue's Spec or as a comment, never as a sibling issue. No → it is its own issue. Fragmentation at filing time is what this catches — one review sweep fanning into five issues that would all close in the same sitting.

**Bugs and failures get one issue each**, however small: each needs its own repro, its own test, and its own closing state. The one exception is a shared ROOT CAUSE — one issue, the symptoms listed in it.

**Polish, docs nits, and cosmetic findings ROLL UP** onto one issue per surface, titled `polish: <surface>`, where a surface is what one look verifies (the tower, a theme, the docs) — search the titles first, since an open `polish: tower` wins over inventing a synonym. It carries `status:inbox` + `type:enhancement` while it collects, which authorizes nothing, and each nit is one checklist line in the `## Spec` with its pointer (page or file) — the ship-together part list, not work-state. The owner's go on the pass IS the acceptance: the list as it stands flips to `status:specced`, one worker works every line in one sitting, one look verifies, one CHANGELOG entry closes it. At that flip the list FREEZES — a nit arriving mid-build starts the NEXT rolling issue for that surface, and at most one is COLLECTING per surface at a time. Its `status:inbox` is the collecting state, not an undrained capture: triage treats an open rolling issue as a destination, and the state-check announcement of it is expected. Bugs never land here, however small: polish is "looks or reads wrong", a bug is "behaves wrong".

The smell: an issue you cannot answer yes to, because yes would approve a part you have not decided. Split it. Bundling by theme produces an issue that can never carry a true status and can never close — #2 bundled four unrelated designs behind a chapter number from a retired plan file and blocked all four for days.

## Triage — the action that drains the inbox

Every entry is routed to exactly ONE home: a comment on an existing issue · a new routed issue · an issue on the home repo (cross-project) · another repo's issues · `docs/`/`AGENTS.md` (a durable fact) · `_attic/inbox.md` (kept but rejected).

- **Search first, open AND closed** (`gh issue list --state all --search ...`). A closed **not planned** issue is the rejection record — cite it instead of re-pitching.
- **The Filed trail is mandatory**: triage ends by printing `Filed:` — one line per entry → its destination. On a dump issue, that trail is the closing comment. Capture is only trusted when filing is visible.
- **Route by authorization, not by enthusiasm**: `status:specced` is only for work whose `## Spec` is written and accepted (a small item's accepted Spec is the literal `None needed — small item.`). Anything still needing design stays `status:inbox` with whatever spec exists drafted into `## Spec` or a comment — accepting it later is its own act.
- Detection is automatic (the `docs:state-check` hook announces open `status:inbox` issues and a non-empty `.workkit/capture.md` at session start); filing stays deliberate. Full playbook: the `workkit:triage` skill.
- **Every run includes the HQ pass** (#100): after the local sources, triage lists the home repo's open `status:inbox` issues and routes them with the same table — including proposing graduation (below, § The global layer) when a cluster of captures points at one project. No `site.repo`, or HQ unreachable: the pass names the skip; it is never silent. There is no separate HQ command and no HQ session — this pass is how the nursery drains, and it needs only the network, never the clone. HQ's backlog has no session-start announcer either (the `docs:state-check` hook speaks for the cwd repo alone); the tower Board and this pass are its two surfaces.

## Queue semantics

- **Working** = the issue is assigned and carries `status:building` — or `status:qa`, which is the same claim one stage on, waiting on the check rather than on the build (the owner's normally, the agent's own under `agent:ok`), or `status:complete`, checked and waiting only on the next ship. Your queue is `gh issue list --assignee @me`.
- **Done** = closed `completed`. **Rejected** = closed `not planned` — the institutional no, and the thing triage cites.
- Queue order: `priority:high`, then unlabeled (= normal), then `priority:low`. GitHub has no manual ordering; `priority:` is the substitute.
- **Within one priority, order by dependency, risk, and reviewability** — blockers first (work other issues wait on), then bugs, then shared seams (the file or module several queued items all touch), and only then dependent feature work. A seam changed once is reviewed once; changed under three features in flight it is reviewed three times and merged badly. This is the order the autonomy loop uses to pick its next item, and the order the `workkit:status` digest reports in. A dependency has a MECHANICAL form (#103): it is written with `gh issue edit <N> --add-blocked-by <M>` — only blocked-by is ever written, since GitHub keeps the inverse and the two directions cannot drift — with an inline `Depends on: <owner>/<repo>#<n>` line in the body as the cross-org fallback, merged with the native edges by everything that reads them; the semantics are advisory, so an open blocker orders its issue later and is named beside it, and no label ever moves because of one.
- **The assignee is the claim.** Whoever starts work — a human or an agent session — assigns the issue to themselves first; everyone else skips an issue that is already assigned. That is the whole anti-double-work mechanism, and it works for a developer, a teammate, and an agent alike, because nothing is shared but the issues (`.workkit/` is per developer, so there are no merge conflicts and no lane collisions). An AGENT claim carries `agent:working` as well, applied at claim and removed at release.
- **A claim that goes quiet is released.** An agent that dies mid-work would otherwise lock its issue against everyone forever, so the daily standards heal sweeps: an open issue carrying `agent:working` whose last activity is more than 24 hours old loses the label and its assignee, and gets a comment saying the sweep did it. Only agent claims expire — a human claim has no timer, and a heal that cannot reach GitHub releases nothing at all.
- **Re-validate immediately before starting.** Between finding an eligible issue and starting on it, the label and the assignee can both change — someone else claimed it, or the owner pulled `agent:ok`. Re-read both at the moment work begins, not at the moment the queue was listed, and stop if either moved.
- **Collapse on ship**: the turn that writes the CHANGELOG entry also closes the issue with a pointer to that entry. A `Fixes #N` trailer in the commit does both on push.
- **An issue is the work item; a PR is the delivery vehicle.** The issue holds what and why, the plan, the state labels, and the decision trail — it can live for months and survive many attempts. A pull request is one reviewable diff with checks, born from a branch and finished at merge; it belongs to exactly ONE issue through its `Fixes #N` trailer, and never spans two. The issue closes when its work ships, not when a PR merges partway there.
- **Delivery is hybrid** (issue #37, ratified 2026-07-26): a supervised local session commits DIRECTLY to the default branch — the local hook gates (tests, review, message lint) are its enforcement, and a PR would re-review work they already reviewed. A PULL REQUEST is required exactly where those hooks cannot reach: unattended or agent-authored work (`agent:ok`, an @mention), outside contributors, or when the owner asks. PR mechanics: branch `issue/<N>-slug` (no issue → `ship/<slug>`), ONE squash merge whose subject ends `(#<PR>)` and whose body carries the `Fixes #N` trailer; the `checks.yml` workflow installed by the standards heal runs the test suite on every PR, so an author without the hooks still meets the bar; a red check is fixed on the branch, never merged around. The `chore(release)` commit always pushes directly — generated bookkeeping, and the changelog backfill needs the merged sha. The standards heal also asks GitHub to REQUIRE the test check (branch protection) as a best effort — applied where the plan allows it, quietly skipped where it does not (free-plan private repos).

## CHANGELOG entries

The git history carries the full story — why a change was made, what was tried, what the review caught. The CHANGELOG is the INDEX a human scans to answer "what changed in this version, and does it affect me?". An entry that repeats the commit body is a second copy of a fact that already has a home.

So an entry is **one short paragraph that points at the depth**, in the shape of `@changesets/changelog-github` (owner ruling, 2026-07-25). The contributor field stays even in a repo with one maintainer, because that is not a permanent condition.

```
[Unreleased]   - [#4](../../issues/4) — Plugins install from settings.json instead of being tracked as files.
released       - [#4](../../issues/4) [`1de1308`](../../commit/1de1308) Thanks [@who]! — Plugins install from settings.json.
```

Every link is written SHORT, so the repo URL appears nowhere in the file. `../..` is a relative link GitHub resolves against the blob path (it also follows a fork), and `[@who]` is a markdown shortcut reference whose one definition sits at the bottom of the file however many entries a person appears in. The depth assumes a CHANGELOG at the repo root.

**Nobody types the metadata.** During ordinary work you write only the issue link and the sentence; the commit link and the handle are filled in at release time by `~/.claude/workkit/changelog-links.js`, which finds each entry's commits through the `Fixes #N` trailer they already carry. Re-running it is a no-op. The commit link is derivable offline (remote URL plus sha); the handle needs the GitHub API, so it is written when resolvable and never demanded — an offline release still produces a valid CHANGELOG.

It fills **`[Unreleased]` entries only**, which is why the ship skill runs it BEFORE moving them into the version section — a released section is history and is never rewritten. An entry whose issue no commit closes is named in the output ("add a `Fixes #N` trailer"), never skipped in silence.

The rules, with `~/.claude/workkit/changelog.js` as their machine SSOT:

| Rule | What it asks |
|---|---|
| `issue-link` | The entry starts with `[#N](url)`, or the literal `(no issue)` when nothing is filed |
| `separator` | An em dash surrounded by spaces (` — `) divides the links from the text |
| `word-cap` | At most 50 words of prose (the links are not counted) |
| `one-paragraph` | One paragraph — a second one is detail that belongs in the commit or the issue |
| `commit-link` | An entry in a RELEASED section carries its commit link. `(no issue)` entries are exempt: with no issue there is nothing to look up, and a hand-typed sha is what this format avoids |

Enforced at write time by the `docs:changelog-guard` hook and at commit time by the `safety/commit-gate` hook, which is the authority of the two — it sees hand edits made outside the tools. Both judge only the lines a change ADDS, so adopting the format never bounces a repo for its history, and the `commit-link` rule makes an un-backfilled release commit impossible: moving an entry into a version section is what subjects it to the rule.

Three things are deliberately NOT entries, because a guard that judges them bounces correct work: anything inside a fenced code block (a CHANGELOG documenting its own format), anything under a `##` heading that is not a version section (a prose appendix), and any flush-left line following a bullet — which is what keepachangelog's `[1.0.0]: <url>` reference footer is made of.

## Specs

**A spec is not a file. A spec is the `## Spec` section of its issue body** (owner ruling, 2026-07-24) — one home, always current, always attached to the work it describes. There is no `plans/` directory and no plan frontmatter.

- **Editing beats appending.** The body carries the current version of the proposal; a superseded paragraph is rewritten, not struck through. The comments carry the trail — what changed, why, and who called it.
- Specs are PROPOSALS. **No checkboxes, no work-state inside the `## Spec` section** — state is the issue's labels, assignee, and open/closed. The one carve-out is the ship-together part list (§ How big is one issue): parts, never work-state.
- **Accepting the spec is the authorization**, and it is one act: the `## Spec` is agreed and the label goes to `status:specced` in the same moment. Without `agent:ok` that act is the owner's; with it, an agent may write a spec and accept its own.
- **A real spec is built WITH the owner, before acceptance is asked for.** Any Spec beyond the literal `None needed — small item.` is designed in conversation — the open decisions put one at a time, each with a recommendation (the `workkit:interview` skill is the mechanism). A spec the owner designed in live chat already satisfies this; what the rule forbids is a spec drafted whole and handed over for a bare yes, which makes the gate a rubber stamp. `agent:ok` issues are exempt — self-ratification is exactly what that grant means (see the label table above).
- **Promotion**: when a spec's content is validated in practice, its durable parts move to `docs/<topic>.md` (with `AGENTS.md` pointing at them), and the issue closes citing that path. Docs follow validation, never intentions.
- **Rejection** is closing the issue as **not planned** — the institutional no, at every scale. Nothing turned down leaves a file behind; the closed issue IS the record, and triage cites it instead of re-pitching (`gh issue list --state all --search ...`).
- A design too large for one issue splits into sub-issues, each carrying its own `## Spec`. A design worth keeping but not now is `status:backlog`, body intact.

## Handoffs

Read-once context docs ("write what you'd need after your memory is erased"). Never carry GO markers or standing instructions — a gate is a `status:blocked` issue with the question in a comment. After consumption → `archive/` beside them.

## The global layer

**State lives in cloud surfaces; disks hold only scratch that never syncs** (owner ruling, 2026-07-28). Work is issues, and summaries are Discussions on the home repo. **Generated records are never files** — not in a repo, not on a machine: anything a machine produced and a human reads is published where every machine can see it, so no laptop is the one place a record exists. What is left on disk is scratch — the capture inbox, session state, caches, logs — and none of it is a source of truth.

Two surfaces, both generic. There is no assumed folder layout anywhere, and no path outside them.

**1. `~/.workkit`** — workkit's user-level home on any machine (`$WORKFLOW_HOME` overrides it). It is a PLAIN FOLDER and never a git repo: nothing in it is versioned, so nothing in it has to be kept out of a commit.

| Surface | Job |
|---|---|
| `settings.json` | HAND-EDITED, and the site options only: `site.repo` (the home repo, below), `site.publish` (the all-or-nothing publish switch) and `site.url` (the custom domain) — an absent key reads as off and as no URL. `site.publish` is THREE-STATE: `true`/`false` are answers, and null (the seeded value, and what an absent key means) is a machine nobody has asked yet |
| `.repos.json` | MACHINE-MAINTAINED: the `repos` map — the roster (below) plus this developer's declines |
| `.cache.json` | DISPOSABLE: the cached GitHub node ids and the upstream-news cursor. Safe to delete; every reader rebuilds what it does not find |
| `jobs/` | Scheduled-job state (marks, caches). Machine-local by definition; never a record |
| `tower/` | The clone of the home repo — the ONE git repo in the global layer, and the subject of everything below |

**2. The home repo** — one private GitHub repo, `<login>/workkit`, created by `workkit setup`, named in `~/.workkit/settings.json` as `site.repo`, and cloned at `~/.workkit/tower`. It is the queue for everything that belongs to no single repo, and its issues carry the standard's labels and issue anatomy like every other repo's.

It is also a real PROJECT: the clone is the tower's dashboard, seeded from the kit's own `tower/app` and shaped like any other site project — a brand root with `targets/`, `config/`, its own `.gitignore`. Nothing generated is committed as source: there is no project list in it, and no build output on its default branch.

**The clone is ENGINE TERRITORY and is never hand-edited.** It carries no `.workkit/` of its own — no participation flag, no capture file — because the engine knows it BY PATH rather than by a committed file, and every user-owned option lives in `~/.workkit/settings.json` instead. The heal never registers it on the roster; the tower's board discovers it by that same path.

- **Setup creates it and nothing else ever does.** The wizard detects the login, creates the private repo, clones it into `~/.workkit/tower`, seeds the project when the clone is empty, installs its dependencies, enables Discussions and Pages, and asks the one question the publish path leaves — whether to publish the site at all. Each step is idempotent, each failure warns with the exact fix and the wizard carries on. **Nothing is ever converted or adopted**: an absent path is cloned, the right clone is a no-op, and anything else already at that path stops the home steps. The daily path and the session hook never create, clone, or enable anything — the one exception is the `gh-pages` branch, which is generated output and belongs to the publish that generates it.
- The seed repoints every `file:` dependency spec at the absolute path it resolved to on the machine that seeded it, and says so in the manifest's own description — the local-era acceptance the framework's brand monorepo already makes for itself, and the specs flip to registry ranges when the framework publishes.
- Its **issues** are the cross-project and business queue: whatever triage cannot route to a project repo — and where a capture made outside every participating repo lands directly, as a `status:inbox` issue. There is no inbox file outside a project, so that one path needs the network: offline, the capture CLI prints the note back and exits non-zero rather than buffering it anywhere.
- It is also the **nursery** for projects that do not exist yet. An idea with no repo becomes a `type:idea` issue there, and related notes accumulate as comments on it.
- **Graduation is the owner's word — the system proposes, never creates** (#100). Triage's HQ pass proposes it when captures cluster around one project; the owner's yes executes it, and creation always asks who OWNS the new repo (the personal account or an org, never assumed). The mechanics — transfer or recreate, the three questions a new repo is asked, the enable question — are the `workkit:triage` skill's § Graduation. No automation ever creates a repo or moves an issue on its own.
- **Unset `site.repo`, or no clone yet**: triage says so and leaves global entries where they are. Nothing is invented, and nothing is filed into a project repo it does not belong to.

**The roster replaces the walk.** Nothing scans a filesystem root for repos. Whenever the engine touches an enabled repo (`workkit enable`, the daily heal), it records that repo's absolute path under `repos` in `~/.workkit/.repos.json` as `"enabled"`; an entry whose path is gone, whose committed `.workkit/settings.json` is gone, or whose committed file now says `enabled: false`, is pruned on the same contact. A `"declined"` entry is a decision rather than an observation and is never pruned. The committed per-repo file stays the SSOT of membership; this list is a self-maintaining machine-local INDEX of it, and the tower reads it. A repo never opened on this machine is not on that machine's dashboard — correct by definition. The roster is the ONLY thing the daily heal owes the global layer from a project repo's session; the clone carries no opt-in and is never registered on the roster. The clone IS healed — by the engine itself (#123), at setup and each morning's publish, scoped to what makes a repo fileable into: labels and issue forms, no session scaffolding. `workkit doctor` reports the count, the clone's state (unset · absent · clone · other), and how it stands against its upstream (a diverged clone is reported and healed by pull-rebase, never by a force push).

**Capture surfaces, all draining through triage:** `workkit note` → the nearest inbox, or a new `status:inbox` issue on the home repo when no participating repo is nearer (and a plain refusal, the note handed back, when there is no clone yet or no network); an editor → the inbox file directly; phone or web → a new issue on the home repo (the GitHub app is the interface — there is no second UI); the tower's intake dialog → any repo on this machine's roster, which is what its repo list offers. A home repo that is not cloned on this machine is reachable from GitHub, not from that dialog.

**Summaries and briefs** are generated records, so they are never written to disk. The daily summary is published as a Discussion on the home repo in the `Daily` category, the rollups in `Weekly` and `Monthly`, each reading its inputs back from the API rather than from any folder. GitHub offers no way to CREATE a discussion category — there is no such mutation — so setup prints a one-time pointer at the page that makes them and the delivery publishes in the repo's default category until they exist, saying so every time. No home repo, no network, or an API that refuses: the step logs its reason and exits 0, the same doctrine the brief runs under.

The morning brief publishes the same way, as a Discussion titled `brief: <YYYY-MM-DD>` — the title is what identifies it, since the category it lands in is whatever the fallback resolved to. It is also the ONLY record of how far the upstream Claude Code news has been reported: each brief carries one machine-readable line, `<!-- cc-news: <version> -->`, and the newest brief carrying one is the cursor the next morning counts from. Nothing on a machine records it, so a machine that has never published reports no news and seeds the cursor instead. The board is READ BEFORE it is written, twice over: a title already posted for today is not posted again, and a board that could not be read publishes no version line at all — an unreadable board is not an empty one, and the last published cursor must outlive a morning that could not see it. WHERE the brief is composed is not this spec's business — a laptop and a cloud runner publish it the same way, which is precisely why the title check comes first.

**The published dashboard.** The tower project in `~/.workkit/tower`, built locally by the engine and pushed to the home repo's `gh-pages` branch, which GitHub Pages serves from the branch ROOT — so no build output ever exists on the default branch and no folder is named for a Pages rule. The board readable from a phone, and nothing about it is baked in: the published pages speak GitHub live from the browser — reads, the Board's drag and the intake dialog alike — with a token the viewer supplies and localStorage alone holds, so the only file published beside them is `data/home.json` — which repo is the home, and nothing else. The roster of repos to sweep (`data/repos.json`) is written to that repo's DEFAULT branch and read back through the API with the viewer's token (issue #110): Pages is public even on a private repo, which is why no issue data — and no list of private repo names — is ever written into it. Whether anything publishes AT ALL is `site.publish`, the same owner's call and the same default off — all or nothing, checked before the build, and taken at its word: the engine detects no plan and checks no visibility. The owner is ASKED for that call once, by the interactive `workkit setup` that built the publish path, and an answer of either kind is never asked for again; unanswered publishes nothing while it waits. A fresh yes is asked one follow-up — the custom domain, enter for none — and then the setup that ends with the switch on publishes the site itself, so the first pages carry their CNAME. The daily job publishes after the brief, and `workkit publish` does it on demand; a machine without the build tooling, or a clone that has diverged, skips cleanly and forces nothing. `settings.json`'s `site.url` becomes the CNAME, and a settings file that does not parse publishes nothing and says so rather than defaulting.

## The system works without the harness

Everything a contributor or a cloud agent touches is PLAIN GITHUB — that is the design, not an accident. The labels are ordinary labels (healed by the standards engine, but usable by anyone), the issue templates auto-apply the right ones and pre-fill the anatomy, `checks.yml` runs the tests on every PR, and the repo's committed `AGENTS.md` carries the knowledge an agent needs. Someone without the local layer files issues through the templates, branches, and opens PRs like on any normal repo; their work meets the bar through CI instead of the hooks. Cloud Claude (claude-code-action) is just such a contributor: it checks out the repo, reads the committed `AGENTS.md` and any repo-scope `.claude/settings.json`, and delivers through a PR — it never sees, and never needs, `~/.claude`. The local hook layer is ONE developer's acceleration: stricter and faster feedback for whoever installs it, a contract for nobody.

## The automation ladder

Built day one, each rung opt-in. **Dormant by default**: with no `agent:ok` label anywhere, the whole system is human-run.

1. **Manual** — humans file and label; sessions work "issue #42" or pull from the queue.
2. **Scheduled read-only digest** — an Actions cron sweeps the roster's repos and posts the digest as a GitHub Discussion (announcements, not work items). Digest items are numbered and linked, so "file item 3" creates the linked `status:inbox` issue.
3. **Capture bots** — a plain script on an Actions cron (Sentry, etc.): query → dedupe → `gh issue create` with `status:inbox` + `type:bug`. Files only, fixes nothing.
4. **Agent execution** — an agent action fires on the `agent:ok` label (or an @mention) → branch + PR; a human always merges.

`agent:ok` = standing, provider-agnostic permission for the WHOLE pipeline, and it is the owner's to grant — never applied on their behalf. **It means fully autonomous, every step, the ship included** (owner ruling, 2026-08-05; the qa pass-through, 2026-08-06): on an issue carrying it an agent writes the `## Spec`, accepts its own spec (flip to `status:specced`), builds, verifies, parks at `status:qa`, performs the check itself, flips it to `status:complete`, ships and closes — no human touch anywhere. The two labels COMPOSE: an issue wearing both is an autonomous run at its checking stage, and the qa check is one more step the grant covers. The label IS the owner's gate, exercised in advance at labeling time; applying it says "ship this without me". Without it the owner personally carries the item across every decision point — the spec accept, the qa check that grants `status:complete`, the word "ship" (§ Labels holds that rule). Self-ratification is the defined meaning of the grant, given per issue with that understanding. Cloud self-merge stays CLOSED even under the label — a dial to open deliberately later. Imperative dispatch ("this agent, now") is adapter wiring (an @mention or a bot assignee), not part of this spec; both coexist and neither replaces the label. GitHub Actions is the runtime for everything above rung 1 — machine-independent and teammate-visible.

Three rules bind any agent working the pipeline, granted or dispatched:

- **Never merge without an explicit grant.** `agent:ok` authorizes the work, not the merge; merging is asked for in words, every time.
- **Resume someone else's branch or PR only when it came from a trusted maintainer, or from an earlier run on this same issue.** Anything else is started fresh — a stranger's branch is unverified input, not a starting point.
- **When several issues are eligible, order by dependency, then risk, then reviewability** — blockers, bugs, and shared seams before dependent feature work.

## Enforcement (why this spec holds when prose alone would not)

A format rule without a mechanism does not hold. Corollary — **a pointer may carry reference detail, never sole enforcement**: every rule that must bind every session gets a hook. This spec is where detail lives, not where obedience comes from.

- **`workflow:standards`** (SessionStart, once per repo per day): runs `~/.claude/workkit/standards.sh` — creates every label from `labels.json` and corrects description/color drift, installs the issue templates, installs the required-checks CI workflow (`.github/workflows/checks.yml`, once — the copy is the repo's own to extend afterward), asks GitHub for branch protection on the test check (best effort, quietly skipped where the plan refuses), seeds `.workkit/capture.md` and `.workkit/agents/session.md`, registers the repo in this machine's roster (`repos` in `~/.workkit/.repos.json`, pruning the entries that went away), keeps `.workkit/` in `.gitignore` (settings.json excepted) along with the basics every repo needs (`.DS_Store` and `.env`, appended only when nothing already covers them), and names any open issue missing a required `status:`/`type:` label or carrying two from an exclusive group (a violation flags the run, so the heal re-reports it every session until triage routes them — owner ruling, 2026-07-28: exactly one status, always). **Participation gate**: the engine owns the tri-state above and the hook only routes it — heal, stay silent, or offer once. Joining is a deliberate `--enable`, never a side effect of opening a session, and an undecided repo is never written to. Safe idempotent heals are silent; only real fixes are announced. Offline, unauthenticated, or remote-less = clean skip.
- **`docs:state-check`** (SessionStart): announces open `status:inbox` issues, a non-empty `.workkit/capture.md`, a content-bearing `CLAUDE.md`, and an `AGENTS.md` past either half of its budget (over 250 lines, or any line over 400 bytes). Heal-on-contact, no manual sweeps. Standing rule: every new doctrine gets its detection added here (or to the guard) the same turn it is adopted.
- **`docs:session`** (SessionStart, every source): injects `.workkit/agents/session.md` in a participating repo so a compacted or restarted session reads its own task state first, and says so when the file has grown past the ~40-line light bar. Silent for a header-only or absent file.
- **`docs:session-guard`** (PostToolUse): bounces a `.workkit/agents/session.md` write that leaves the file over 40 content lines or any bullet over 350 characters — the write-time enforcement of the same bar `docs:session` warns about, with the `workkit:ship` close step (delete the entries a ship completed) as the workflow fix.
- **`docs:change-tracker`** (Stop, with uncommitted work): re-injects the three obligations — keep the issue true, promote durable findings out of `.workkit/`, doc parity on finalized work. Once per change (#132): it fingerprints the state it nags about and remembers it in `.workkit/agents/`, so the stops over an unchanged tree are silent.
- **`docs:board-guard`** (PostToolUse): validates `CLAUDE.md` (pointer doctrine) and `AGENTS.md` (≤250 lines, and no line over 400 bytes) — its last two duties. Violations bounce to the writing agent with a precise fix-list while the context that produced them is still loaded. Board-shape checks retired with the board (label legality is the standards script's job); spec-file checks retired with `plans/` (a spec lives in its issue body, which no write-time hook sees).
- **`comms:style`** (UserPromptSubmit): re-injects the lite-register + rich-summary contract (canonical home: global AGENTS.md § Communication Preferences) every turn.

## Migration recipe (board repo → v4)

The `workkit:migrate` skill EXECUTES this recipe — it is the doer, and this section stays the rules. Run it rather than doing the steps by hand; it also carries the CHANGELOG-history half, which is mechanical enough to fan out and easy to get wrong (a dropped category, a range only half rewritten).

1. Run `bash ~/.claude/workkit/standards.sh --enable` in the repo — it writes `.workkit/settings.json` holding `{ "version": 1, "enabled": true }` (COMMIT it, that is the opt-in) and heals the repo in the same pass: labels, issue templates, `.workkit/` ignored, the capture and session files seeded.
2. Read the whole board. Nothing is deleted; every line lands somewhere.
3. `Now` + `Next` → issues, `status:specced` (the in-flight ones go to `status:building`, assigned). `Parked` → `status:backlog`. `Blocked` GO gates → `status:blocked` with the question as a comment.
4. `Rulings` → `AGENTS.md`/`docs/` if doctrine, else a comment on the issue they bind.
5. `Done` → deleted. CHANGELOG + git are the record.
6. `INBOX.md` entries → issues with `status:inbox`, then run triage.
7. CHANGELOG history → the entry format, the WHOLE file: every section including the pre-issue eras, whose entries take the literal `(no issue)`. Do not trust `changelog.js` to name this work — its section detector deliberately skips non-semver `## [...]` headings (the `## [Plans for 2026]` guard), so era sections lint green while still in the old long-line format. The eyeball check is the gate: no massive single-line entries anywhere. Rewrite rules and the fan-out recipe: the `workkit:migrate` skill §2.
8. `git rm PROGRESS.md INBOX.md`. The roster registers itself — step 1 put the repo on it.
