# Brief: {{title}}

Role: test-developer (`workkit:worker`), defined in `docs/agents.md` § Crew sizing.
Repo: {{repo}}
Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, scripts/ and skills/ path here is the kit's).
Read first: {{guides}}
Spec: the `### Contract` and the Description of {{issue}}. Where this brief and the Contract differ, the Contract wins; say so in the report.

## Task

{{task}}

Write one test per Contract case, from the Contract and the Description, never from the source: a feature-developer builds the source at the same time, and its files are not yours to read. Red first.

## Paths

Yours: {{paths}}
The other roles': {{other-paths}}. Touch none of them.

## Verify

Run only: {{tests}}
Report your run's result as you saw it; what that run proves is `docs/agents.md` § Crew sizing's.

## Report

Status first, inline, as `agents/worker.md` § Dispatch contract says; then:
- the files touched, and each test with the Contract case it asserts;
- your run's summary lines, as you saw them;
- any Contract case with no test, and why;
- where this brief and the Contract differed, and which you followed.
