# Project State Spec (v4) — issues · workflow · attic · HQ

> The ONE definition of how project state is captured, tracked, and cleaned across every repo.
> Provider-agnostic: GitHub Issues + plain markdown + JSON + git. Agents of any provider implement it; Claude adapters = the `workkit:triage`, `workkit:whats-next`, `workkit:ship`, `workkit:migrate` skills + the `workflow:standards`, `docs:state-check`, `docs:change-tracker`, `docs:board-guard`, `docs:changelog-guard` hooks.
> **v4 is the only format. No backwards compat.** `PROGRESS.md` (the board) and `INBOX.md` are RETIRED — work-item state lives in GitHub Issues. Migration recipe at the bottom.

## The model

| Job | Home | Committed? |
|---|---|---|
| Work items — capture, queue, findings, per-item decisions | **GitHub Issues** (comments carry the trail) | Cloud (the SSOT) |
| Per-repo workflow opt-in + config | **`.workkit/settings.json`** in the repo | Yes — the project's answer |
| Per-developer decisions about repos (declined, never asked) | **`~/.workkit/settings.json`** (`$WORKFLOW_HOME` overrides) | Never into a PROJECT repo — it is one developer's file. Track it in your own dotfiles if you want declines to survive a new machine; the engine creates it on first run either way, with an empty `repos` map |
| Per-developer, per-session working state | **`.workkit/`** in the repo, everything but `settings.json` gitignored | Never |
| How the system works (doctrine, durable rules) | `AGENTS.md` + `docs/<topic>.md` | Yes |
| Shipped record | `CHANGELOG.md` + git + Releases | Yes |
| "Removed but not gone" | `_attic/` — gitignored FOLDER; evicted files keep their names (`_attic/CLAUDE.proposed.md`), harvested scraps go to topical files (`_attic/inbox.md`) with a `from <path>, <date>, <why>` header line. Attic contents are NEVER source material for doctrine (owner ruling, 2026-07-20) — harvest facts only from live sources | Never |

- The queue is a QUERY, never a file: `gh issue list`. Nothing about work state is stored in the repo.
- **Promotion rule**: anything durable — a finding, a decision, a blocker — is promoted to its issue as a comment the moment it exists. `.workkit/` holds only in-flight session state; it is private per developer, so nobody else ever reads it. It is a routing stop, never a destination.
- **Participation is a tri-state, split across the two settings files.** Only a real yes (or a deliberate project-level no) belongs in the repo; never-asked and declined are personal (owner ruling, 2026-07-24) — a teammate reading `enabled: false` in a shared repo would take it for the project's decision when it was one developer undecided.

| Repo state | What happens |
|---|---|
| Committed `.workkit/settings.json` with `"enabled": true` (or no `enabled` key — a file that predates it is still a yes) | Healed as usual |
| Committed `.workkit/settings.json` with `"enabled": false` | Silent. The project turned it off on purpose |
| No committed file, no record in `~/.workkit/settings.json` | One line per session offering to enable. **Nothing is written into the repo** — no stub settings.json, no `.gitignore` line, no templates |
| No committed file, `repos["<absolute repo root>"] == "declined"` in the user file | Silent, forever |

  **The standard version.** `settings.json`'s `version` records which standard a repo was last healed to, and `standards.sh` carries the current one — so "does this repo need attention?" is an integer compare, not a scan. A repo below the current version also gets a DRIFT REPORT naming what it still carries from a retired convention (`PROGRESS.md`, `INBOX.md`, `TODO.md`, `plans/`, a CHANGELOG whose entries are not in the entry format), then has its version stamped forward once the mechanical heals succeed. The report never acts: deleting a retired file deletes work items nobody migrated, and rewriting CHANGELOG prose needs judgment — both are a human's call, and the report says which skill to run.

  Both answers are deliberate commands, never a hook's doing: `bash ~/.claude/workkit/standards.sh --enable [repo]` writes the committed `{ "version": 1, "enabled": true }` and then heals; `--decline [repo]` records the repo under `repos` in the user file (writing only that key, leaving every other key and value intact). The gitignore pattern in a participating repo is two lines: `.workkit/*` then `!.workkit/settings.json`.

  **Other systems may add their own key.** The top-level keys above (`version`, `enabled`, `repos`) belong to this spec; a separate system claims a separate key and leaves them alone. The one in use today is `manager`, carrying per-repo overrides for the Claude harness's manager system (agent model tiers, and an `enabled` of its own) — a Claude-harness concern, documented in `~/.claude/hooks/README.md`, with no effect on the issue workflow.
- **Rulings split by scope**: project doctrine → `AGENTS.md`/`docs/`; per-item calls → a comment on that issue.

## Pointer doctrine (CLAUDE.md → AGENTS.md)

Repo instructions live in `AGENTS.md` (provider-agnostic); `CLAUDE.md` is exactly one line — a bare `@AGENTS.md` import. `AGENTS.md` itself stays ≤250 lines — it is the architectural overview; deep references live in `docs/<topic>.md` and AGENTS.md points at them. Both rules enforced at write time by the `docs:board-guard` hook.
- New repo: create `AGENTS.md` first, then the one-line `CLAUDE.md` pointer.
- Existing content-bearing `CLAUDE.md` — convert the first time you touch it, in TWO commits: `git mv CLAUDE.md AGENTS.md`, commit, THEN add the pointer `CLAUDE.md` in a SEPARATE commit. A pointer in the same commit breaks git's rename detection (`log --follow`/blame lose the history).

## Labels — the universal state machine

**Every label is `group:value`.** Values are single lowercase words, never hyphenated. The set is identical in every participating repo. The machine SSOT is `~/.claude/workkit/labels.json` (groups, values, descriptions, colors, and each group's `exclusive`/`required` rules); the standards script creates the labels from it AND writes each label's GitHub description from it — so `gh label list` teaches the vocabulary to any human or agent with no harness at all.

| Label | Meaning |
|---|---|
| `status:inbox` | Captured, nothing authorized. Raw notes, half-thoughts, and accepted-but-unspecced items all sit here. Triage is the ACTION that drains it, not a state. |
| `status:specced` | The issue's `## Spec` is written AND accepted. The label flip IS the authorization to build — the only stage builds start from. |
| `status:blocked` | Waiting on a human decision — the question lives in the issue body or a comment. |
| `status:parked` | Kept on purpose, not now. |
| `type:bug` · `type:enhancement` · `type:idea` | What kind of thing it is — exactly one per open issue, like `status:`. Applied by the issue templates at capture (a dump is `type:idea`); rarely changes. (Native GitHub issue types are org-only, so labels carry this.) |
| `priority:high` · `priority:low` | Order within the queue. **Absence = normal** — there is no `priority:normal` label. |
| `agent:ok` | An agent may work this issue autonomously, at every stage. Absence means humans only. |
| `agent:working` | An agent has this issue claimed. The agent applies it at claim time, alongside assigning itself, and removes it at release. It is the marker that tells an agent claim from a human one — agents run `gh` as the owner, so the assignee cannot. The standards heal releases a claim idle for 24 hours. |

- **Exactly one `status:` label per open issue.** Every relabel removes the old one in the same command: `gh issue edit <N> --remove-label status:inbox --add-label status:specced`.
- The four groups are orthogonal and compose: `status:specced` + `priority:high` + `agent:ok` on one issue is legal and means exactly what it says.
- `area:*` is deliberately NOT bootstrapped — it is project-specific; a repo adds its own if it wants one. Adopt a group deliberately, never speculatively.
- **A retired label migrates itself.** `labels.json` carries a `migrations` map (old label → new); the standards heal moves every issue carrying an old label, open and closed, to its replacement and then deletes the old label. `status:spec` and `status:queued` are the entries in it today.

**The statuses read as a PIPELINE** — intent to implemented: `status:inbox` → `status:specced` → build → verify → ship → closed against the CHANGELOG entry, with `blocked` and `parked` as side pockets. Status labels name WAIT states; the working stages have no label of their own — the issue stays `status:specced` while the work runs, and the assignee marks it in flight.

The one gate is the flip from `inbox` to `specced`, and it is a deliberate act: it says the `## Spec` is written, it is accepted, and building this is now authorized. Nobody flips it casually. A small item is specced the moment someone accepts it with the literal Spec `None needed — small item.`; a large one is specced when its implementation layer is written and accepted. "Accepted but not yet specced" is deliberately NOT a visible stage — it stays `status:inbox`, with a triage comment or a `priority:` label carrying that signal. The `workkit:feature` skill refuses to build an issue that is not `status:specced`. The visual map — the road and the crew that works it — is in the [README](../README.md).

## Capture

Three surfaces, all converging on issues. There is no other store.

1. **Issue templates** (`.github/ISSUE_TEMPLATE/`: bug · enhancement · idea · dump) — markdown templates that pre-fill the body with the issue anatomy (`## Description` then `## Spec`) and auto-apply `status:inbox` + the `type:` label, so a first-day teammate files a correctly shaped issue from the web or phone.
2. **A dump issue** — one issue holding a wall of mixed notes. The template stamps it `type:idea` (every issue carries exactly one `type:`); triage reads the body and fans it out.
3. **`.workkit/inbox.md`** — the local, gitignored free-form dump for offline moments. Triage drains it into issues the same way. The standards script creates it empty (with its capture header) so dumping is always zero-friction; it never overwrites one that has entries.

**`.workkit/session.md`** sits beside the inbox — the session's own scratchpad, created by the standards script from a fixed template and never overwritten once it has content. Three sections, always the same: `## Active` (the one issue being worked), `## Queue` (what comes next, in queue order), `## Notes` (scratch — durable findings are promoted to their issue as a comment before stopping). One file named for the session, not for a task, so it is found and updated instead of rotting.

## Issue anatomy

Every issue body has the SAME two sections, always present, always in this order (owner ruling, 2026-07-24: one enforced structure so every issue reads the same):

| Section | Holds |
|---|---|
| `## Description` | What the thing is and why, in prose — never restating the title. Background, evidence, links, and success criteria all live here. |
| `## Spec` | How it will be built — the editable, single-current-version part. Specs are for BIG items; a small item's Spec is the literal line `None needed — small item.` An agent that picks up a "None needed" issue and finds real complexity writes the spec in before building. Accepting what is written here is what earns `status:specced`. |

The body is the current version of the thinking; comments are the trail of how it got there.

The issue templates in `.github/ISSUE_TEMPLATE/` pre-fill exactly this anatomy, so every issue conforms from the moment it is filed — no rewriting at triage.

## How big is one issue

**One issue = one thing that ships at one moment.** Size is not the test — a large piece of work that lands as a single release is one issue. The test is whether the parts would ever need DIFFERENT states at the same time. Cut VERTICAL slices where it makes sense: an issue that runs thin through the whole stack (schema, backend, UI, test) and works end to end beats one horizontal layer that proves nothing on its own. An issue carries exactly one `status:` label and closes against one CHANGELOG entry, so parts that disagree about their state cannot share a row (owner ruling, 2026-07-24).

| The parts... | Shape |
|---|---|
| always ship together | ONE issue; list the parts as a checklist in the Spec |
| serve one goal but ship separately, each needing its own state | a PARENT issue with GitHub sub-issues (`gh issue edit <child> --add-parent <N>`) — a checkbox cannot hold a status label, a sub-issue can |
| share only a theme | SEPARATE issues, no parent |

Sub-issues are also the dependency mechanism: work that waits on OTHER WORK stays `status:specced` under its parent — the open siblings say what comes first, and each child is a real issue the queue query can see (a checkbox is not). `status:blocked` stays reserved for waiting on a human decision. A checklist line can be converted to a sub-issue from the GitHub UI the moment it turns out to need its own state, so starting small costs nothing.

**A later idea is always its own issue** — never appended to an existing one, however related (owner ruling, 2026-07-26). Two MCP integrations decided days apart are two issues: they ship at different moments, which is the whole test. Add a `relates to #N` line when the connection matters; merge two issues only on deciding they will ship as one; reach for a parent only when separate shipments serve one coordinated goal, never for taxonomy.

The smell: an issue you cannot answer yes to, because yes would approve a part you have not decided. Split it. Bundling by theme produces an issue that can never carry a true status and can never close — #2 bundled four unrelated designs behind a chapter number from a retired plan file and blocked all four for days.

## Triage — the action that drains the inbox

Every entry is routed to exactly ONE home: a comment on an existing issue · a new routed issue · an hq issue (cross-project) · another repo's issues · `docs/`/`AGENTS.md` (a durable fact) · `_attic/inbox.md` (kept but rejected).

- **Search first, open AND closed** (`gh issue list --state all --search ...`). A closed **not planned** issue is the rejection record — cite it instead of re-pitching.
- **The Filed trail is mandatory**: triage ends by printing `Filed:` — one line per entry → its destination. On a dump issue, that trail is the closing comment. Capture is only trusted when filing is visible.
- **Route by authorization, not by enthusiasm**: `status:specced` is only for work whose `## Spec` is written and accepted (a small item's accepted Spec is the literal `None needed — small item.`). Anything still needing design stays `status:inbox` with whatever spec exists drafted into `## Spec` or a comment — accepting it later is its own act.
- Detection is automatic (the `docs:state-check` hook announces open `status:inbox` issues and a non-empty `.workkit/inbox.md` at session start); filing stays deliberate. Full playbook: the `workkit:triage` skill.

## Queue semantics

- **Working** = the issue is assigned (no label for it). Your queue is `gh issue list --assignee @me`.
- **Done** = closed `completed`. **Rejected** = closed `not planned` — the institutional no, and the thing triage cites.
- Queue order: `priority:high`, then unlabeled (= normal), then `priority:low`. GitHub has no manual ordering; `priority:` is the substitute.
- **Within one priority, order by dependency, risk, and reviewability** — blockers first (work other issues wait on), then bugs, then shared seams (the file or module several queued items all touch), and only then dependent feature work. A seam changed once is reviewed once; changed under three features in flight it is reviewed three times and merged badly. This is the order the autonomy loop uses to pick its next item, and the order the `workkit:whats-next` digest reports in.
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
- Specs are PROPOSALS. **No checkboxes, no work-state inside the `## Spec` section** — state is the issue's labels, assignee, and open/closed.
- **Accepting the spec is the authorization**, and it is one act: the `## Spec` is agreed and the label goes to `status:specced` in the same moment. Without `agent:ok` that act is the owner's; with it, an agent may write a spec and accept its own.
- **Promotion**: when a spec's content is validated in practice, its durable parts move to `docs/<topic>.md` (with `AGENTS.md` pointing at them), and the issue closes citing that path. Docs follow validation, never intentions.
- **Rejection** is closing the issue as **not planned** — the institutional no, at every scale. Nothing turned down leaves a file behind; the closed issue IS the record, and triage cites it instead of re-pitching (`gh issue list --state all --search ...`).
- A design too large for one issue splits into sub-issues, each carrying its own `## Spec`. A design worth keeping but not now is `status:parked`, body intact.

## Handoffs

Read-once context docs ("write what you'd need after your memory is erased"). Never carry GO markers or standing instructions — a gate is a `status:blocked` issue with the question in a comment. After consumption → `archive/` beside them.

## HQ (the global layer)

One HQ = one world (a company, a client). A plain git repo:

| Surface | Job |
|---|---|
| `projects.json` | The registry: `[{ "name", "path", "about", "status": "active\|parked" }]` — how any agent, job, or dashboard finds every project |
| hq **issues** | Cross-project + business capture: whatever belongs to no single repo. Triage routes entries OUT into project repos. Needs hq's own remote — tracked as issue #8 |
| `handoffs/` (optional) | Cross-repo handoff docs |

**HQ never copies project state** — it indexes (the registry) and holds only what belongs to no single repo. Cross-project views ("what's next everywhere", the dashboard) are generated on demand by walking `projects.json` → each repo's issues; never stored.
Rule of thumb: prose = `.md`, index = `.json`. Multi-tenancy = multiple HQs, never multi-tenant files.
HQ is a repo like any other, kept wherever the projects it indexes are — `<repos-root>/<owner>/hq` is the shape, not a required location.

## The system works without the harness

Everything a contributor or a cloud agent touches is PLAIN GITHUB — that is the design, not an accident. The labels are ordinary labels (healed by the standards engine, but usable by anyone), the issue templates auto-apply the right ones and pre-fill the anatomy, `checks.yml` runs the tests on every PR, and the repo's committed `AGENTS.md` carries the knowledge an agent needs. Someone without the local layer files issues through the templates, branches, and opens PRs like on any normal repo; their work meets the bar through CI instead of the hooks. Cloud Claude (claude-code-action) is just such a contributor: it checks out the repo, reads the committed `AGENTS.md` and any repo-scope `.claude/settings.json`, and delivers through a PR — it never sees, and never needs, `~/.claude`. The local hook layer is ONE developer's acceleration: stricter and faster feedback for whoever installs it, a contract for nobody.

## The automation ladder

Built day one, each rung opt-in. **Dormant by default**: with no `agent:ok` label anywhere, the whole system is human-run.

1. **Manual** — humans file and label; sessions work "issue #42" or pull from the queue.
2. **Scheduled read-only digest** — an Actions cron sweeps `projects.json` repos and posts the digest as a GitHub Discussion (announcements, not work items). Digest items are numbered and linked, so "file item 3" creates the linked `status:inbox` issue.
3. **Capture bots** — a plain script on an Actions cron (Sentry, etc.): query → dedupe → `gh issue create` with `status:inbox` + `type:bug`. Files only, fixes nothing.
4. **Agent execution** — an agent action fires on the `agent:ok` label (or an @mention) → branch + PR; a human always merges.

`agent:ok` = standing, provider-agnostic permission for the WHOLE pipeline, and it is the owner's to grant — never applied on their behalf. On an issue carrying it an agent may write the `## Spec`, accept its own spec (flip to `status:specced`), build, and ship. Self-ratification is the defined meaning of the grant, given per issue with that understanding; without the label every flip is the owner's. Imperative dispatch ("this agent, now") is adapter wiring (an @mention or a bot assignee), not part of this spec; both coexist and neither replaces the label. GitHub Actions is the runtime for everything above rung 1 — machine-independent and teammate-visible.

Three rules bind any agent working the pipeline, granted or dispatched:

- **Never merge without an explicit grant.** `agent:ok` authorizes the work, not the merge; merging is asked for in words, every time.
- **Resume someone else's branch or PR only when it came from a trusted maintainer, or from an earlier run on this same issue.** Anything else is started fresh — a stranger's branch is unverified input, not a starting point.
- **When several issues are eligible, order by dependency, then risk, then reviewability** — blockers, bugs, and shared seams before dependent feature work.

## Enforcement (why this spec holds when prose alone would not)

A format rule without a mechanism does not hold. Corollary — **a pointer may carry reference detail, never sole enforcement**: every rule that must bind every session gets a hook. This spec is where detail lives, not where obedience comes from.

- **`workflow:standards`** (SessionStart, once per repo per day): runs `~/.claude/workkit/standards.sh` — creates every label from `labels.json` and corrects description/color drift, installs the issue templates, installs the required-checks CI workflow (`.github/workflows/checks.yml`, once — the copy is the repo's own to extend afterward), asks GitHub for branch protection on the test check (best effort, quietly skipped where the plan refuses), moves a `.workflow/` left by the old name to `.workkit/` (once, and only in a repo whose committed settings.json is in it — the `.gitignore` lines are rewritten with it, and the rename is the human's to commit), seeds `.workkit/inbox.md` and `.workkit/session.md`, keeps `.workkit/` in `.gitignore` (settings.json excepted), and names any open issue missing a required `status:`/`type:` label or carrying two from an exclusive group (report-only — triage routes them). **Participation gate**: the engine owns the tri-state above and the hook only routes it — heal, stay silent, or offer once. Joining is a deliberate `--enable`, never a side effect of opening a session, and an undecided repo is never written to. HQ `projects.json` stays a pure registry. Safe idempotent heals are silent; only real fixes are announced. Offline, unauthenticated, or remote-less = clean skip.
- **`docs:state-check`** (SessionStart): announces open `status:inbox` issues, a non-empty `.workkit/inbox.md`, a content-bearing `CLAUDE.md`, and an oversized `AGENTS.md`. Heal-on-contact, no manual sweeps. Standing rule: every new doctrine gets its detection added here (or to the guard) the same turn it is adopted.
- **`docs:change-tracker`** (Stop, with uncommitted work): re-injects the three obligations — keep the issue true, promote durable findings out of `.workkit/`, doc parity on finalized work.
- **`docs:board-guard`** (PostToolUse): validates `CLAUDE.md` (pointer doctrine) and `AGENTS.md` (≤250 lines) — its last two duties. Violations bounce to the writing agent with a precise fix-list while the context that produced them is still loaded. Board-shape checks retired with the board (label legality is the standards script's job); spec-file checks retired with `plans/` (a spec lives in its issue body, which no write-time hook sees).
- **`comms:style`** (UserPromptSubmit): re-injects the lite-register + rich-summary contract (canonical home: global AGENTS.md § Communication Preferences) every turn.

## Migration recipe (board repo → v4)

The `workkit:migrate` skill EXECUTES this recipe — it is the doer, and this section stays the rules. Run it rather than doing the steps by hand; it also carries the CHANGELOG-history half, which is mechanical enough to fan out and easy to get wrong (a dropped category, a range only half rewritten).

1. Run `bash ~/.claude/workkit/standards.sh --enable` in the repo — it writes `.workkit/settings.json` holding `{ "version": 1, "enabled": true }` (COMMIT it, that is the opt-in) and heals the repo in the same pass: labels, issue templates, `.workkit/` ignored, inbox and session files seeded.
2. Read the whole board. Nothing is deleted; every line lands somewhere.
3. `Now` + `Next` → issues, `status:specced` (assign the in-flight ones). `Parked` → `status:parked`. `Blocked` GO gates → `status:blocked` with the question as a comment.
4. `Rulings` → `AGENTS.md`/`docs/` if doctrine, else a comment on the issue they bind.
5. `Done` → deleted. CHANGELOG + git are the record.
6. `INBOX.md` entries → issues with `status:inbox`, then run triage.
7. CHANGELOG history → the entry format, the WHOLE file: every section including the pre-issue eras, whose entries take the literal `(no issue)`. Do not trust `changelog.js` to name this work — its section detector deliberately skips non-semver `## [...]` headings (the `## [Plans for 2026]` guard), so era sections lint green while still in the old long-line format. The eyeball check is the gate: no massive single-line entries anywhere. Rewrite rules and the fan-out recipe: the `workkit:migrate` skill §2.
8. `git rm PROGRESS.md INBOX.md`. Register the repo in HQ `projects.json` if it is not there.

Remaining repos + HQ migrate under issue #8.
