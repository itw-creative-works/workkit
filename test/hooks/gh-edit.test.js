// Tests for the gh command read in hooks/mods/gh-edit.js that the gh guards
// share: ghSteps(command), one step per clause a cd does not spend, each with
// its text and whether a cd came before it in the command.

const { group, test, assert, assertEq, summary, selfRun } = require('../lib/harness');
const { mods } = require('../lib/mods-inputs');

const cases = async () => {
  group('gh-edit.js: ghSteps');

  await test('ghSteps yields one step per clause, the cd itself none, sawCd set on every step after a cd clause', () => {
    const steps = [...mods('gh-edit').ghSteps('gh issue edit 1 --add-label a && cd /x && gh issue edit 2 --add-label b')];
    assertEq(JSON.stringify(steps.map((s) => s.clause.trim())), JSON.stringify(['gh issue edit 1 --add-label a', 'gh issue edit 2 --add-label b']),
      'the two gh clauses, in order');
    assert(steps.every((s) => typeof s.sawCd === 'boolean'), `each step says whether a cd came first, got: ${JSON.stringify(steps)}`);
    assertEq(steps[0].sawCd, false, 'the clause before the cd saw none');
    assertEq(steps[1].sawCd, true, 'the clause after it did');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
