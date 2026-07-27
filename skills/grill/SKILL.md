---
name: grill
description: Alignment interrogation — extract the decisions only the human can make, one question at a time, each with a recommended answer. - Use when starting ambiguous work, when a task has unstated requirements, when the user says "grill me", "ask me questions", "make sure we're aligned", "what do you need to know", or before committing to a design with open calls.
user-invocable: true
---

# Grill — extract the human's decisions, nothing else

Find every decision the human actually owns, ask about ONLY those, and get each one settled with the least reading burden. The agent finds facts; the human makes calls.

## Rule zero: never ask what you can find out

Before any question, exhaust your own means: read the code, the issues (open AND closed — a closed **not planned** issue is a recorded rejection), the docs, run the command. A question whose answer is discoverable is a failed question. The only legitimate questions are **decisions**: tradeoffs, preferences, scope calls, risk acceptance, naming that matters to the human.

## Every question carries a recommendation

Ask nothing open-ended. Each question states: the decision, the options, **your recommended option FIRST with one line of why** (label it "(Recommended)"). The human should be able to answer every question with "yes" — that's the quality bar for how well you've pre-worked it.

## Modes

- **Default — one at a time**: ask via AskUserQuestion, one question per call, highest-stakes first. Each answer may kill or spawn later questions — re-derive the list after every answer instead of marching through a fixed script.
- **Batch** (user says "batch", or the questions are independent): group up to 4 independent questions per AskUserQuestion call. Never batch questions where one answer changes another.
- **Frontier** (mid-work): ask ONLY questions that change your next action. Everything else gets your recommended default, stated in the report, reversible later.

## After each answer

- Durable ruling (a preference that outlives this task) → record it verbatim + dated in `AGENTS.md`/`docs/` if it is doctrine, else as a comment on the issue it binds (or offer to).
- Rejected direction → note it; if it was a real proposal, close its issue as **not planned** with the ruling in a comment (or file one to close, if the proposal had no issue).
- When no undecided question changes what you'd do next, SAY SO and stop grilling — done-criteria: zero open decisions that block the work.

## Never

- Never ask to reassure yourself ("shall I proceed?") — proceed, per the autonomy rules.
- Never re-ask a decision recorded in the docs or on a closed issue — cite it instead.
