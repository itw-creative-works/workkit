# Provisioning a remote session

How a cloud or headless Claude Code session comes up to the same standard as the machine you work on. The short answer: nothing personal syncs by itself — everything that travels, travels through git — and the pieces that cannot travel are few and known. (Issue #69 is where this design landed.)

## What travels on its own

A remote session (a claude.ai/code cloud environment, or a headless run on a CI runner) receives, with no help:

- The repo it opened: `CLAUDE.md` / `AGENTS.md`, the repo's own `.claude/` directory, and a committed `.mcp.json`.
- Plugins declared in the repo's `.claude/settings.json`, auto-installed from their marketplace — when the marketplace source is one the session can reach.
- Organization-managed settings, fetched from Anthropic's servers.

What never travels on its own: user-level `~/.claude` — personal skills, hooks, output styles, agents, user settings. There is no user-config sync; the documented pattern is to keep that content in a git repo and provision from it.

## The recipe

1. **Keep the personal harness in git.** A dotfiles-style repo owning the `~/.claude` content (symlinked into place by an idempotent setup script) is the artifact that travels. `~/.claude` itself is symlinks plus generated state — never copy it wholesale.
2. **Give the cloud environment a setup script.** A claude.ai/code environment runs its setup script once, as root, before the first session. Point it at a bootstrap in the personal repo: clone, run the same setup module the machine uses, clone and register the plugin repos. Session-time work (a dependency install per session) belongs in a SessionStart hook instead, gated on `CLAUDE_CODE_REMOTE`.
3. **Register plugin marketplaces by source the session can reach.** A marketplace registered as a local directory path resolves only on the machine that registered it. A github source works everywhere — against a private repo it needs the session's GitHub token to read; a public repo drops even that.
4. **Secrets ride as environment secrets, never files.** The proven pair from this kit's own cloud job (`jobs/README.md`): `CLAUDE_CODE_OAUTH_TOKEN` for the model, a scoped GitHub token for the board. MCP upstreams that call remote APIs add their keys the same way.

## What cannot travel, and its cloud twin

| Machine piece | Why it stays | The cloud twin |
|---|---|---|
| launchd / cron schedules | machine-global schedulers | a GitHub Actions cron (the daily brief already runs this way) |
| Browser and Electron MCP upstreams | need a local process to attach to | none — scope the session's work away from them |
| Session transcripts and local git history | this machine's private state | none, by construction — the nightly summaries name that skip |
| Keychain auth | OS secret store | the environment secrets above |
| Desktop notifiers, keep-awake | no display, nothing to keep awake | degrade to no-ops |

## The working precedent

The daily brief is the existence proof: the identical `morning.sh` runs headless on a GitHub Actions runner with exactly two repo secrets and a synthetic `~/.workkit` built from what the home repo publishes — no other machine state. Anything provisioned for a cloud session should hold itself to the same bar: tokens plus git, nothing copied off a machine.
