// Tests for workflow/lib/regex.js: escapeRegex, the one escape a text takes before it is built into a pattern.

const { describe, test, expect } = require('../lib/harness');
const { escapeRegex } = require('../../workflow/lib/regex');

describe('regex.js: escapeRegex', () => {
  test('every metacharacter is escaped, plain text is left as it is, and the pattern matches the text alone', () => {
    expect(escapeRegex('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o'), 'each metacharacter behind a backslash')
      .toBe('a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o');
    expect(escapeRegex('reading the roster'), 'no metacharacter, no change').toBe('reading the roster');
    const pattern = new RegExp(`^${escapeRegex('v1.2 (beta)*')}$`);
    expect(pattern.test('v1.2 (beta)*'), 'the text itself matches').toBe(true);
    expect(pattern.test('v1x2 beta'), 'a dot is no longer any character, a group no longer a group').toBe(false);
  });
});
