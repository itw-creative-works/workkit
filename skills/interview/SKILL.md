---
name: interview
description: Alignment grill, a categorized sweep of every assumption and decision the human owns, asked in chat rounds with recommendations, closing by writing the spec from the answers. - Use when starting ambiguous work, before accepting a real spec, or on "interview me", "grill me", "ask me questions".
user-invocable: true
disallowed-tools: AskUserQuestion
---

# Interview: grill thoroughly, accept easily

Two jobs, one mechanism: surface EVERY assumption and decision the human owns, and pre-work each one so answering is nearly effortless.

- The output is not a transcript. It is the `## Spec`, written from the answers.
- A thorough grill is what MAKES acceptance easy. The human authors every call one at a time, so reading the spec is recognition, not review.

## Rule zero: never ask what you can find out

- Facts are yours to find: read the code, the docs, and the issues (open AND closed), and run the command.
- A closed **not planned** issue is a recorded rejection.
- Rule zero filters FACTS, never DECISIONS. A tradeoff, preference, scope call, risk acceptance, or naming call stays a question, even when you could confidently guess the answer.
- A guessed decision is an assumption wearing a spec.

## The sweep: coverage is what makes it a grill

Walk EVERY category against the task and collect the decisions each surfaces. Weak interviews ask only what blocks the next action; the questions nobody thought to ask are where misalignment lives.

- **Scope**: what is in, what is explicitly OUT, the half-related thing the human may assume is included.
- **Behavior & edge cases**: empty states, conflicts, ordering, the second run, the weird input.
- **Failure**: loud or quiet, retry or stop, who hears about it and where.
- **Surface & naming**: what the human sees, where, in what words; names that matter to them.
- **Data & compatibility**: what is stored where, what migrates, what changes for existing consumers.
- **Testing depth**: what proof this change deserves (global §6 sets the floor; the human sets appetite beyond it).
- **Non-goals**: what is deliberately NOT being built, said out loud so it cannot creep back.

Size the sweep and say it out loud:

- A small item clears most categories with nothing to decide. Name the cleared category; never pad it with filler.
- A subsystem gets multiple rounds.
- Filler questions are as much a failure as missing ones.

## How questions are asked: chat rounds, never a form

- **In chat, never a form.** Never the AskUserQuestion tool (the frontmatter removes it).
- **Rounds**: questions are batched in themed rounds of 3–5, highest-stakes round first.
  - The one exception is a BOARD round, where every question is "what happens to this issue" (build, park, close, talk).
  - One board round holds the whole board, because the human decides the set in one sitting.
  - It groups the issues by what the human must do: build on a yes / needs a design talk / stays parked unless pulled.
- **Every question explains its subject first, in plain words**, so the reader can decide without opening the issue. Before the options, one short paragraph says:
  - what the issue or thing IS;
  - what is wrong or missing today;
  - what the decision changes in practice.
- Small words, short sentences, no codenames or labels standing in for an explanation. A title alone, or a line lumping several issues, is the defect.
- **One shape, every question**: the SSOT for how a decision is put to the human, in an interview or anywhere else.
  - A numbered question, with its options as nested bullets under it, each a plain outcome.
  - The recommended option is ALWAYS the first bullet: bold, tagged "(Recommended)", with one short sentence of why.
  - Questions from one issue sit under a bold heading line carrying the issue link.
  - Never options inline in a paragraph, never a table.
  - Quality bar: the human can answer most questions with "yes" or a single word.

  ```
  **[#16](url), private-key auth**

  2. The Firebase backend. Today the brand has no backend of its own, so signin has nowhere to verify a key. Picking where it runs decides what `npm start` boots.
     - **New `targets/backend`, emulator only** (Recommended). `npm start` boots it with the rest.
     - Point at another brand's backend through an env var.
  ```
- **Coupled questions are one question.** Before a round is printed, check every question against the others in it.
  - If answering one settles or reshapes another, the two are ONE question.
  - The coupled part becomes an option, a sub-bullet of the recommended option, or a line inside the question, never a second numbered question.
  - The test: would the owner's answer to this question answer that one too? Then it is one question.
  - Bar: a round never carries two questions whose options overlap or whose answers depend on each other.
- **Re-derive between rounds.** Each round's answers may kill or spawn later questions. Never march through a fixed script.
- **Mid-build (frontier mode)**: ask only what changes the next action. Everything else gets your recommended default, stated in the report, reversible later.

## The close: the spec is written FROM the answers

The interview is done when the `## Spec` exists, not when the questions run out:

1. Draft (or deepen) the issue's `## Spec` from the answers. Each decision the human made lands as a spec statement in their terms; each category cleared with a default names that default.
2. Post it and ask for acceptance in chat: a recognition pass, not a review.
3. Durable rulings (preferences that outlive this task) get recorded verbatim and dated where they bind: `AGENTS.md`/`docs/` if doctrine, else a comment on the issue.
4. Note rejected directions. A real proposal that died closes its issue as **not planned**, with the ruling in a comment.

Done-criteria: zero open decisions, and a spec the human accepted.

## Never

- Never ask to reassure yourself ("shall I proceed?"). Proceed, per the autonomy rules.
- Never re-ask a decision recorded in the docs or on a closed issue. Cite it instead.
- Never hand over a finished spec draft for a yes WITHOUT the grill. The questions are what make the acceptance real (spec § Specs).
