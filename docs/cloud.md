# Provisioning a remote session

How a cloud or headless Claude Code session comes up to the same standard as the machine you work on. The short answer: nothing personal syncs by itself (everything that travels, travels through git) and the pieces that cannot travel are few and known.

## What travels on its own

A remote session (a claude.ai/code cloud environment, or a headless run on a CI runner) receives, with no help:

- The repo it opened: `AGENTS.md`, the repo's own `.claude/` directory, and a committed `.mcp.json`.
- Plugins declared in the repo's `.claude/settings.json`, auto-installed from their marketplace, when the marketplace source is one the session can reach.
- Organization-managed settings, fetched from Anthropic's servers.

What never travels on its own: user-level `~/.claude` (personal skills, hooks, output styles, agents, user settings). There is no user-config sync; the documented pattern is to keep that content in a git repo and provision from it.

## The recipe

1. **Keep the personal harness in git.** A dotfiles-style repo owning the `~/.claude` content (symlinked into place by an idempotent setup script) is the artifact that travels. `~/.claude` itself is symlinks plus generated state. Never copy it wholesale.
2. **Give the cloud environment a setup script.** A claude.ai/code environment runs its setup script once, as root, before the first session. Point it at a bootstrap in the personal repo: clone, run the same setup module the machine uses, clone and register the plugin repos. Session-time work (a dependency install per session) belongs in a SessionStart hook instead, gated on `CLAUDE_CODE_REMOTE`.
3. **Register plugin marketplaces by source the session can reach.** A marketplace registered as a local directory path resolves only on the machine that registered it. A github source works everywhere. Against a private repo it needs the session's GitHub token to read; a public repo drops even that.
4. **Secrets ride as environment secrets, never files.** The proven pair from this kit's own cloud job (`jobs/README.md`): `CLAUDE_CODE_OAUTH_TOKEN` for the model, a scoped GitHub token for the board. MCP upstreams that call remote APIs add their keys the same way.

   The bot identity needs no secret: `workkit-agent[bot]` does not act in a session, since the session's GitHub proxy signs every call as the account, and the kit's `gh` calls run as the account through REST ([gh in a session](#gh-in-a-session)).

## What cannot travel, and its cloud twin

| Machine piece | Why it stays | The cloud twin |
|---|---|---|
| launchd / cron schedules | machine-global schedulers | a GitHub Actions cron (the daily brief already runs this way) |
| Browser and Electron MCP upstreams | need a local process to attach to | none: scope the session's work away from them |
| Session transcripts and local git history | this machine's private state | none, by construction: the nightly summaries name that skip |
| Keychain auth | OS secret store | the environment secrets above |
| Desktop notifiers, keep-awake | no display, nothing to keep awake | degrade to no-ops |

## gh in a session

A cloud session reaches GitHub only through its proxy, which signs every request as the account the session belongs to and serves REST on the session's own repos alone: GraphQL answers 403, and another repo answers 403 until the session attaches it.

- **What works.** The `gh` shim (`workflow/identity/gh`, linked by `workkit setup --cloud`) serves the kit's verbs through REST: `issue list|view|edit|comment|close|create`, `label list|create|edit` and `auth status` become `gh api repos/<owner>/<repo>/...` calls (`workflow/identity/rest.js`), printed in gh's own shape, so the hooks, the heal, `workkit note` and the skills run unchanged. `gh api` on a REST route works as it does anywhere.
- **What does not.** Any other verb or subcommand, and any `-h`/`--help`, runs the real gh, so a GraphQL one (`gh pr`, `gh repo view`) answers the proxy's 403. A field or flag of a served verb the shim does not serve (`--json blockedBy`, `--web`) stops with a line naming it; `blockedBy` is the one field the status skill loses there, so it drops it from its query and orders by its fallback signals. `issue list --search` goes through REST's search route, which the proxy may refuse.
- **Writes land as the account.** The proxy overwrites any other token, so the shim fetches no `workkit-agent[bot]` token there, and every claim, label and comment posts as you.
- **The login check.** `workkit setup --cloud` and `workkit doctor` read the login with `gh api user -q .login`, which the shim's `auth status` answers the same way.

## The working precedent

The daily brief is the existence proof: the identical `morning.sh` runs headless on a GitHub Actions runner with exactly two repo secrets and a synthetic `~/.workkit` built from what the home repo publishes, no other machine state. Anything provisioned for a cloud session should hold itself to the same bar: tokens plus git, nothing copied off a machine.
