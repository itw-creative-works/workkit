// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in
// hooks/mods/commit-gate.js, the budget line: a recorded root run longer than
// `tests.budget` (whole minutes, the repo's .workkit/settings.json over the
// machine's settings.json) says so beside the proved notice, and the record
// still proves the tree.
// The prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../../lib/harness');
const {
  NOTICE, stage, commit, touchMarker, proveTree, judge, denyOf, contextOf, mkReleaseRepo,
} = require('./helpers');

const MINUTE_MS = 60000;

// The record a green root run leaves, carrying the run's wall time in ms.
const recordWithMs = (r, ms) => {
  proveTree(r);
  r.record = `${r.record}ms=${ms}\n`;
};

// A reviewed code commit in a repo whose settings carry `tests` (none: no key),
// its root run recorded as taking `ms`.
const timedCommit = (tests, ms) => {
  const r = mkReleaseRepo();
  stage(r, '.workkit/settings.json', `${JSON.stringify({ enabled: true, ...(tests ? { tests } : {}) }, null, 2)}\n`);
  commit(r);
  stage(r, 'app.js', 'const x = 2;\n');
  touchMarker(r);
  recordWithMs(r, ms);
  return r;
};

// The machine's settings file carrying `tests`, a real file the repo's facts point at.
const userBudget = (r, tests) => {
  r.userSettings = path.join(mkTmp('cg-budget-'), 'settings.json');
  fs.writeFileSync(r.userSettings, `${JSON.stringify({ version: 1, tests })}\n`);
  return r;
};

describe('commit-gate: the root run against tests.budget', () => {
  test('a recorded root run past tests.budget prints the test-budget line and the record still proves the tree', async () => {
    const v = await judge(timedCommit({ budget: 2 }, 5 * MINUTE_MS), 'feat: thing');
    expect(denyOf(v), 'the commit passes').toBe(null);
    const lines = contextOf(v).split('\n');
    expect(lines.includes(NOTICE.proved), `the proved notice, got: ${contextOf(v)}`).toBeTruthy();
    expect(lines.includes('test-budget: the root run took 5m, the budget is 2m'), `the budget line, got: ${contextOf(v)}`).toBeTruthy();
  });

  test('no tests.budget: no test-budget line', async () => {
    const v = await judge(timedCommit(null, 5 * MINUTE_MS), 'feat: thing');
    expect(denyOf(v), 'the commit passes').toBe(null);
    expect(contextOf(v), 'the proved notice alone').toBe(NOTICE.proved);
  });

  test('a tests.budget only in the machine settings file prints the test-budget line', async () => {
    const v = await judge(userBudget(timedCommit(null, 5 * MINUTE_MS), { budget: 3 }), 'feat: thing');
    expect(denyOf(v), 'the commit passes').toBe(null);
    expect(contextOf(v).split('\n').includes('test-budget: the root run took 5m, the budget is 3m'), `the budget line, got: ${contextOf(v)}`).toBeTruthy();
  });

  test("the repo's tests.budget wins over the machine's", async () => {
    const v = await judge(userBudget(timedCommit({ budget: 10 }, 5 * MINUTE_MS), { budget: 2 }), 'feat: thing');
    expect(contextOf(v), "the repo's 10m budget holds the 5m run: no budget line").toBe(NOTICE.proved);
  });
});
