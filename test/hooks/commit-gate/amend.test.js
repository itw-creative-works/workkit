// Tests for safety:commit-gate's logic, commitMsgVerdict(facts) in
// hooks/mods/commit-gate.js, on an amend: git runs commit-msg with nothing
// newly staged, so the message checks (8, 6, 7) judge the message alone and
// only check 4, which asks for a staged CHANGELOG.md, has nothing to read.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const { mods } = require('../../lib/mods-inputs');
const {
  PREFIX, T, mkRepo, stage, commit, touchMarker, factsOf, denyOf, blocks, ENTRY,
} = require('./helpers');

const PROVED = ['Proof: unit: node tests/hooks/x.test.js'];

// A repo whose last commit carried code and its CHANGELOG entry, reviewed, with
// nothing staged since: the state `git commit --amend -m` judges.
const amendable = (issues = {}) => {
  const r = mkRepo();
  stage(r, 'CHANGELOG.md', ENTRY);
  stage(r, 'app.js', 'const x = 1;\n');
  commit(r);
  touchMarker(r);
  r.issues = issues;
  return r;
};

/** commit-msg's verdict on `message` over the repo, as git asks it on an amend. */
const amend = (r, message) => {
  const facts = factsOf(r);
  expect(facts.staged.length, 'the amend stages nothing').toBe(0);
  return mods('commit-gate').commitMsgVerdict({ ...facts, message });
};

describe('commit-gate: an amend is judged on its message', () => {
  test('two issues on one closing line bounce on check 8 with nothing staged', async () => {
    const deny = denyOf(await amend(amendable(), 'fix: x\n\nFixes #4 #5'));
    expect(deny !== null && deny.startsWith(PREFIX) && deny.includes('#5'), `the amend is blocked naming #5, got: ${deny}`).toBeTruthy();
  });

  test('Fixes #4 for a proved issue still at status:building bounces on check 7 with nothing staged', async () => {
    const r = amendable({ 4: { comments: PROVED, labels: ['status:building'] } });
    blocks(await amend(r, 'fix: x\n\nFixes #4'), T.unpassed('#4 is at status:building'), 'names the stage');
  });

  test('check 4 asks nothing of an amend: Fixes #4 for a proved, passed issue passes with no CHANGELOG.md staged', async () => {
    const r = amendable({ 4: { comments: PROVED, labels: ['status:complete'] } });
    expect(denyOf(await amend(r, 'fix: x\n\nFixes #4')), 'no block').toBe(null);
  });
});
