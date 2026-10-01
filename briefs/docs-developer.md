# Brief: {{title}}

Role: docs-developer (`workkit:worker`), defined in `docs/agents.md` § Crew sizing.
Repo: {{repo}}
Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, scripts/ and skills/ path here is the kit's).
Read first: {{guides}}
Spec: the `## Spec` and `### Contract` of {{issue}}. Where this brief and the Contract differ, the Contract wins; say so in the report.

## Task

{{task}}

This group has no test surface, so you are its one worker: no test-developer, no red proof. Edit only the lines the task names, in each file's own voice.

## Paths

Yours: {{paths}}
The other roles': {{other-paths}}. Touch none of them.

## Verify

Run only the doc tests named here, or none: {{tests}}

## Report

Status first, inline, as `agents/worker.md` § Dispatch contract says; then:
- the files touched, each edit in one line;
- the summary lines of the runs above, or none;
- anything you could not do, and why;
- where this brief and the Contract differed, and which you followed.
