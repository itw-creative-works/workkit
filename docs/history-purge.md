# History purge — removing a leaked value from git history

A value that should never have been committed — a phone number, an address, a key — is still in every clone of the repo until the history that carries it is rewritten. This is the runbook for that rewrite, written from the live run of 2026-07-30 (the dotfiles repo, a phone number, issue #92) so the next one is followed rather than rediscovered.

**Rewriting history is destructive and it is not automated.** No hook runs it, no skill does it for you, and the one step that actually publishes the rewrite is done BY THE HUMAN, by hand, through the GitHub UI. That friction is the feature: every gate in the way is a chance to notice that the value did not need purging, or that the wrong range was scoped. Follow the steps in order; do not improvise a rewrite.

Read the whole page before starting. Prerequisite: `git filter-repo` on the PATH (`brew install git-filter-repo`) — `git filter-branch` is deprecated and the BFG has its own scoping rules this runbook does not describe.

---

## 1. Fix the working tree first

Replace the value with a placeholder in the files that carry it today, and ship that the ordinary way — an issue, a commit, a CHANGELOG entry if it is user-visible.

**Why first:** the rewrite below deals only with what is already in history. A tree still carrying the value would re-commit it the next day, and the whole purge would be for nothing.

## 2. Take a backup branch

```sh
git branch backup-pre-rewrite
git stash          # only if the tree is dirty
```

**Why:** `git filter-repo` rewrites the branch in place. The backup branch is the one command that makes the whole operation reversible, and it costs nothing. The stash matters because filter-repo refuses to run on a dirty tree.

## 3. Find the OLDEST commit that carries the value

```sh
git log -S'<value>' --oneline --all
```

Take the oldest sha it names, and note that commit's PARENT — that parent is the start of the range in the next step.

**Why:** the range is what keeps this operation small. See step 4.

## 4. Rewrite, SCOPED to the affected commits

Write a replacement file — one `literal-value==>replacement` line per value:

```sh
printf '%s\n' '+15551234567==>REDACTED' > /tmp/purge.txt
git filter-repo --replace-text /tmp/purge.txt --refs <parent-sha>..main --force
```

**Why `--force` is required and safe here:** filter-repo's sanity check wants a
fresh clone — no reflog history, no stash, no local branch without an origin
counterpart — and this runbook's own step 2 guarantees all three exist, so the
command as written aborts without it. `--force` skips only that check; the
`backup-pre-rewrite` branch from step 2 is the reversibility, not the fresh
clone.

**Why the `--refs` scope is not optional:** an UNSCOPED run rewrites every commit in the repo, which changes every sha in it. Observed live: shas changed all the way back to a signed squash commit many releases earlier, and GitHub's commit signatures were stripped from commits that had nothing to do with the leak. Scoping to `<parent-sha>..main` leaves every sha before the first affected commit byte-identical, so only the commits that actually carried the value — and their descendants, which cannot be helped — get new shas.

## 5. Verify before publishing anything

```sh
git log -S'<value>' --all          # must print nothing
git log --oneline -20              # only the expected commits have new shas
git diff backup-pre-rewrite main   # the trees are identical but for the value
```

**Why:** this is the last point at which the rewrite can be abandoned for free. `git reset --hard backup-pre-rewrite` puts everything back, and nothing has left the machine.

## 6. Publish — the force push, run BY THE HUMAN

GitHub's classic branch protection blocks force pushes to a protected branch **even for repository admins**, so the branch protection is toggled around the push:

1. In the repo's Settings → Branches, edit the rule on the default branch and turn **Allow force pushes** ON.
2. `git push --force origin main`
3. Turn **Allow force pushes** back OFF immediately.

**Why the human:** the agent harness's own classifier blocks a force push, and this runbook does not ask anyone to work around that. A rewrite that every collaborator must re-clone for is a decision, not a step — the person who owns the repo makes it, in the UI, with the protection they just disabled in front of them.

**Tell the collaborators.** Anyone holding a clone of the rewritten range has to re-clone or reset to the new history; a `git pull` onto the old history re-introduces the purged commits.

## 7. Repoint what named the rewritten shas

The CHANGELOG links commits by sha (`[`abc1234`](../../commit/abc1234)`), and any entry pointing into the rewritten range now links a commit that does not exist. Find them, replace them with the new shas, and ship it as one small `docs:` commit.

**Why:** a dead commit link is the only lasting trace the rewrite leaves in the repo's own documentation.

## 8. Purge the local copies

```sh
git branch -D backup-pre-rewrite
git stash drop                     # if step 2 stashed anything
git reflog expire --expire=now --all
git gc --prune=now
```

**Why:** the old commits are still reachable on this machine through the backup branch, the stash and the reflog — `git log -S` finding nothing on the rewritten branch does not mean the object is gone. This is the step that removes them from the local object store. Do it only once step 6 has landed and been verified on GitHub.

## 9. The server side

GitHub keeps unreachable objects until its own garbage collection runs, so the old commits stay fetchable by sha for a while after the force push. If the value's exposure matters that much, open a GitHub support ticket asking them to run garbage collection on the repository; otherwise the objects age out on their own.

**Why it is last:** nothing on the machine can force this, and it is the one part of the operation that is out of the operator's hands. Treat the leaked value as compromised regardless — rotate the key, change the number — because a purge is damage control, never a guarantee.
