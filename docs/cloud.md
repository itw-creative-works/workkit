# Provisioning a remote session

- How a cloud or headless Claude Code session comes up to the same standard as the machine you work on.
- The short answer: nothing personal syncs by itself.
  - Everything that travels, travels through git.
  - The pieces that cannot travel are few and known.

## What travels on its own

- A remote session is a claude.ai/code cloud environment, or a headless run on a CI runner.
- It receives, with no help:
  - The repo it opened: `AGENTS.md`, the repo's own `.claude/` directory, and a committed `.mcp.json`.
  - Plugins declared in the repo's `.claude/settings.json`, auto-installed from their marketplace.
    - This holds when the marketplace source is one the session can reach.
  - Organization-managed settings, fetched from Anthropic's servers.
- What never travels on its own: user-level `~/.claude` (personal skills, hooks, output styles, agents, user settings).
  - There is no user-config sync.
  - The documented pattern is to keep that content in a git repo and provision from it.

## The recipe

1. **Keep the personal harness in git.**
   - A dotfiles-style repo owning the `~/.claude` content is the artifact that travels.
     - An idempotent setup script symlinks it into place.
   - `~/.claude` itself is symlinks plus generated state. Never copy it wholesale.
2. **Give the cloud environment a setup script.**
   - A claude.ai/code environment runs its setup script once, as root, before the first session.
   - Point it at a bootstrap in the personal repo.
     - The bootstrap clones, runs the same setup module the machine uses, and clones and registers the plugin repos.
   - Session-time work (a dependency install per session) belongs in a SessionStart hook instead, gated on `CLAUDE_CODE_REMOTE`.
3. **Register plugin marketplaces by source the session can reach.**
   - A marketplace registered as a local directory path resolves only on the machine that registered it.
   - A github source works everywhere.
     - Against a private repo it needs the session's GitHub token to read; a public repo drops even that.
4. **Secrets ride as environment secrets, never files.**
   - The proven pair from this kit's own cloud job (`jobs/README.md`):
     - `CLAUDE_CODE_OAUTH_TOKEN` for the model;
     - a scoped GitHub token for the board.
   - MCP upstreams that call remote APIs add their keys the same way.
   - The bot identity needs no secret: `workkit-agent[bot]` does not act in a session.
     - The session's GitHub proxy signs every call as the account.
     - The kit's `gh` calls run as the account through REST ([gh in a session](#gh-in-a-session)).

## What cannot travel, and its cloud twin

| Machine piece | Why it stays | The cloud twin |
|---|---|---|
| launchd / cron schedules | machine-global schedulers | a GitHub Actions cron (the daily brief already runs this way) |
| Browser and Electron MCP upstreams | need a local process to attach to | none: scope the session's work away from them |
| Session transcripts and local git history | this machine's private state | none, by construction: the nightly summaries name that skip |
| Keychain auth | OS secret store | the environment secrets above |
| Desktop notifiers, keep-awake | no display, nothing to keep awake | degrade to no-ops |

## gh in a session

- A cloud session reaches GitHub only through its proxy.
  - The proxy signs every request as the account the session belongs to.
  - It serves REST on the session's own repos alone.
  - GraphQL answers 403, and another repo answers 403 until the session attaches it.
- **What works.** The `gh` shim (`workflow/identity/gh`, linked by `workkit setup --cloud`) serves the kit's verbs through REST.
  - These verbs become `gh api repos/<owner>/<repo>/...` calls, printed in gh's own shape:
    - `issue list|view|edit|comment|close|create`, `label list|create|edit` and `auth status` (`workflow/identity/rest.js`);
    - `pr create|list|view|checks|merge` (`rest-pr.js` beside it);
    - `release view` (`rest-release.js`).
  - So the hooks, the heal, `workkit note` and the skills run unchanged, the ship's PR path included.
  - `gh api` on a REST route works as it does anywhere.
  - Every verb the shim passes to the real gh gets the clone's repo as `GH_REPO`.
    - So `repos/{owner}/{repo}` placeholders and `gh run list` name the clone's repo, whatever host its proxy origin names.
- **The pr verbs.** Every one takes `--repo`/`-R`.
  - `pr create` takes `--title`/`-t` and `--body`/`-b` or `--body-file`/`-F`, both required.
    - It also takes `--base`/`-B` (the repo's default branch when absent) and `--head`/`-H` (the current branch).
    - It prints the new PR's URL.
  - `pr list` takes `--head`/`-H`, `--base`/`-B`, `--state`/`-s`, `--limit`/`-L` and `--json`.
    - `--state` is `open` (the default), `closed`, `merged` or `all`.
  - `pr view`, `pr checks` and `pr merge` name their PR by number, `#N`, URL or branch.
    - When none is named, it is the current branch's open PR (a detached HEAD is refused).
  - `pr view` takes `--json`.
  - `pr checks` prints the head commit's check runs and statuses, one line each.
    - It exits 1 on a failed one and 8 on a pending one, as gh does.
    - With `--watch` it reads again every `--interval`/`-i` seconds (10 when absent) until none is pending.
  - `pr merge` takes exactly one of `--merge`/`-m`, `--squash`/`-s` and `--rebase`/`-r`.
    - It also takes `--subject`/`-t`, `--body`/`-b` or `--body-file`/`-F`, and `--delete-branch`/`-d`.
    - `--delete-branch` deletes the remote branch after the merge (a fork's branch is left, as gh leaves it).
    - The proxy refuses that delete, so the merge stands and one line says so: `gh: merged #<n>; branch <name> left, this cloud session cannot delete branches`.
    - Local branches are left alone either way.
  - The pr `--json` fields served: `baseRefName`, `headRefName`, `headRefOid`, `isDraft`, `mergeCommit`, `mergedAt`, `number`, `state`, `title`, `url`.
- **The release verbs.** `release view [<tag>]` reads the latest release when no tag is named.
  - When there is none, it is gh's `release not found`.
  - It takes `--json` with `body`, `createdAt`, `isDraft`, `isPrerelease`, `name`, `publishedAt`, `tagName`, `targetCommitish`, `url`.
  - It takes `--jq`/`-q` as one `.field` path naming a `--json` field.
  - The proxy refuses every release write, so `release create` stops before any call with this line:
    - `gh: a cloud session cannot create a release (the proxy refuses release writes); CI's release job makes it when the release commit reaches the default branch`.
  - No ship needs it: the repo's `checks.yml` `release` job makes every release.
    - `workkit ship cut` waits for it through `release view`, the same in a cloud session as on a machine.
- **What does not.** Any other verb or subcommand (`gh repo view`, `gh pr edit`, `gh release list`) runs the real gh.
  - So does any `-h`/`--help`.
  - So a GraphQL one answers the proxy's 403.
  - A field or flag of a served verb the shim does not serve (`--json blockedBy`, `--web`, `pr create --draft`) stops with a line naming it.
    - `blockedBy` is the one field the status skill loses there.
    - So the status skill drops it from its query and orders by its fallback signals.
  - `issue list --search` goes through REST's search route, which the proxy may refuse.
- **Writes land as the account.** The proxy overwrites any other token.
  - So the shim fetches no `workkit-agent[bot]` token there, and every claim, label and comment posts as you.
- **The login check.** `workkit setup --cloud` and `workkit doctor` read the login with `gh api user -q .login`.
  - The shim's `auth status` answers that the same way.

## The working precedent

- The daily brief is the existence proof: the identical `morning.sh` runs headless on a GitHub Actions runner.
  - It has exactly two repo secrets and a synthetic `~/.workkit` built from what the home repo publishes.
  - It has no other machine state.
- Anything provisioned for a cloud session should hold itself to the same bar: tokens plus git, nothing copied off a machine.
