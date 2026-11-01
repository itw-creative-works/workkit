// Tests for manager:addon's logic, addonContext(text) in hooks/mods/addon.js:
// a blank add-on adds nothing. The header, which file is read, the default
// home, the foreign agent types and the unreadable file are
// test/mods/subagent-start.test.ts.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const cases = async () => {
  group('manager-addon: silence');
  for (const [label, text] of [['an empty file', '']]) {
    await test(`${label}: exit 0, no output`, () => {
      assertEq(textOf(mods('addon').addonContext(text)), '', 'a blank add-on adds nothing');
    });
  }
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
