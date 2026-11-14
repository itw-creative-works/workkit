// Tests for manager:addon's logic, addonContext(text) in hooks/mods/addon.js:
// a blank add-on adds nothing. The header, which file is read, the default
// home, the foreign agent types and the unreadable file are
// test/mods/subagent-start.test.ts.

const { describe, test, expect } = require('../lib/harness');
const { mods, textOf } = require('../lib/mods-inputs');

describe('manager-addon: silence', () => {
  for (const [label, text] of [['an empty file', '']]) {
    test(`${label}: exit 0, no output`, () => {
      expect(textOf(mods('addon').addonContext(text)), 'a blank add-on adds nothing').toBe('');
    });
  }
});
