// Tests for skipping in the kit's runner (packages/core/test/run.js): a case skips
// itself in its own suite, so a repo still holding a test/lib/skip.js stops before any suite.

const { describe, test, expect } = require('./lib/harness');
const { linesOf } = require('./lib/run-lists');
const { SUITE, listFile, mkWorld } = require('./lib/runner-world');

describe('run.js: a leftover skip list', () => {
  test('a repo with a test/lib/skip.js: exit 1 with the line naming the in-suite skip, and no suite runs', () => {
    const w = mkWorld();
    w.write({
      'test/live/x.test.js': SUITE("test('live case', () => {});"),
      'test/other.test.js': SUITE("test('other case', () => {});"),
      'test/lib/skip.js': listFile({ SKIP: ['test/live'] }),
    });
    const { code, output } = w.run();
    expect(code, `exit 1, got: ${output}`).toBe(1);
    const line = 'test/lib/skip.js is no longer read: skip a case in its own suite';
    expect(linesOf(output).some((l) => l.endsWith(line)), `the leftover line, got: ${output}`).toBe(true);
    expect(output.includes('▶') || output.includes('live case') || output.includes('other case'), `no suite ran, got: ${output}`).toBe(false);
  });
});
