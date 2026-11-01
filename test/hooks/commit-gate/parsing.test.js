// Tests for safety:commit-gate's logic, commitMsgVerdict(facts) in
// hooks/mods/commit-gate.js, check 8: a closing trailer that names more than
// one issue on one line.
// The shared prologue (the repo in memory, the facts, the texts) is ./helpers.js.

const {
  group, test, assert, summary, selfRun,
} = require('../../lib/harness');
const {
  PREFIX, mkRepo, stage, touchMarker, judge, denyOf, passes,
} = require('./helpers');

// Code staged and reviewed in a repo that keeps no CHANGELOG.md: a closing
// trailer meets no other check, so only the one-issue-per-line check can block.
const reviewedCode = () => {
  const r = mkRepo();
  stage(r, 'app.js', 'const x = 1;\n');
  touchMarker(r);
  return r;
};

// The commit of `message` over a reviewed repo: its block text, or null.
const trailerDeny = async (message) => denyOf(await judge(reviewedCode(), `feat: a thing\n\n${message}`));

const cases = async () => {
  group('commit-gate: one issue per closing line');

  await test('a closing line naming three issues bounces, naming the two it leaves open and showing one Fixes line per issue', async () => {
    const deny = await trailerDeny('Fixes #455 #456 #460');
    assert(deny !== null && deny.startsWith(PREFIX), `the commit is blocked, got: ${deny}`);
    assert(deny.includes('#456') && deny.includes('#460'), `the block names #456 and #460, got: ${deny}`);
    assert(/Fixes #455[ \t]*\r?\n[ \t]*Fixes #456/.test(deny), `the block shows Fixes #455, then Fixes #456 on the next line, got: ${deny}`);
  });

  await test('a comma or an `and` between the issues bounces too', async () => {
    for (const message of ['Fixes #455, #456', 'Fixes #455 and #456']) {
      const deny = await trailerDeny(message);
      assert(deny !== null && deny.startsWith(PREFIX) && deny.includes('#456'), `"${message}" is blocked naming #456, got: ${deny}`);
    }
  });

  await test('one Fixes line per issue passes', async () => {
    passes(await judge(reviewedCode(), 'feat: a thing\n\nFixes #455\nFixes #456'), '', 'each issue on its own line');
  });

  await test('two keywords on one line, each with its own issue, pass', async () => {
    passes(await judge(reviewedCode(), 'feat: a thing\n\nFixes #455, fixes #456'), '', 'each number has its own keyword');
  });

  await test('an issue named later on the line, after other words, passes', async () => {
    passes(await judge(reviewedCode(), 'feat: a thing\n\nFixes #455 after #440 landed'), '', 'only #455 is a closing reference');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
