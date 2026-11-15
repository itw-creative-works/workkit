// Tests for a folder as a suite path in the kit's runner (packages/core/test/run.js):
// after `--` it names every suite under it by the bare run's rule, and on the
// serial list its suites run one by one after the wave, in the list's order.

const { describe, test, expect } = require('./lib/harness');
const { linesOf } = require('./lib/run-lists');
const { TOTALS } = require('./lib/core-repo');
const {
  SUITE, MOD_FILES, listFile, mkWorld, claudeStub,
} = require('./lib/runner-world');

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

// Fixture-side helpers for suites that meet across processes through files in the root.
const MEET = (root) => `
const fs = require('fs');
const path = require('path');
const ROOT = ${JSON.stringify(root)};
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const mark = (name, text = '') => fs.appendFileSync(path.join(ROOT, name), text);
`;

// The wave suite: it writes wave.done once a pause has passed.
const WAVE = (root) => SUITE(`${MEET(root)}
test('the wave writes its file', async () => { await sleep(400); mark('wave.done'); });
`);

// A tail suite: it fails unless the wave is done, and stamps its start and end around a pause.
const TAIL = (root, name) => SUITE(`${MEET(root)}
test('${name} runs after the wave', async () => {
  expect(fs.existsSync(path.join(ROOT, 'wave.done')), 'the wave had not finished').toBe(true);
  mark('stamps.txt', 'start ${name}\\n');
  await sleep(200);
  mark('stamps.txt', 'end ${name}\\n');
});
`);

// A suite that stamps its name as it runs.
const STAMP = (root, name) => SUITE(`${MEET(root)}
test('${name} stamps', () => { mark('stamps.txt', '${name}\\n'); });
`);

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

  test('a named folder that holds test/mods/a.test.ts starts the mod half', () => {
    const w = mkWorld();
    const claude = claudeStub();
    w.write({ ...HOOKS, ...MOD_FILES });
    const { output } = w.run(['test'], { bins: [claude.bin] });
    expect(claude.started(), `claude plugin test was started, got: ${output}`).toBe(true);
  });
});

describe('run.js: a folder on the serial list', () => {
  test('a SERIAL entry test/e2e runs both its suites after the wave, one at a time', () => {
    const w = mkWorld();
    w.write({
      'test/e2e/a.test.js': TAIL(w.root, 'e2e/a'),
      'test/e2e/b.test.js': TAIL(w.root, 'e2e/b'),
      'test/wave.test.js': WAVE(w.root),
      'test/lib/serial.js': listFile({ SERIAL: ['test/e2e'] }),
    });
    const { code, output } = w.run();
    expect(code, `exit 0, so both saw the wave done, got: ${output}`).toBe(0);
    const spans = [
      'start e2e/a\nend e2e/a\nstart e2e/b\nend e2e/b\n',
      'start e2e/b\nend e2e/b\nstart e2e/a\nend e2e/a\n',
    ];
    expect(spans.includes(w.read('stamps.txt')), `two closed spans, got: ${JSON.stringify(w.read('stamps.txt'))}`).toBe(true);
  });

  test('SERIAL [test/z.test.js, test/a] runs z.test.js first, then the suites under test/a in sorted order', () => {
    const w = mkWorld();
    w.write({
      'test/a/one.test.js': STAMP(w.root, 'a/one'),
      'test/a/two.test.js': STAMP(w.root, 'a/two'),
      'test/z.test.js': STAMP(w.root, 'z'),
      'test/wave.test.js': WAVE(w.root),
      'test/lib/serial.js': listFile({ SERIAL: ['test/z.test.js', 'test/a'] }),
    });
    const { code, output } = w.run();
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(w.read('stamps.txt'), `the list's order, got: ${output}`).toBe('z\na/one\na/two\n');
  });

  test('SERIAL naming a file and the folder that holds it runs that suite once, at the first entry', () => {
    const w = mkWorld();
    w.write({
      'test/a/one.test.js': STAMP(w.root, 'a/one'),
      'test/a/two.test.js': STAMP(w.root, 'a/two'),
      'test/wave.test.js': WAVE(w.root),
      'test/lib/serial.js': listFile({ SERIAL: ['test/a/two.test.js', 'test/a'] }),
    });
    const { code, output } = w.run();
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(w.read('stamps.txt'), `two at its own entry, then one, got: ${output}`).toBe('a/two\na/one\n');
    expect(headingsOf(output, 'test/a/two.test.js'), `one heading for two.test.js, got: ${output}`).toBe(1);
  });

  test('a SERIAL folder that holds no suite exits 1 with the serial No suite matches line before any suite', () => {
    const w = mkWorld();
    w.write({
      'test/other.test.js': SUITE("test('other case', () => {});"),
      'test/empty/notes.md': 'no suite here\n',
      'test/lib/serial.js': listFile({ SERIAL: ['test/empty'] }),
    });
    const { code, output, stderr } = w.run();
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(stderr).some((line) => line.endsWith('No suite matches test/empty (test/lib/serial.js)')), `names the entry and the list, got: ${stderr}`).toBe(true);
    expect(!output.includes('▶') && !output.includes('other case'), `no suite ran, got: ${output}`).toBe(true);
  });

  test('a serial.js exporting no SERIAL, or a SERIAL that is a string: exit 1 with the shape line, and no suite runs', () => {
    for (const [label, text] of [
      ['no SERIAL', listFile({})],
      ['a string', listFile({ SERIAL: 'test/other.test.js' })],
    ]) {
      const w = mkWorld();
      w.write({ 'test/other.test.js': SUITE("test('other case', () => {});"), 'test/lib/serial.js': text });
      const { code, output } = w.run();
      expect(code, `${label}: exit 1, got: ${output}`).toBe(1);
      expect(linesOf(output).some((line) => line.endsWith('test/lib/serial.js: SERIAL must be an array of paths')), `${label}: the shape line, got: ${output}`).toBe(true);
      expect(output.includes('▶'), `${label}: no suite ran, got: ${output}`).toBe(false);
    }
  });

  test('a narrowed run naming one suite under a serial folder runs it in the serial tail', () => {
    const w = mkWorld();
    w.write({
      'test/e2e/a.test.js': TAIL(w.root, 'e2e/a'),
      'test/e2e/b.test.js': TAIL(w.root, 'e2e/b'),
      'test/wave.test.js': WAVE(w.root),
      'test/lib/serial.js': listFile({ SERIAL: ['test/e2e'] }),
    });
    const { code, output } = w.run(['test/e2e/a.test.js', 'test/wave.test.js']);
    expect(code, `exit 0, so the named suite saw the wave done, got: ${output}`).toBe(0);
    expect(w.read('stamps.txt'), `only the named suite ran, got: ${output}`).toBe('start e2e/a\nend e2e/a\n');
  });
});
