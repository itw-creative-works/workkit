# Brief: {{title}}

Role: feature-developer (`workkit:worker`), defined in `docs/agents.md` § Crew sizing.
Repo: {{repo}}
Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, scripts/ and skills/ path here is the kit's).
Read first: {{guides}}
Spec: the `## Spec` and `### Contract` of {{issue}}. Where this brief and the Contract differ, the Contract wins; say so in the report.

## Task

{{task}}

Build the Contract's Names from the Contract and the Spec. A test-developer writes the tests from the same Contract at the same time: never read its test files.

## The bar

Cost: in-process through a seam unless the wiring is under test; a world from `seeded()`, copied per case; scratch from `mkTmp()`; no fixed path, port or sleep; a wait bound is the shared deadline, or a short bound passed to `until` for a negative case; a timing case asserts order, never a duration; a live probe behind a named flag that skips with its reason.

## Paths

Yours: {{paths}}
The other roles': {{other-paths}}. Touch none of them.

## Verify

Run: {{tests}}, then the suite of every module that requires a file you changed: its importers, one grep of the package's source per changed file for its basename, run once before the report.

## Report

Status first, inline, as `agents/worker.md` § Dispatch contract says; then:
- the files touched, each edit in one line;
- the summary lines of the runs above;
- any Contract line you could not meet, and why;
- any test you believe wrong, with the Contract case it misreads;
- where this brief and the Contract differed, and which you followed.
