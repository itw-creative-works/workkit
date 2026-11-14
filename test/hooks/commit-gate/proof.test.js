// Tests for safety:commit-gate's logic, commitMsgVerdict(facts) in
// hooks/mods/commit-gate.js: check 6, a closed issue carries its Proof:
// comment, read through `issueView`.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');
const {
  T, mkRepo, stage, touchMarker, judge, blocks, passes, shipReadyRepo,
} = require('./helpers');

// Each issue OPEN at status:complete, carrying the given comments.
const withComments = (r, map) => {
  r.issues = Object.fromEntries(Object.entries(map).map(([n, comments]) => [n, { comments }]));
  return r;
};

describe('commit-gate: check 6, a closed issue carries its Proof: comment (issue #233)', () => {
  test('a Fixes trailer whose issue has no Proof: comment blocks', async () => {
    const r = withComments(shipReadyRepo(), { 4: ['QA passed by the owner, 2026-09-10.'] });
    blocks(await judge(r, 'feat: a thing\n\nFixes #4'), T.unproved(' #4'), 'names the issue and what is missing');
  });

  test('a repo that keeps no CHANGELOG.md is never asked for a proof, even when gh can answer', async () => {
    const r = mkRepo();
    stage(r, 'app.js', 'const x = 1;\n');
    touchMarker(r);
    withComments(r, { 4: ['looks good to me'] });
    passes(await judge(r, 'feat: a thing\n\nFixes #4'), '', 'allowed outside the pipeline');
    expect(r.calls.issueView.length, 'and gh is never asked').toBe(0);
  });

  test('the same commit passes once the issue carries its proof', async () => {
    const r = withComments(shipReadyRepo(), { 4: ['Proof: unit: node tests/hooks/x.test.js'] });
    passes(await judge(r, 'feat: a thing\n\nFixes #4'), '', 'allowed');
  });

  test('every unproved issue in the message is named', async () => {
    const r = withComments(shipReadyRepo(), { 4: ['Proof: unit: node tests/hooks/x.test.js'], 9: ['looks good'], 12: ['ok'] });
    blocks(await judge(r, 'feat: a thing\n\nFixes #4\nCloses #9\nResolves #12'), T.unproved(' #9 #12'), 'names both, never the proved one');
  });

  test('no trailer, no proof read', async () => {
    const r = withComments(shipReadyRepo(), {});
    passes(await judge(r, 'feat: a thing that closes nothing'), '', 'a commit closing nothing is never asked for a proof');
    expect(r.calls.issueView.length, 'and nothing is read').toBe(0);
  });
});
