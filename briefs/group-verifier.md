# Brief: {{title}}

Role: group-verifier (`workkit:verifier`), defined in `agents/verifier.md` § Behavior.
Repo: {{repo}}
Kit: {{kit}} (the workkit plugin's root; every docs/, agents/, scripts/ and skills/ path here is the kit's).
Read first: {{guides}}
Spec: the `### Contract` of {{issue}}.

## Task

{{task}}

The task names the pair's two briefs; their Paths sections are the SPLIT lists and the red-proof arguments. Judge the pair's merged diff against both briefs and the Contract. Answer the four pair checks, CASES, SPLIT, RED and GREEN, and the three DRIFT questions, each as a scored finding.
RED runs `scripts/red-proof.sh` over the feature-developer's source paths with the test-developer's test files, in the runnable form `agents/verifier.md` gives. A group with no test surface skips RED and says so.

## Diff

{{diff}}

Attribute only these hunks to this group; other groups edit other files in the same tree. The DRIFT questions still read the whole tree.

## Report

Status first, inline, as `agents/verifier.md` § Dispatch contract says; then:
- each check and each DRIFT answer as a finding with file:line, score and evidence;
- the red-proof output's last line as printed, or `red-proof: none (no test surface)`;
- the GREEN run's summary lines.
