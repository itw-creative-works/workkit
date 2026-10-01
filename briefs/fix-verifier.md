# Brief: {{title}}

Role: fix-verifier (`workkit:verifier`), defined in `skills/review/SKILL.md` § Gotchas.
Repo: {{repo}}
Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, scripts/ and skills/ path here is the kit's).

## Task

{{task}}

A light pass over a review's fixes, never a new full review. For each finding below, ask one question: does the edit implement it without contradicting another file? Name any finding missing or half done.

## Findings

{{findings}}

## Diff

{{diff}}

## Verify

Run: {{tests}}

## Report

Status first, inline, as `agents/verifier.md` § Dispatch contract says; then:
- per finding: implemented, half done or missing, with file:line;
- each contradiction as a finding with both files' lines, score and evidence;
- the summary lines of the runs above.
