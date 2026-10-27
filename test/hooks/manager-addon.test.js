// Tests for manager:addon's logic, addonContext(text) in hooks/mods/addon.js:
// a blank add-on adds nothing. The header, which file is read, the default
// home, the foreign agent types and the unreadable file are
// test/mods/subagent-start.test.ts.

// HEAD case retired with the mod (the engine parses the input): "garbage stdin exits 0 silently".
// HEAD case ported under new names in test/mods/subagent-start.test.ts: "hooks.json registers the hook
// under SubagentStart, matcher ^workkit:" as the "agent_type <type> gets nothing" cases and
// "loader routes manager:addon": the fire leaves a run line.

const { group, test, assertEq, summary, selfRun } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

const cases = async () => {
  group('manager-addon: silence');
  for (const [label, text] of [['an empty file', '']]) {
    await test(`ports "${label}: exit 0, no output"`, () => {
      assertEq(textOf(mods('addon').addonContext(text)), '', 'a blank add-on adds nothing');
    });
  }
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
