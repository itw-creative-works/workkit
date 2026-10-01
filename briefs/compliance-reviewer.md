# Brief: {{title}}

Role: compliance-reviewer (`workkit:reviewer`), the Compliance + spec lens of `skills/review/SKILL.md` § 2.
Repo: {{repo}}
Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, scripts/ and skills/ path here is the kit's).
Read first: {{guides}}
Spec: {{issue}}: the issue's `## Spec` and `### Contract`, or the task context when the diff has no issue.
You have no Bash: {{issue}} and {{diff}} arrive as pasted text or a path you can Read, never as a command to run.

## Task

{{task}}

Your mandate is the Compliance + spec entry of `skills/review/SKILL.md` § 2: rule compliance against the live docs, and spec-faithfulness against the Spec above. Apply it to the diff below.

## Diff

{{diff}}

## Report

Status first, inline, in the report format `agents/reviewer.md` gives; every finding with its file:line and evidence.
