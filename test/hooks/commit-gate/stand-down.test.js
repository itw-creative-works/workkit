// Tests for safety:commit-gate's logic, preCommitVerdict(facts) in
// hooks/mods/commit-gate.js: check 5 never stands down silently. The wiring,
// a real git commit through the hooks, is test/scripts/githooks.test.js.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { describe, test, expect } = require('../../lib/harness');
const {
  NOTICE, mkRepo, stage, judge, passes, suiteRan, mkReleaseRepo,
} = require('./helpers');

const docsStaged = () => {
  const r = mkRepo();
  stage(r, 'README.md', '# docs\n');
  return r;
};

describe('commit-gate: check 5 never stands down silently (issue #155)', () => {
  test('docs-only commit in a repo with a test script: exit 0, and says why', async () => {
    const r = mkReleaseRepo();
    stage(r, 'README.md', '# docs\n');
    passes(await judge(r, 'docs: readme'), NOTICE.noCode, 'allowed, naming the stand-down and its classification');
    expect(!suiteRan(r), 'the suite still stands down').toBeTruthy();
  });

  test('nothing staged in a repo with a test script: exit 0, and says why', async () => {
    passes(await judge(mkReleaseRepo(), 'chore: nothing'), NOTICE.nothing, 'an empty index passes through, naming what stood down');
  });

  test('a repo with NO test script is never told about a suite: exit 0, silent', async () => {
    passes(await judge(docsStaged(), 'docs: readme'), '', 'a repo without tests is not asked about them');
  });
});
