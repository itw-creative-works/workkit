---
name: simplify
description: Test-gated simplification of recently-written code — green before, the same tests green after, or the change reverts. - Use ONLY when invoked (/workkit:simplify) or when the user asks to "simplify", "clean up this code", "tighten this up". NEVER fires proactively.
user-invocable: true
---

# Simplify — after green, inside the diff, prove it stayed green

Reduce recently-written code to its simplest correct form. The gate is absolute: **tests green before, the SAME tests green after, or the simplification reverts.**

## 1. Gate in

Run the project's test suite NOW. Red → STOP and report; this skill never fixes — a broken baseline makes "behavior preserved" unprovable. Record the exact command and its green result.

## 2. Scope

Default: the current uncommitted diff (`git diff` + `git diff --cached`); if the tree is clean, the last commit. The user may name a range or files instead. **Only touched code is in scope** — adjacent mess stays (Surgical Changes doctrine); mention it, don't fix it.

## 3. Simplify

Behavior stays EXACTLY the same — clarity over brevity (clearer sometimes means more lines):

- Run the deletion test on every addition in scope (`js:patterns` `resources/code-design.md`): wrappers that add nothing, options with one caller, defensive branches for impossible states — collapse them.
- Inline needless indirection; push complexity down so callers get the simple path.
- **Protect abstractions with a NAMED second consumer** (global §3) — an abstraction serving a stated plan is not clutter.
- No new features, no renamed public surface, no "while I'm here" fixes outside the diff.

## 4. Gate out

Re-run the SAME command from step 1. Green → keep. Red → revert the simplification entirely (`git checkout`/undo), report what broke — a failed simplification is a finding, not a starting point for repairs. Done-criteria: suite green on the simplified code, diff strictly smaller-or-clearer, nothing outside scope touched.
