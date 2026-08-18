# The hooks — what each one does

The behavior detail behind `AGENTS.md` § Hooks, which keeps one line per hook. The rules they enforce live in [`project-state.md`](project-state.md); this file describes how each hook executes them.

Three hooks carry a README of their own beside the script, and it is their deeper home: [`hooks/safety/tree-guard/README.md`](../hooks/safety/tree-guard/README.md), [`hooks/docs/session-guard/README.md`](../hooks/docs/session-guard/README.md), [`hooks/docs/change-tracker/README.md`](../hooks/docs/change-tracker/README.md).

## The index

One line per hook; the section below it carries the detail.

| Hook | Event | What it does |
|---|---|---|
| `workflow:standards` | SessionStart | The daily heal in a participating repo, the hook-layer self-check beside it, `workkit update --auto`, and the setup pester above every gate (#72) |
| `docs:state-check` | SessionStart | Announces open `status:inbox` issues, a non-empty `.workkit/capture.md`, broken pointer files, an AGENTS.md over its line or density budget |
| `docs:session` | SessionStart | Injects `.workkit/agents/session.md` — the queue a compacted session reads first — closing with one line for the manager and one for the owner (#134) |
| `workflow:reload-guard` | SessionStart + UserPromptSubmit | Nags once when a surface that loads at session start has changed — the case `/reload-plugins` exists for |
| `manager:resolver` | PreToolUse (Task/Agent) | Supplies each crew spawn's model from `manager/ladder.json` and the live session model |
| `manager:spawn-guard` | PreToolUse (Task/Agent) | Warns — never blocks — on a hand-passed spawn `model`, or a frontier session spawning the advisor |
| `manager:profile` | UserPromptSubmit | Injects the manager standing instruction in frontier/workhorse sessions only (#154) |
| `safety:vendor-guard` | PreToolUse (Edit/Write) | Blocks edits to generated, vendored, and gitignored files (`_attic/`, `.workkit/`, `.env*` excepted) |
| `safety:commit-gate` | PreToolUse (Bash) | Blocks a `git commit` the work is not ready for — tests, test files, review marker, CHANGELOG entry, the issue it closes (#151, #155) — and one the gate cannot place (#159) |
| `safety:commit-language` | PreToolUse (Bash) | Bounces kill/destroy/dead wording, and a subject line that is not Conventional Commits or carries a version outside `chore(release)` |
| `safety:tree-guard` | PreToolUse (Bash) | Blocks the git commands that DISCARD a shared working tree, with one deliberate escape (#157) |
| `safety:issue-guard` | PreToolUse (Bash) | Blocks a `gh` issue/PR/API write whose outbound text carries a local `.env` value or a token-shaped string (#83) |
| `safety:capture-guard` | PreToolUse (Read/Grep/Bash/Edit/Write) | Gates `.workkit/capture.md` in both directions — the owner's surface, whose one sanctioned touch is the triage drain (#145) |
| `docs:board-guard` | PostToolUse (Edit/Write) | Bounces `CLAUDE.md` / `AGENTS.md` writes that break the pointer doctrine, the 250-line budget, or the 400-byte density rule (#161) |
| `docs:changelog-guard` | PostToolUse (Edit/Write) | Bounces an added CHANGELOG entry that is an essay instead of one short linked paragraph |
| `docs:session-guard` | PostToolUse (Edit/Write) | Bounces a write that leaves `.workkit/agents/session.md` past either cap — a 350-char bullet or 40 content lines (#126) |
| `docs:change-tracker` | Stop | Nags once per change (#132) about uncommitted work, keeping the issue true, promoting findings, and unfiled captures |
| `manager:close-guard` | Stop | Warns — never blocks — when a frontier session did the bulk editing, or when worker output ended the turn with no verifier pass |

## How they are wired

- Registered in `hooks/hooks.json`, every command routed through `hooks/loader.sh`, so settings reference a hook by `prefix:name` rather than by a path.
- A LOADER-level failure fails open (exit 0). The hook's own exit code passes through untouched, which blocking hooks (exit 2) need.

## `workflow:standards` — SessionStart

- Runs the engine's heal in a participating repo, once per repo per day. What the heal writes: `workflow/README.md`. The standard it heals to: the spec § Enforcement.
- Adds the one check that is the hook layer's own — every wired hook resolves, is executable, parses, and the tools they call are present.
- Reports only what it fixed. An undecided repo hears one offer and is never written to.
- The same daily run calls `workkit update --auto`, the machine-side upkeep: it updates a schedule a human already installed and installs nothing fresh.
- Above every gate sits the setup pester (#72). A machine with no `~/.local/bin/workkit` is told, every session and in any directory, to have the user run `workkit.sh setup` — a prompt, never an install.

## `docs:state-check` — SessionStart

- Announces open `status:inbox` issues, a non-empty `.workkit/capture.md`, broken pointer files, and an AGENTS.md that breaks its budget.
- The AGENTS.md announcement covers both halves of that budget (#161): a file over 250 lines, and a file carrying any line over 400 bytes — the density rule, since a markdown paragraph is one source line. It names the rule and says `docs:board-guard` bounces writes until it fits.
- It measures in BYTES, pinned with `LC_ALL=C`, the same unit and the same pin board-guard uses.

## `docs:session` — SessionStart

- Injects a participating repo's `.workkit/agents/session.md` on every source — the task queue a compacted or restarted session reads first — and warns when it has grown past the light bar.
- Under a `---` rule that keeps them clear of the file's last heading, the injection closes with one line per reader (#134).
- The manager is told to open its first reply in plain words with the state above.
- The owner — who otherwise cannot see that anything survived — is told on the visible channel, a top-level `systemMessage`, that saying "continue" resumes the queue.
- Silent for a header-only or absent file, closing lines and owner line included.

## `workflow:reload-guard` — SessionStart + UserPromptSubmit

- Stamps the load-time surfaces at session start: `hooks.json` content, plus the `agents/` and `skills/` file list and mtimes.
- Injects one line when they change. Hook-script, skill-body, and engine edits are already live, so only these need `/reload-plugins`.
- Each change nags once.

## `manager:resolver` — PreToolUse (Task/Agent)

- Supplies each crew spawn's model from `hooks/manager/ladder.json` and the live session model. The crew contract: [`agents.md`](agents.md).

## `manager:spawn-guard` — PreToolUse (Task/Agent)

- Warns — never blocks — when a crew spawn carries a hand-passed `model` param, or when a frontier session spawns the advisor.

## `manager:profile` — UserPromptSubmit

- Injects the manager standing instruction in frontier/workhorse sessions only: delegate to the crew, keep the todo checklist current, announce each spawn (#154).

## `safety:vendor-guard` — PreToolUse (Edit/Write)

- Blocks edits to generated, vendored, and gitignored files. `_attic/`, `.workkit/` and `.env*` are excepted.

## `safety:commit-gate` — PreToolUse (Bash)

- Blocks `git commit` unless: tests pass, new source files come with test files, code carries a fresh review marker, any added CHANGELOG entry matches the format, and a commit closing an issue (`Fixes #N`) stages the entry it closes against.
- A stage-and-commit compound bounces (#155). A PreToolUse hook reads the index before the in-command `git add` runs, so it cannot see what the commit will carry — stage first, then commit.
- A check that stands down says so out loud, one visible line, instead of skipping in silence.
- The suite runs only for a commit carrying CODE (#151). A docs-only commit, and a version-only bump in the root `package.json` or `.claude-plugin/plugin.json`, stand it down.
- The suite run has its own deadline under the hook's declared timeout, so a suite the harness would cancel bounces the commit instead of slipping through.
- A commit the gate cannot PLACE bounces as well (#159): the `pushd`/`popd` spelling of the directory change, which used to walk past the `cd` test, and a session directory inside no repository at all — a background subagent's steady state, where the gate used to stand down entirely.

## `safety:commit-language` — PreToolUse (Bash)

- Bounces commit messages using kill/destroy/dead wording, suggesting the neutral terms.
- Bounces a subject line that is not Conventional Commits, or that carries a version number outside `chore(release)`.

## `safety:tree-guard` — PreToolUse (Bash)

- Blocks the git commands that DISCARD a working tree, since the tree is shared and no agent can see what else is uncommitted in it (#157).
- What it bounces: `git checkout` carrying a pathspec, a `git switch` carrying `--discard-changes` or `--force`, `git restore` without a bare `--staged`, every `git stash` spelling, a forced `git clean`, and `git reset --hard` — found anywhere in a compound and through the prefixes `hooks/_lib.sh`'s finder peels.
- A plain branch switch stays legal. Where that line sits is the hook's own README.
- Always on, with one escape: `WORKKIT_ALLOW_DISCARD=1` on the command, the owner's deliberate discard, which the guard stands aside for out loud.

## `safety:issue-guard` — PreToolUse (Bash)

- Blocks a `gh issue create/comment/edit`, a `gh pr create/comment/edit/merge/close`, a `gh api graphql` carrying a discussion or issue mutation, or a `gh api` REST WRITE to an issue or pull endpoint (#83 — a read of the same path is untouched), whose outbound text carries a local `.env` value or a token-shaped string.
- Every repo is assumed public (the spec § Issue anatomy).
- It names the key or the kind, never the match.

## `safety:capture-guard` — PreToolUse (Read/Grep/Bash/Edit/Write)

- Gates `.workkit/capture.md` in both directions — the owner's capture surface, whose one sanctioned touch is the triage drain (#145).
- A read of its contents AND a rewrite of it (Edit/Write, `>`, plain `tee`, `sed -i`, `perl -i`) need the marker the `workkit:triage` skill records, stale after 30 minutes.
- An APPEND — `>>`, `tee -a`, or the capture CLI (`wk.sh note`, which names no path) — is blocked with the marker or without, since adding to it is the owner's alone.
- Counting stays open.

## `docs:board-guard` — PostToolUse (Edit/Write)

- Bounces `CLAUDE.md` / `AGENTS.md` writes that break the spec's document rules.
- `CLAUDE.md`: pointer doctrine — exactly a bare `@AGENTS.md` import, no content. The violation carries the two-commit convert recipe.
- `AGENTS.md`: the size budget, ≤250 lines, and the DENSITY rule beside it (#161) — no line over 400 bytes, since a markdown paragraph is one source line and a file can pass the line count while carrying a book in fourteen of them.
- A density violation lists the first few offenders as `line N (M bytes)` and says to bulletize or move the detail into `docs/<topic>.md`.
- The unit is BYTES, and the measure is pinned to it with `LC_ALL=C`: one-true-awk counts bytes while gawk counts characters under a UTF-8 locale, so an unpinned rule would judge the same file differently on macOS and Linux. One rule, one unit, everywhere it is described.

## `docs:changelog-guard` — PostToolUse (Edit/Write)

- Bounces a CHANGELOG entry that is an essay instead of one short linked paragraph — only entries the write ADDED.

## `docs:session-guard` — PostToolUse (Edit/Write)

- Bounces a write that leaves `.workkit/agents/session.md` past either cap: a bullet over 350 chars, or the file over 40 content lines (#126).
- It judges the resulting file, which is why it is POST.
- The same bar `docs:session` warns at; the `workkit:ship` prune is what normally keeps it under.

## `docs:change-tracker` — Stop

- Nags about uncommitted work, keeping the issue true, promoting findings out of `.workkit/`, and unfiled captures.
- Once per change (#132): it stays silent on every stop that follows while nothing has moved.

## `manager:close-guard` — Stop

- Warns — never blocks — when a frontier session did the bulk editing itself, or when worker output ended the turn with no verifier pass.
- The warning is user-visible only and never continues the turn.
