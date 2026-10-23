// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: check 6, a closed issue carries its Proof:
// comment, read through `issueView`; and the guard on the module's Bash
// chain. Each case ports the HEAD case its name quotes; "hooks.json registers
// the gate under PreToolUse Bash" reads BASH_GUARDS now.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, assertEq, summary, selfRun } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');
const {
  T, mkRepo, stage, touchMarker, judge, blocks, passes, shipReadyRepo,
} = require('./helpers');

// Each issue OPEN at status:complete, carrying the given comments.
const withComments = (r, map) => {
  r.issues = Object.fromEntries(Object.entries(map).map(([n, comments]) => [n, { comments }]));
  return r;
};

const run = async () => {
  group('commit-gate: check 6, a closed issue carries its Proof: comment (issue #233)');

  await test('ports "a Fixes trailer whose issue has no Proof: comment blocks"', async () => {
    const r = withComments(shipReadyRepo(), { 4: ['QA passed by the owner, 2026-09-10.'] });
    blocks(await judge(r, 'git commit -m "feat: a thing\n\nFixes #4"'), T.unproved(' #4'), 'names the issue and what is missing');
  });

  await test('ports "a repo that keeps no CHANGELOG.md is never asked for a proof, even when gh can answer"', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    touchMarker(r);
    withComments(r, { 4: ['looks good to me'] });
    passes(await judge(r, 'git commit -m "feat: a thing\n\nFixes #4"'), '', 'allowed outside the pipeline');
    assertEq(r.calls.issueView.length, 0, 'and gh is never asked');
  });

  await test('ports "the same commit passes once the issue carries its proof"', async () => {
    const r = withComments(shipReadyRepo(), { 4: ['Proof: unit: node tests/hooks/x.test.js'] });
    passes(await judge(r, 'git commit -m "feat: a thing\n\nFixes #4"'), '', 'allowed');
  });

  await test('ports "every unproved issue in the message is named"', async () => {
    const r = withComments(shipReadyRepo(), { 4: ['Proof: unit: node tests/hooks/x.test.js'], 9: ['looks good'], 12: ['ok'] });
    blocks(await judge(r, 'git commit -m "feat: a thing\n\nFixes #4\nCloses #9\nResolves #12"'), T.unproved(' #9 #12'), 'names both, never the proved one');
  });

  await test('ports "no trailer, no proof read"', async () => {
    const r = withComments(shipReadyRepo(), {});
    passes(await judge(r, 'git commit -m "feat: a thing that closes nothing"'), '', 'a commit closing nothing is never asked for a proof');
    assertEq(r.calls.issueView.length, 0, 'and nothing is read');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
