// Tests for safety:commit-gate's logic, commitGateVerdict(facts) in
// hooks/mods/commit-gate.js: stage-and-commit compounds fail closed, and check
// 5 never stands down silently. Each case ports the HEAD case its name
// quotes. Dropped with the shell spawn: "loader routes safety:commit-gate to
// the script (colon spelling)" (its run line is tests/mods/guards-commit-gate.test.ts).
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const { group, test, assert, summary, selfRun } = require('../../lib/harness');
const {
  T, NOTICE, mkRepo, stage, write, judge, blocks, passes, suiteRan, mkReleaseRepo,
} = require('./helpers');

const docsStaged = () => {
  const r = mkRepo();
  stage(r, 'README.md', '# docs\n');
  return r;
};

const run = async () => {
  group('commit-gate: stage-and-commit compounds fail closed (issue #155)');

  await test('ports "git add -A && git commit over a CLEAN index: exit 2"', async () => {
    const r = mkRepo();
    write(r, 'app.js', 'const x = 1;\n');
    blocks(await judge(r, 'git add -A && git commit -m "feat(x): y"'), T.stage, 'a command that stages its own content fails closed');
  });

  await test('ports "rm / mv / stage compounds are the same shape: exit 2"', async () => {
    for (const c of ['git rm old.js && git commit -m "chore: drop it"',
      'git mv a.js b.js && git commit -m "chore: move it"',
      'git stage app.js; git commit -m "feat: thing"']) {
      blocks(await judge(mkRepo(), c), T.stage, `must fail closed: ${c}`);
    }
  });

  await test('ports "a staging clause AFTER the commit is not the rule: exit 0"', async () => {
    passes(await judge(docsStaged(), 'git commit -m "docs: readme" && git add -A'), '', 'staging after the commit changes nothing it carries');
  });

  await test('ports "a quoted MENTION of staging does not trigger the rule: exit 0"', async () => {
    passes(await judge(docsStaged(), 'git commit -m "then git add -A"'), '', 'the quote strip hides the mention');
  });

  group('commit-gate: check 5 never stands down silently (issue #155)');

  await test('ports "docs-only commit in a repo with a test script: exit 0, and says why"', async () => {
    const r = mkReleaseRepo();
    stage(r, 'README.md', '# docs\n');
    passes(await judge(r, 'git commit -m "docs: readme"'), NOTICE.noCode, 'allowed, naming the stand-down and its classification');
    assert(!suiteRan(r), 'the suite still stands down');
  });

  await test('ports "nothing staged in a repo with a test script: exit 0, and says why"', async () => {
    passes(await judge(mkReleaseRepo(), 'git commit -m "chore: nothing"'), NOTICE.nothing, 'an empty index passes through, naming what stood down');
  });

  await test('ports "a repo with NO test script is never told about a suite: exit 0, silent"', async () => {
    passes(await judge(docsStaged(), 'git commit -m "docs: readme"'), '', 'a repo without tests is not asked about them');
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
