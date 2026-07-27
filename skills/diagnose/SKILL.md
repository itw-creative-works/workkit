---
name: diagnose
description: Feedback-loop-first debugging — no hypothesis-driven edits before a red-capable reproduction exists; tagged observation, falsifiable hypotheses. - Use when investigating a bug, a failing test, unexpected behavior, or a crash. Triggers on "diagnose", "debug this", "why is this failing", "why doesn't this work", "not working", "broken", "repro", "root cause".
user-invocable: true
---

# Diagnose — loop first, hypothesis second

The iron rule: **build a feedback loop that shows the failure BEFORE you form a hypothesis or touch the code.** Guess-and-check edits without a repro destroy evidence and can't prove a fix.

## 1. Reproduce — the red-capable loop

Produce a command you can re-run that currently FAILS because of this bug and will pass when it's fixed: a failing test (best — it becomes the §6 bug-fix test), a script, or a curl/CLI invocation. Shrink it to the fastest reliable red. If you cannot reproduce, that IS the current task — instrument until you can; do not "fix" what you cannot see fail.

## 2. Observe — tagged instrumentation

Add logging with a per-session tag: `[DEBUG-x7k2]` (any 4-char id). Tagged output is greppable in noisy logs and strippable in one sweep when done. Log VALUES at boundaries (inputs, outputs, branches taken), not "got here". Prefer widening observation over narrowing guesses.

## 3. Hypothesize — falsifiable, one at a time

State the hypothesis with its prediction BEFORE testing it: "If X is the cause, then changing/logging Y will show Z." Run the loop. Prediction wrong → hypothesis dead — form the next one from the new evidence; do not stack a second speculative edit on top of a first. Sharp red signals (a crash with a stack) outrank soft symptoms — chase the loudest signal first (Loud Failures doctrine: the crash site is a gift).

## 4. Fix and prove

The repro from step 1 is the proof: red before the fix, green after, run in THIS session. Then run the surrounding suite for collateral damage.

## 5. Clean up

Strip every `[DEBUG-xxxx]` line (grep the tag to find them all). Keep the repro test. Done-criteria: repro test green in the suite, tag grep returns nothing, no unrelated lines changed.

## Never

- Never edit code "to see if it helps" before a repro exists — instrument instead.
- Never declare fixed on reasoning alone; only the loop going green counts.
- Never leave tagged debug output in the tree.
