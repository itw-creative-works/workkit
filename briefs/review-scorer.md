# Brief: {{title}}

- Role: review-scorer (`workkit:verifier`), the scorer of `skills/review/SKILL.md` § 3.
- Repo: {{repo}}
- Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, workflow/ and skills/ path here is the kit's).

## Task

{{task}}

- Score every finding below and find none of your own.
  - Do it as the scorer line of `agents/verifier.md` § Behavior and `skills/review/SKILL.md` § 3 say.
- The false-positive list is the one `agents/verifier.md` points at.

## Findings

{{findings}}

## Diff

{{diff}}

## Report

- Status first, inline, as `agents/verifier.md` § Dispatch contract says.
- Then each finding with its file:line, your score and the evidence of the re-check, highest score first.
