---
name: state
description: Load this machine's global workkit state — home repo, publish switch, roster — from the local files, or from what the machine published when there are none. - Use when the user asks about the roster or the home repo, "what repos am I tracking", or a session needs global state it does not have.
---

# State — load the global layer, then say where it came from

**READ-ONLY.** This skill reads; it never writes `~/.workkit`, never publishes, never enables a repo. `workkit setup` and the heal are the only things that write the global layer.

Nothing here is loaded until you invoke it, and no machine path ships in the plugin — the paths below are resolved at use, and an absent one is a fall-through, never an error.

Two sources, in order. The LOCAL files are the truth on a machine that has them; the PUBLISHED data is the same state read back through GitHub for a session that does not (a cloud runner, a fresh machine, a chat with no reach into the home directory).

## 1. Local first

`$WORKFLOW_HOME` overrides `~/.workkit` — resolve it once and read through `$WK`:

```sh
WK="${WORKFLOW_HOME:-$HOME/.workkit}"
cat "$WK/settings.json"   # hand-edited: the site options
cat "$WK/.repos.json"     # machine-maintained: the roster + declines
```

| File | What it answers |
|---|---|
| `settings.json` | `site.repo` — the home repo slug (`<login>/workkit`), the cross-project queue · `site.publish` — the all-or-nothing publish switch, THREE-state: `true`/`false` are answers, `null` or absent is a machine nobody has asked · `site.url` — the custom domain, absent = no URL |
| `.repos.json` | `repos`, a map of ABSOLUTE repo root → `"enabled"` or `"declined"`. The enabled entries are the roster — this machine's index of participating projects; a `"declined"` entry is this developer's no, not the project's |
| `.cache.json` | Disposable (node ids, the news cursor). Never quote it as state |

Both files present and readable: answer from them and stop — say the source, then report only what was asked. Either one missing or unreadable: fall through to step 2 for the part you are missing, and say which part came from where.

## 2. Fallback — read what the machine published

### a. Resolve the home slug

In this order, and SAY which one you used:

1. A half-present `settings.json` — its `.site.repo`, even when `.repos.json` is gone.
2. The site pointer, when a site URL is known (`site.url`, or the user names it): `curl -fsSL "<site>/data/home.json"` → `{"home":"<owner>/<name>","branch":"<roster branch>"}`. It is the only file published beside the pages, and it carries the roster's branch — do not assume `main`.
3. The user — ask them to name the home repo.
4. Last, a GUESS from the session's login: `gh api user -q .login` then `<login>/workkit`. Label it a guess in the answer; a wrong slug reads as an empty board.

### b. The roster — `data/repos.json` on the home repo's DEFAULT branch

Private, and authenticated. **Not `gh-pages`** — the roster left the public branch in #110, because Pages is public even from a private repo and repo names are private when the repos are.

```sh
slug='<owner>/<name>'
# The pointer's `branch` (step 2a) IS the roster's branch — the publisher writes
# whatever branch its clone is on, which is why #112 put it in the pointer. Ask
# GitHub for the default branch ONLY when there was no pointer to read.
branch='<branch from data/home.json>'
[ -n "$branch" ] || { branch="$(gh api "repos/$slug" -q '.default_branch' 2>/dev/null || true)"; : "${branch:=main}"; }
gh api "repos/$slug/contents/data/repos.json?ref=$branch" -q '.content' 2>/dev/null | tr -d '\n' | base64 -d 2>/dev/null
```

Same shape the cloud brief's runner reads (the roster fetch in `jobs/morning.sh`, whose pointerless world is where the default-branch probe comes from). The body is `{ "repos": ["<owner>/<name>", …], "home": "<owner>/<name>" }` — SLUGS, where the local roster holds absolute PATHS; the home repo rides along inside `repos` as well as under `home`. What this hands you is PRIVATE (see Gotchas) — it never goes into an issue, a comment, or any public surface.

A 404 or an empty answer means nothing is published there — the home repo ALONE is what you know (that can be a machine that never published, or a publish whose roster step was skipped). Say that; never report an empty roster as "no projects".

### c. The rest of the state, only as the question needs it

- **Captures / the cross-project queue** — `gh issue list --repo <home> --state open --label status:inbox --json number,title`.
- **Briefs and summaries** — Discussions on the home repo. Titles and dates:
  ```sh
  gh api graphql -f owner='<owner>' -f name='<name>' -f query='query($owner:String!,$name:String!){
    repository(owner:$owner,name:$name){ discussions(first:20, orderBy:{field:CREATED_AT,direction:DESC}){
      nodes { title createdAt url } } } }'
  ```
  A `brief: <date>` title is a morning brief; the rest are the published summaries.
- **A single project's queue** — `gh issue list --repo <slug> …` per roster entry, and only for the repos the question actually covers.

## 3. Always name the source

End every answer with one line of provenance, in plain words:

- `Read from the local files (~/.workkit/settings.json, ~/.workkit/.repos.json).`
- `Read from published data via the GitHub API — this machine has no ~/.workkit.`
- Mixed, or partial: say which piece came from where, and name what could NOT be read (`gh` missing, not authenticated, offline, a 404 on the roster) instead of leaving a silent hole.

## Gotchas

- **The roster is PRIVATE.** Repo names are private when the repos are. Never paste roster contents — slugs or paths — into an issue body, a comment, a PR, a discussion, or any other public surface; summarize by count instead. The `safety/issue-guard` hook cannot help here: it sees secrets, not names.
- **The two shapes differ.** Local roster = absolute paths on THIS machine. Published roster = `owner/name` slugs. Never mix them into one list without saying which is which.
- **`site.publish: null` is not `false`.** It is unanswered — the state to report is "nobody has been asked", and the fix is `workkit setup`, not an edit.
- **The tower clone (`~/.workkit/tower`) is never on the roster.** It is engine territory, known by path; a roster with no entry for it is correct.
- **Missing is not broken.** No `~/.workkit` at all is a machine that has never run `workkit setup` — report that, offer setup, and do not create anything.
