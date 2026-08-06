# docs:session-guard

**Hook type:** PostToolUse (Edit|Write)

Holds `.workkit/agents/session.md` to the shape it exists in: the task queue a compacted or restarted session reads first (the spec's `.workkit/` section, `docs/project-state.md`). Left alone it grows — an entry is appended per work batch, nothing removes one, and each entry thickens into a paragraph until the file is a journal of what already shipped, whose facts live in the CHANGELOG and the closed issue.

## What it bounces

The written file is judged, one write at a time. Either condition blocks with exit 2, both are named at once:

| Cap | Constant | Bounces when |
|---|---|---|
| Bullet length | `MAX_BULLET_CHARS=350` | any bullet line (optional indent, then `- ` or `* `) is longer, named with its length and its first 60 characters |
| File length | `MAX_CONTENT_LINES=40` | the file holds more content lines — non-blank, not a heading, not a blockquote, not an HTML comment, so the seeded template counts zero |

The message says what to do: promote anything durable to its issue or the CHANGELOG, delete what has already shipped, split or trim the oversized bullet.

Everything else exits 0 in silence — another file, a `session.md` outside `.workkit/agents`, a file that no longer exists, a machine without `jq`.

## Why PostToolUse

An Edit's RESULT is what the caps judge, and only the file on disk knows it — a patch says nothing about the length it leaves behind. So the write lands and the hook judges the file, the same shape `docs:changelog-guard` uses. A write that shrinks an oversized file but leaves it over still bounces; that is intended, and the message is what finishes the prune.

## The pair, and the two other layers

The content-line count and the bar of 40 live in BOTH this hook and `docs/session`, which reads the same file at SessionStart and warns past the same bar. Neither sources the other (a hook that must never cost a session sources nothing), so they are changed together and a case in `tests/hooks/session-guard.test.js` asserts they still agree.

Three layers, one rule:

1. **This hook** is the enforcement — an over-cap write is bounced back to the writing agent before any other work.
2. **`docs:session` is the backstop** — growth this hook never saw (a hand edit, a file predating it) is named at injection time.
3. **The `workkit:ship` skill is the workflow fix** — its close step deletes the entries a ship completed, which is the moment their facts move to the CHANGELOG and the closed issue.

## Files

- `run.sh` — the two caps and the bounce
- `README.md` — this file
