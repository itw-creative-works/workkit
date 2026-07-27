# The pipeline — intent to implemented

Every piece of work travels one road: captured as intent, accepted and spec'd, built by the crew, verified, shipped with its docs and CHANGELOG entry, closed. The stages are the `status:` labels themselves — the board IS the pipeline. This page is the visual map; the rules live in [project-state.md](project-state.md) (stages, labels, issue anatomy) and the crew mechanics in the [agents reference](agents.md) and the hook inventory in [AGENTS.md](../AGENTS.md).

## The road

```mermaid
flowchart LR
    subgraph capture [" capture "]
        A1["chat note"]
        A2[".workkit/inbox.md"]
        A3["GitHub issue form"]
    end

    A1 --> INBOX
    A2 --> INBOX
    A3 --> INBOX

    INBOX["status:inbox<br/><i>captured, unjudged</i>"]
    SPEC["status:spec<br/><i>accepted, needs the plan</i>"]
    QUEUED["status:queued<br/><i>plan ready, buildable</i>"]
    BUILD["build<br/><i>manager + crew</i>"]
    VERIFY["verify<br/><i>verifier at claimed-done</i>"]
    SHIP["ship<br/><i>review panel · commit · CHANGELOG</i>"]
    CLOSED(["closed<br/><i>points at its CHANGELOG entry</i>"])

    TRIAGE{"triage:<br/>needs a plan?"}
    INBOX -- "route" --> TRIAGE
    TRIAGE -- "yes" --> SPEC
    TRIAGE -- "no — small item<br/>(Plan: none needed)" --> QUEUED
    SPEC -- "planning pass<br/>(scout maps · plan drafts ·<br/>manager reviews · the human ratifies)" --> QUEUED
    QUEUED --> BUILD --> VERIFY --> SHIP --> CLOSED

    subgraph side [" side pockets "]
        direction LR
        PARKED["status:parked<br/><i>kept on purpose, not now</i>"]
        BLOCKED["status:blocked<br/><i>a question waits on the human —<br/>asked in chat when current focus</i>"]
        REJECTED(["closed: not planned"])
    end

    QUEUED -. "needs the human's call" .-> BLOCKED
    BLOCKED -. "answered" .-> QUEUED
    TRIAGE -. "not now" .-> PARKED
    PARKED -. "revived — re-triaged" .-> INBOX
    TRIAGE -. "rejected" .-> REJECTED
```

- **`status:inbox`** — anything captured, from a chat aside to an issue-form submission. The `workkit:triage` skill drains it.
- **`status:spec`** — accepted work that is not yet buildable: the issue's `## Plan` lacks its implementation layer. The planning pass (a scout maps the code, a plan drafts against the issue, the manager reviews, the human ratifies) is what earns `status:queued`. A small item skips this stage — triage sends it straight to `status:queued` with the literal Plan `None needed — small item.`
- **`status:queued`** — plan ready. The ONLY stage builds start from, and the only pool `agent:ok` autonomy ever pulls from.
- **build → verify → ship** — not labels but the working stages of a queued issue: the crew builds, the verifier judges the diff blind, and the ship step runs the review panel, commits with `Fixes #N`, and writes the CHANGELOG entry. Closing the issue against that entry is the pipeline's exit.
- **`status:blocked` / `status:parked`** — side pockets, not stages: a question waiting on the human (delivered in chat when the work is current focus), and deliberate not-now.

## The crew that works it

```mermaid
flowchart TB
    HUMAN(["human"]) <--> MGR

    MGR["MANAGER — the main chat<br/><i>conversation · judgment · dispatch<br/>design calls, contract changes, final verdicts</i>"]

    subgraph crew [" the class agents — models resolved per spawn by the manager:resolver hook "]
        SCOUT["scout<br/><i>read-only recon</i><br/>fast tier"]
        WORKER["worker<br/><i>implementation against a brief</i><br/>workhorse tier, capped at the session model"]
        VERIFIER["verifier<br/><i>blind review + review scorer</i><br/>workhorse tier, effort high"]
        ADVISOR["advisor<br/><i>plans and hard calls, never implements</i><br/>frontier tier, always"]
    end

    MGR -- "recon" --> SCOUT
    MGR -- "brief" --> WORKER
    MGR -- "diff + brief" --> VERIFIER
    MGR -- "consulted only when the session<br/>model is below frontier" --> ADVISOR

    LADDER[("hooks/manager/ladder.json<br/><i>tier SSOT — frontier: fable ·<br/>workhorse: opus · fast: sonnet</i>")]
    LADDER --- crew
```

- The **manager** is whichever model the chat runs on; the topology follows the model button — a frontier session never spawns the advisor, a workhorse session consults it for plans.
- **Crew sizing is policy, not mood**: a small change is the manager alone or one worker; a feature is one worker (a pair only under worktree isolation); the verifier runs once at claimed-done; the full review panel (the `workkit:reviewer` agent + scout lenses + verifier scorer) assembles only inside `workkit:review` and `workkit:ship`.
- **Models are supplied per spawn** by the `manager/resolver` hook from `ladder.json` and the live session model; per-repo and per-user `manager` blocks in `.workkit/settings.json` override tiers or turn the crew off (`enabled: false`).

## What enforces each hop

| Hop | Mechanism |
|---|---|
| capture → `status:inbox` | issue forms + the `docs:state-check` hook announcing the count |
| `status:inbox` → routed | the `workkit:triage` skill (never drained as a side effect) |
| `status:spec` → `status:queued` | the planning pass, ratified by the human — the `workkit:feature` skill refuses to build below `status:queued` |
| build quality | the `code:lint` hook per edit; suite green + fresh review marker enforced by the `safety:commit-gate` hook at commit |
| ship exit | `Fixes #N` closes the issue on push; the CHANGELOG entry format held by the `docs:changelog-guard` hook |
| label integrity | the daily `workflow:standards` heal syncs `labels.json` and names label-shape offenders |
