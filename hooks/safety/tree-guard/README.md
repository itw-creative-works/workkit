# safety:tree-guard

**Hook type:** PreToolUse (Bash)

The working tree is shared. A worker reverting its own nine files with `git checkout -- <files>` discarded ANOTHER agent's uncommitted work in the same files (issue #157, omega 2026-08-06); three later runs reached for `git stash push`/`pop` over trees carrying a whole wave of parked work, and got away with it. Every one of those commands throws away — or parks — state the agent running it cannot see, and no amount of care makes the reach safe, because "is this tree dirty beyond my own files?" is not a question the agent can answer.

So the guard is ALWAYS ON, and the alternative it names is the scoped one the incident's own worker wrote down: revert your changes by reverse-editing your own hunks.

## What it bounces

Each is found wherever it sits in a compound (the command is split on `;` `|` `&`), through the prefixes the house finder in `hooks/_lib.sh` peels: `git -C <path>`, a `/usr/bin/git` spelling, `command git …`, `env git …`, an UNQUOTED `eval git …`, `VAR=x git …`, a `(`/`{` opener. What that leaves out is in "What it never sees".

| Shape | Blocked when |
|---|---|
| `git checkout` | a pathspec is plausible — see the line below |
| `git switch` | `--discard-changes` or `-f`/`--force` is present. It takes no pathspec, so a plain switch is legal |
| `git restore` | always, EXCEPT `--staged` (or `-S`) without `--worktree` (or `-W`) — restoring the index alone leaves the tree untouched |
| `git stash` | every subcommand, bare `git stash` included |
| `git clean` | a force spelling is present: `-f`, any cluster carrying `f`, `--force`. A dry run (`-n`) passes |
| `git reset` | `--hard` is present. `--soft`, `--mixed` and a plain unstage pass |

`git stash list` and `git stash show` read rather than discard, and they are in anyway: the subcommand is one word away from `pop`, the guard is a reflex-breaker rather than a sandbox, and the escape below covers the rare honest need.

## Where the checkout line sits, and why

`git checkout <branch>` is a branch switch and stays legal — the ship PR path uses it, and git refuses it outright when uncommitted changes would conflict. `git checkout -- <path>` is a discard. The two are the same command, so the guard has to draw a line, and it draws it toward blocking:

**Blocked** — `--` anywhere in the arguments; any operand that is `.`, `..`, `./…`, `../…`, absolute, `~/…`, or carries a glob character; any operand that EXISTS in the session's directory as a file or directory; any operand that arrived QUOTED; more than one operand (`git checkout <ref> <path>`); `-f`/`--force`, since a forced switch discards local modifications too; `--pathspec-from-file`.

**Allowed** — zero or one operand that is none of the above: `git checkout main`, `git checkout feature/thing`, `git checkout origin/main`, `git checkout -`, `git checkout -b new`, `git checkout -b new main`.

Two of those calls are judgment, not syntax:

- **The working tree answers the ambiguous token.** `feature/thing` and `src/app.js` are the same shape to a parser; only the filesystem knows one of them is a file. A branch whose name is also a path in the tree therefore blocks — which is the same case git itself calls ambiguous.
- **A quoted operand reads as a pathspec.** Quoting is how a glob reaches git (`git checkout "src/*.js"`); it is almost never how a branch is named. The quote strip that keeps mentions out of this guard replaces the span with a placeholder, so its contents are unreadable by then — and the safe reading of an unreadable operand is the one that blocks.

## The escape

The literal `WORKKIT_ALLOW_DISCARD=1`, as an assignment on the command, is the OWNER's deliberate discard. The guard exits 0 and says so in one line on the visible channel — a top-level `systemMessage` plus `additionalContext`, and no `permissionDecision`, so the command's fate is decided exactly as it would be with the hook silent (the shape `safety:commit-gate`'s stand-down uses). A guard that stands aside in silence is how a whole session's checks disappear unnoticed.

The escape is read off the QUOTE-STRIPPED command, so `echo "set WORKKIT_ALLOW_DISCARD=1 first" && git stash` is a mention and still blocks. With no discarding shape in the command, the assignment says nothing at all.

## What it never sees

A quoted mention (`echo "never run git stash"`, a commit message naming the rule) and a heredoc BODY are data, stripped before the walk — the same preparation `hooks/_lib.sh` does for the commit hooks, whose strip helpers this guard sources rather than repeating. A non-git command carrying the words (`npm run stash`, `make clean -f`) is not a git clause. A redirection's target and everything after an unquoted `#` are dropped before any judgment: they are not arguments, and counting them bounced `git checkout main > /tmp/out`.

Then the accepted misses, which are the same line `_lib.sh`'s finder draws — a clause whose command word is not git is not walked:

- a QUOTED eval body or an interpreter string — `eval "git stash"`, `sh -c "git checkout -- ."` (the unquoted `eval git stash` is caught, since eval peels)
- a control-flow or launcher wrapper — `if git stash; then …`, `for … do git stash`, `time git stash`, `sudo git stash`, `xargs git checkout --`
- a command substitution — `echo $(git stash)`

This is a tripwire on the honest reach, not a sandbox: closing those would cost more legitimate commands than the reflex it exists to break.

Fail-open on the guard's own errors — no `jq`, an unreadable payload — because a broken guard must never wedge a session.

## Files

- `run.sh` — the clause walk, the five shapes, the escape
- `README.md` — this file
