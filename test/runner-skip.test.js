// Tests for the skip lists of the kit's runner (packages/core/test/run.js):
// test/lib/skip.js's SKIP leaves suites out of every bare run, its CI_SKIP out of
// a bare run with CI set, a path after -- runs a listed suite only when it names the
// entry or a path inside it, and a stale entry stops every run.

const { stripVTControlCharacters } = require('util');
const { describe, test, expect } = require('./lib/harness');
const { linesOf } = require('./lib/run-lists');
const { SUITE, listFile, mkWorld } = require('./lib/runner-world');

const LIVE = {
  'test/live/x.test.js': SUITE("test('live case', () => {});"),
  'test/other.test.js': SUITE("test('other case', () => {});"),
};

const E2E = {
  'test/e2e/a.test.js': SUITE("test('e2e a case', () => {});"),
  'test/e2e/b.test.js': SUITE("test('e2e b case', () => {});"),
  'test/other.test.js': SUITE("test('other case', () => {});"),
};

// The world holding `files` and the skip file exporting `lists`, run with `args`.
const runWith = (files, lists, args = [], opts = {}) => {
  const w = mkWorld();
  w.write({ ...files, ...(lists ? { 'test/lib/skip.js': listFile(lists) } : {}) });
  return w.run(args, opts);
};

const skipLine = (output) => linesOf(output).map((line) => line.trim()).find((line) => line.startsWith('skip: '));

const e2eRan = (output) => output.includes('e2e a case') && output.includes('e2e b case');

describe('run.js: SKIP', () => {
  test('SKIP [test/live]: a bare run runs only the other suite, says 1 suite left out, and exits 0', () => {
    const { code, output } = runWith(LIVE, { SKIP: ['test/live'] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('other case') && !output.includes('live case'), `only the other suite ran, got: ${output}`).toBe(true);
    expect(skipLine(output), `the skip line, got: ${output}`).toBe('skip: 1 suite left out (test/lib/skip.js)');
    const lines = linesOf(output);
    expect(lines.findIndex((line) => line.trim().startsWith('skip: ')) < lines.findIndex((line) => line.startsWith('▶ ')), `before the first suite, got: ${output}`).toBe(true);
  });

  test('SKIP [test/live]: naming test/live/x.test.js or test/live after -- runs it', () => {
    for (const arg of ['test/live/x.test.js', 'test/live']) {
      const { code, output } = runWith(LIVE, { SKIP: ['test/live'] }, [arg]);
      expect(code, `${arg}: exit 0, got: ${output}`).toBe(0);
      expect(output.includes('live case'), `${arg}: the named suite ran, got: ${output}`).toBe(true);
    }
  });
});

// A path runs a listed suite only when it names the entry or a path inside it.
describe('run.js: a path wider than a skip entry', () => {
  test('SKIP [test/live] and -- test: only the other suite runs, and the line reads 1 suite left out', () => {
    const { code, output } = runWith(LIVE, { SKIP: ['test/live'] }, ['test']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('other case') && !output.includes('live case'), `only the other suite ran, got: ${output}`).toBe(true);
    expect(skipLine(output), `the skip line, got: ${output}`).toBe('skip: 1 suite left out (test/lib/skip.js)');
  });

  test('SKIP [test/live/x.test.js]: -- test/live runs only the second suite there with the line, and -- test/live/x.test.js runs x', () => {
    const files = { ...LIVE, 'test/live/y.test.js': SUITE("test('second live case', () => {});") };
    const wide = runWith(files, { SKIP: ['test/live/x.test.js'] }, ['test/live']);
    expect(wide.code, `test/live: exit 0, got: ${wide.output}`).toBe(0);
    const marks = linesOf(wide.output).map((line) => line.trim());
    expect(marks.includes('✓ second live case') && !marks.includes('✓ live case'), `test/live: only the second suite ran, got: ${wide.output}`).toBe(true);
    expect(skipLine(wide.output), `test/live: the skip line, got: ${wide.output}`).toBe('skip: 1 suite left out (test/lib/skip.js)');
    const named = runWith(files, { SKIP: ['test/live/x.test.js'] }, ['test/live/x.test.js']);
    expect(named.code, `test/live/x.test.js: exit 0, got: ${named.output}`).toBe(0);
    expect(linesOf(named.output).some((line) => line.trim() === '✓ live case'), `test/live/x.test.js: x ran, got: ${named.output}`).toBe(true);
  });

  test('SKIP [test/live] and -- test test/live/x.test.js: x runs with the suites elsewhere under test, and no line prints', () => {
    const { code, output } = runWith(LIVE, { SKIP: ['test/live'] }, ['test', 'test/live/x.test.js']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('live case') && output.includes('other case'), `x and the other suite ran, got: ${output}`).toBe(true);
    expect(skipLine(output), `no skip line, got: ${output}`).toBe(undefined);
  });

  test('SKIP [test/live] holding the only suites under test, and -- test: the run ends as when every suite is left out', () => {
    const { code, output } = runWith({ 'test/live/x.test.js': SUITE("test('live case', () => {});") }, { SKIP: ['test/live'] }, ['test']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('No test file found (*.test.js, *.test.mjs, *.test.cjs)')), `the no-suite line, got: ${output}`).toBe(true);
    expect(output.includes('live case'), `no suite ran, got: ${output}`).toBe(false);
  });
});

describe('run.js: CI_SKIP', () => {
  test('CI_SKIP [test/e2e] with CI not set: its suites run and no skip line prints', () => {
    const { code, output } = runWith(E2E, { CI_SKIP: ['test/e2e'] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(e2eRan(output), `the e2e suites ran, got: ${output}`).toBe(true);
    expect(skipLine(output), `no skip line, got: ${output}`).toBe(undefined);
  });

  test('CI_SKIP [test/e2e] with CI=true: its suites are left out and the line prints', () => {
    const { code, output } = runWith(E2E, { CI_SKIP: ['test/e2e'] }, [], { env: { CI: 'true' } });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('e2e a case') || output.includes('e2e b case'), `no e2e suite ran, got: ${output}`).toBe(false);
    expect(output.includes('other case'), `the other suite ran, got: ${output}`).toBe(true);
    expect(skipLine(output), `the skip line, got: ${output}`).toBe('skip: 2 suites left out (test/lib/skip.js)');
  });

  test('CI_SKIP [test/e2e] with CI=1: its suites are left out', () => {
    const { code, output } = runWith(E2E, { CI_SKIP: ['test/e2e'] }, [], { env: { CI: '1' } });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('e2e a case') || output.includes('e2e b case'), `no e2e suite ran, got: ${output}`).toBe(false);
  });

  test('CI_SKIP [test/e2e] with CI=true and test/e2e named after --: its suites run', () => {
    const { code, output } = runWith(E2E, { CI_SKIP: ['test/e2e'] }, ['test/e2e'], { env: { CI: 'true' } });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(e2eRan(output), `the named suites ran, got: ${output}`).toBe(true);
  });
});

describe('run.js: the skip file as a whole', () => {
  test('an entry naming no suite, CI not set: exit 1 with No suite matches <entry> (test/lib/skip.js) before any suite', () => {
    const { code, output } = runWith(E2E, { CI_SKIP: ['test/gone'] });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('No suite matches test/gone (test/lib/skip.js)')), `names the entry and the list, got: ${output}`).toBe(true);
    expect(output.includes('▶'), `no suite ran, got: ${output}`).toBe(false);
  });

  test('no skip file, or one exporting one list alone: every suite runs, less that one list', () => {
    const none = runWith(E2E, null, [], { env: { CI: 'true' } });
    expect(none.code, `no file: exit 0, got: ${none.output}`).toBe(0);
    expect(e2eRan(none.output) && none.output.includes('other case'), `no file: every suite ran, got: ${none.output}`).toBe(true);
    const skipOnly = runWith(E2E, { SKIP: ['test/e2e/a.test.js'] }, [], { env: { CI: 'true' } });
    expect(skipOnly.code, `SKIP alone: exit 0, got: ${skipOnly.output}`).toBe(0);
    expect(!skipOnly.output.includes('e2e a case') && skipOnly.output.includes('e2e b case'), `SKIP alone: only its suite left out, got: ${skipOnly.output}`).toBe(true);
    const ciOnly = runWith(E2E, { CI_SKIP: ['test/e2e/b.test.js'] }, [], { env: { CI: 'true' } });
    expect(ciOnly.code, `CI_SKIP alone: exit 0, got: ${ciOnly.output}`).toBe(0);
    expect(ciOnly.output.includes('e2e a case') && !ciOnly.output.includes('e2e b case'), `CI_SKIP alone: only its suite left out, got: ${ciOnly.output}`).toBe(true);
  });

  test('a SKIP that is a string: exit 1 with the shape line, and no suite runs', () => {
    const { code, output } = runWith(LIVE, { SKIP: 'test/live' });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('test/lib/skip.js: SKIP must be an array of paths')), `the shape line, got: ${output}`).toBe(true);
    expect(output.includes('▶'), `no suite ran, got: ${output}`).toBe(false);
  });

  test('a suite on SERIAL and on SKIP does not run', () => {
    const { code, output } = runWith({
      ...LIVE,
      'test/lib/serial.js': listFile({ SERIAL: ['test/live/x.test.js'] }),
    }, { SKIP: ['test/live/x.test.js'] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(output.includes('live case'), `the suite never ran, got: ${output}`).toBe(false);
  });

  test('every suite on SKIP: the run ends as a folder with no suite does', () => {
    const { code, output } = runWith(LIVE, { SKIP: ['test'] });
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('No test file found (*.test.js, *.test.mjs, *.test.cjs)')), `the no-suite line, got: ${stripVTControlCharacters(output)}`).toBe(true);
    expect(output.includes('live case') || output.includes('other case'), `no suite ran, got: ${output}`).toBe(false);
  });
});
