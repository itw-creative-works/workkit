// Tests for a folder as a suite path in the kit's runner (packages/core/test/run.js):
// after `--` it names every suite under it by the bare run's rule.

const { describe, test, expect } = require('./lib/harness');
const { linesOf } = require('./lib/run-lists');
const { TOTALS } = require('./lib/core-repo');
const { SUITE, mkWorld } = require('./lib/runner-world');

// Whether the run's totals line reads `passed` passing cases across `suites` suites.
const counted = (output, passed, suites) => linesOf(output).some((line) => TOTALS(passed, suites).test(line));

// Two suites under test/hooks and one elsewhere, each case named for its file.
const HOOKS = {
  'test/hooks/x.test.js': SUITE("test('x case', () => {});"),
  'test/hooks/y.test.js': SUITE("test('y case', () => {});"),
  'test/other.test.js': SUITE("test('other case', () => {});"),
};

// A suite no rule may read: it fails the run if it ever does.
const NEVER = SUITE("test('never read', () => { throw new Error('must not run'); });");

const headingsOf = (output, name) => linesOf(output).filter((line) => line === `▶ ${name}`).length;

describe('run.js: a folder after --', () => {
  test('test/hooks runs the two suites under it, named from the start folder, and no other', () => {
    const w = mkWorld();
    w.write(HOOKS);
    const { code, output } = w.run(['test/hooks']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    for (const name of ['test/hooks/x.test.js', 'test/hooks/y.test.js']) {
      expect(linesOf(output), `the heading of ${name}, got: ${output}`).toContain(`▶ ${name}`);
    }
    expect(output.includes('other case'), `the suite elsewhere never ran, got: ${output}`).toBe(false);
    expect(counted(output, 2, 2), `the totals count the two, got: ${output}`).toBe(true);
  });

  test('test/hooks/ and test\\hooks run the same two suites', () => {
    for (const arg of ['test/hooks/', 'test\\hooks']) {
      const w = mkWorld();
      w.write(HOOKS);
      const { code, output } = w.run([arg]);
      expect(code, `${arg}: exit 0, got: ${output}`).toBe(0);
      expect(output.includes('x case') && output.includes('y case') && !output.includes('other case'), `${arg}: the two ran, got: ${output}`).toBe(true);
      expect(counted(output, 2, 2), `${arg}: the totals count the two, got: ${output}`).toBe(true);
    }
  });

  test('test/hooks and test/hooks/x.test.js together run x.test.js once', () => {
    const w = mkWorld();
    w.write(HOOKS);
    const { code, output } = w.run(['test/hooks', 'test/hooks/x.test.js']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(headingsOf(output, 'test/hooks/x.test.js'), `one heading for x.test.js, got: ${output}`).toBe(1);
    expect(counted(output, 2, 2), `the totals count it once, got: ${output}`).toBe(true);
  });

  test('a folder that holds no suite exits 1 with No suite matches <arg>, and nothing runs', () => {
    const w = mkWorld();
    w.write({ ...HOOKS, 'test/empty/notes.md': 'no suite here\n' });
    const { code, output } = w.run(['test/other.test.js', 'test/empty']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('No suite matches test/empty')), `the line naming it, got: ${output}`).toBe(true);
    expect(!output.includes('▶') && !output.includes('other case'), `no suite ran, the named good one included, got: ${output}`).toBe(true);
  });

  test('a folder below the start folder that holds its own package.json and a suite exits 1 with No suite matches <arg>', () => {
    const w = mkWorld();
    w.write({ ...HOOKS, 'test/pkg/package.json': { name: 'pkg', private: true }, 'test/pkg/a.test.js': NEVER });
    const { code, output } = w.run(['test/pkg']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('No suite matches test/pkg')), `the line naming it, got: ${output}`).toBe(true);
    expect(output.includes('never read'), `the package's suite never ran, got: ${output}`).toBe(false);
  });

  test('a named folder runs its suites but none under _fixtures/, a git-ignored dist/ or a nested package', () => {
    const w = mkWorld();
    w.write({
      ...HOOKS,
      '.gitignore': 'test/hooks/dist/\n',
      'test/hooks/_fixtures/a.test.js': NEVER,
      'test/hooks/dist/b.test.js': NEVER,
      'test/hooks/nested/package.json': { name: 'nested', private: true },
      'test/hooks/nested/c.test.js': NEVER,
    });
    const { code, output } = w.run(['test/hooks']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('never read'), `none of the three ran, got: ${output}`).toBe(false);
    expect(counted(output, 2, 2), `x and y ran, got: ${output}`).toBe(true);
  });

  test('.. names no suite: exit 1 with No suite matches .., and nothing runs; . runs every suite of the start folder', () => {
    const above = mkWorld();
    above.write(HOOKS);
    const up = above.run(['..']);
    expect(up.code, `..: exit 1, got: ${up.output}`).toBe(1);
    expect(linesOf(up.output).some((line) => line.endsWith('No suite matches ..')), `..: the line naming it, got: ${up.output}`).toBe(true);
    expect(up.output.includes('▶'), `..: no suite ran, got: ${up.output}`).toBe(false);
    const here = mkWorld();
    here.write(HOOKS);
    const all = here.run(['.']);
    expect(all.code, `.: exit 0, got: ${all.output}`).toBe(0);
    expect(counted(all.output, 3, 3), `.: all three ran, got: ${all.output}`).toBe(true);
  });
});
