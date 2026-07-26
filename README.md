# workkit

The issue-pipeline workflow system as a Claude Code plugin: the standards heal, the manager crew (scout/worker/verifier/advisor), the guard hooks, and the workflow skills — for any repo.

**Status: scaffold.** This is Batch B of the extraction (dotfiles issue #23): the plugin shell plus probe content proving hooks, agents, and skills load from a plugin. The real mechanism moves in Batch C.

## Install (local marketplace, for development)

```sh
claude plugin marketplace add ~/Developer/Repositories/ITW-Creative-Works/workkit
claude plugin install workkit@workkit
```

## Layout

```
.claude-plugin/   plugin.json + marketplace.json (this repo is its own marketplace)
hooks/            hooks.json + hook scripts, resolved via ${CLAUDE_PLUGIN_ROOT}
agents/           agent definitions (namespaced workkit:<name>)
skills/           skills (namespaced workkit:<name>)
```
