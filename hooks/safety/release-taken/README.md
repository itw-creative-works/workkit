# safety:release-taken

**Hook type:** PreToolUse (Bash)

A ship cut `chore(release): 0.50.0` while 0.50.0 was already on npm: the family had published it hours earlier, and nothing in the pipeline asked. The version was discovered as taken only when `npm publish` failed, by which time the release commit and the tag existed and the fix was a second release rather than a different number.

So the question is asked BEFORE the commit, at the one moment it is still free to answer: a release version that a provider already has bounces, and the bump costs nothing.

## What it bounces

Two triggers, and nothing else reaches a provider:

| Trigger | Found by | Asks |
|---|---|---|
| the release commit | a real `git ... commit` carrying the subject `chore(release): <x.y.z>` where a SUBJECT can sit: right after a message flag (`-m`, `--message`, quote optional), or opening a line, which is where the `-m "$(cat <<'EOF'` idiom puts it | npm for every package with publish intent, at ITS OWN `package.json` version, and `github-release` once for the repo, at the subject's version |
| `npm publish` | a clause whose command word is `npm` and whose first non-option argument is `publish` (`--access public`, `--workspaces` and the rest ride along; a `--dry-run` publishes nothing and is not one) | npm only, the same package set, or only the members it names with `--workspace` |

A commit with any other subject is not this hook's business, and the GitHub release legitimately precedes the publish in the ship pipeline, which is why the publish never asks about it.

The two STRIPS are the house ones in [`hooks/_lib.sh`](../../_lib.sh), shared with the commit hooks: a quoted mention (`echo "chore(release): 1.2.3"`) and a heredoc body are data, never commands. So is the commit finder, and so is `HOOK_VERSION_RE`, the release version `safety:commit-language` accepts in a subject.

The npm clause walk, though, is this hook's OWN and deliberately smaller: it peels `(`, `{`, `command`, `env` and `VAR=value`, and nothing else. Two spellings of a publish therefore walk past it, and they are accepted misses rather than oversights: `eval "npm publish"` and an interpreter string (`sh -c "npm publish"`). Both are the shapes the commit finder pays a wrapped-detection pass for, and neither is how a publish is ever typed.

## The project, and its packages

The package.json at the cwd's git toplevel for a commit; the one at the cwd itself for a publish, since npm publishes the package it runs in. A `workspaces` declaration (the array, or the object's `packages`) makes every member part of the project too, which is what makes a family publish one question instead of ten:

- a literal directory (`packages/core`) is read where it stands
- `dir/*` expands to every direct subdirectory of `dir` holding a package.json
- any other glob shape is named on stderr as unexpanded and skipped, never guessed at

A publish that names its workspaces asks about those members alone. `--workspace=<x>`, `--workspace <x>`, `-w <x>` and `-w=<x>` all count, as many times as the command repeats them, and each `<x>` matches a member by its package name or by its path from the root (`@fam/core`, `packages/core`, `./packages/core/`), the two spellings npm accepts. The root is never one of them. That is what lets a family publish one member at a time, in dependency order, without the member published a moment ago bouncing the next one. Every publishing clause of a chain counts (`npm publish -w a && npm publish -w b` asks about both), and one clause naming no workspace checks the whole set. `--workspaces`, all of them, keeps the whole set.

Publish intent decides who is asked at npm, and the rule's home is the ship's publish plan, [`workflow/publish-plan.js`](../../../workflow/publish-plan.js): its `skip` reasons are the rule, and the hook asks npm about exactly the packages it would not skip, plus a workspaces root that carries the intent itself (a plain `npm publish` at that root publishes it, though the plan never lists it). A private package, or one that never opted into npm, is never asked about there.

## The provider contract

A provider is an executable beside this file under `providers/`, and the hook knows nothing about any of them beyond this:

```
providers/<name> <package-name> <version>
  exit 1   the version is TAKEN
  exit 0   it is free, or the check could not be made
```

A third provider is therefore a new file, never an edit to the hook. The two that ship:

- **`npm`**: `npm view <name>@<version> version`, with stdin closed and the update notifier off. Taken when the trimmed answer IS the version. An E404 (no such package, or no such version of it) is free.
- **`github-release`**: `gh release view v<version> --json tagName -q .tagName`, run from the project root so `gh` resolves the repo's own origin. Taken when the trimmed answer is `v<version>`. "release not found" is free. It accepts the package name and ignores it: one contract for every provider beats a per-provider argument list.

Every provider call runs CONCURRENTLY, so a family of ten packages costs one round trip rather than ten.

**Cannot tell is not free, and is never silent.** Offline, unauthenticated, no origin, the tool missing: the provider prints one line on stderr saying the check stood down, and exits 0. A stand-down never blocks and never passes unnoticed.

## The bounce

Exit 2, on stderr, one line per taken pair, naming the trigger, the provider and the version:

```
release-taken: BLOCKED this release commit: npm already has widget@1.2.3
release-taken: BLOCKED this release commit: github-release already has v1.2.3 at acme/widgets
```

The repo slug rides the github-release line when the origin says it, read through the engine's one rule (`wk_repo_slug`, `workflow/slug.sh`, sourced by `hooks/_lib.sh`): every form git writes a remote in, and a local path in either separator, since git stores a remote exactly as it was typed. It is left off rather than guessed at when the origin names no repo. The second line says what to do: bump to a version no provider has yet.

## The escape

`HOOK_DISABLE=1` on this hook's loader command, the generic kill switch every hook shares. There is no per-command escape, because the only honest reason to release over a taken version is a decision the owner makes deliberately and once.

## What it never sees

A commit whose subject is not the release one, the release subject named mid-message included (`-m "docs(ship): explain how chore(release): 1.2.3 is judged"` is prose about a release); a publish this hook's two strips prove is a mention; a `--dry-run`; a project with no package.json at its root (then npm has nothing to ask about, and `github-release` still runs on the commit trigger when the cwd is inside a repo at all); a package with no name or no version.

The accepted residual of reading a line start as a subject position: a heredoc BODY line that begins with the literal release subject reads as one, so a commit whose message quotes a release line at the start of a line is judged as that release. It costs one bounce on a version that is free, never a missed one that is taken.

Four things it cannot read, and says so rather than passing in silence: a message in a FILE (`-F`, `--file`), where there is no subject in the command at all; a publish behind a `cd`, `pushd` or `popd`, where the package npm would publish is not the one at the directory this hook was handed; a workspace member that is absent or a pattern that matched nothing; and a publish naming a workspace that matches no member, a quoted name (the quote strip leaves nothing readable where it stood) or an empty one (`--workspace=`), where the package being published could not be placed.

Fail-open on the hook's own errors, since a broken guard must never wedge a session: no `jq`, an unreadable payload, a package.json `jq` cannot parse (that one package is named on stderr and skipped), a provider that exits some way the contract does not cover.

The wiring declares a 30 second timeout for this hook (`hooks/hooks.json`), the way `safety:commit-gate` declares its own: `gh release view` takes no timeout flag of its own, so a hung one costs thirty seconds at most rather than the default window.

## Files

- `run.sh`: the two triggers, the package set, the concurrent provider calls, the bounce
- `providers/npm`, `providers/github-release`: the two providers, one contract
- `README.md`: this file
