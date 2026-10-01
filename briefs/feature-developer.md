# Brief: {{title}}

Role: feature-developer (`workkit:worker`), defined in `docs/agents.md` § Crew sizing.
Repo: {{repo}}
Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, scripts/ and skills/ path here is the kit's).
Read first: {{guides}}
Spec: the `## Spec` and `### Contract` of {{issue}}. Where this brief and the Contract differ, the Contract wins; say so in the report.

## Task

{{task}}

Build the Contract's Names from the Contract and the Spec. A test-developer writes the tests from the same Contract at the same time: never read its test files.

## Paths

Yours: {{paths}}
The other roles': {{other-paths}}. Touch none of them.

## Verify

Run only: {{tests}}

## Report

Status first, inline, as `agents/worker.md` § Dispatch contract says; then:
- the files touched, each edit in one line;
- the summary lines of the runs above;
- any Contract line you could not meet, and why;
- any test you believe wrong, with the Contract case it misreads;
- where this brief and the Contract differed, and which you followed.
