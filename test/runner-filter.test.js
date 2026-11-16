// Tests for `--filter=<text>` on the kit's runner (packages/core/test/run.js): it
// runs only the cases whose full name (the describe path and the case's own name)
// holds the text as typed, in the suites the run would run anyway.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  describe, test, expect, mkTmp,
} = require('./lib/harness');
const {
  linesOf, listsOf, marksOf, totalsOf,
} = require('./lib/run-lists');
const {
  SUITE, MOD_FILES, mkWorld, claudeStub,
} = require('./lib/runner-world');

// alpha and beta under describe('outer'), gamma outside it.
const OUTER = SUITE(`
describe('outer', () => {
  test('alpha', () => {});
  test('beta', () => {});
});
test('gamma', () => {});
`);

// The world holding `files`, run with `args`.
const runWith = (files, args, opts) => {
  const w = mkWorld();
  w.write(files);
  return w.run(args, opts);
};

describe('run.js: --filter matches a case\'s full name', () => {
  test('--filter=alpha runs only alpha, under [outer], and the totals read 1 passed', () => {
    const { code, output } = runWith({ 'test/x.test.js': OUTER }, ['--filter=alpha']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `alpha alone, got: ${output}`).toEqual(['✓ alpha']);
    const lines = linesOf(output);
    expect(lines.indexOf('[outer]') >= 0 && lines.indexOf('[outer]') < lines.findIndex((line) => line.trim() === '✓ alpha'), `alpha under [outer], got: ${output}`).toBe(true);
    expect(totalsOf(output).startsWith('1 passed, 0 failed'), `1 passed, got: ${output}`).toBe(true);
  });

  test('--filter=outer runs alpha and beta, never gamma', () => {
    const { code, output } = runWith({ 'test/x.test.js': OUTER }, ['--filter=outer']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `the describe's two, got: ${output}`).toEqual(['✓ alpha', '✓ beta']);
  });

  test('--filter="outer alpha" runs alpha alone', () => {
    const { code, output } = runWith({ 'test/x.test.js': OUTER }, ['--filter=outer alpha']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `alpha alone, got: ${output}`).toEqual(['✓ alpha']);
  });

  test('--filter=Alpha matches nothing, since case counts: exit 1 with No case matches Alpha', () => {
    const { code, output } = runWith({ 'test/x.test.js': OUTER }, ['--filter=Alpha']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.trim() === 'No case matches Alpha'), `the no-match line, got: ${output}`).toBe(true);
  });

  test('--filter=a.b runs the case a.b and not axb: no character is a pattern', () => {
    const { code, output } = runWith({
      'test/x.test.js': SUITE("test('a.b', () => {});\ntest('axb', () => {});"),
    }, ['--filter=a.b']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `a.b alone, got: ${output}`).toEqual(['✓ a.b']);
  });

  test('--filter=root over alpha and beta matches nothing: Node\'s file-level <root> never counts as a name', () => {
    const { code, output } = runWith({
      'test/x.test.js': SUITE("test('alpha', () => {});\ntest('beta', () => {});"),
    }, ['--filter=root']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.trim() === 'No case matches root'), `the no-match line, got: ${output}`).toBe(true);
    expect(marksOf(output), `no case ran, got: ${output}`).toEqual([]);
  });

  test('--filter=root runs a case whose own name holds root, and only it', () => {
    const { code, output } = runWith({
      'test/x.test.js': SUITE("test('the root cause', () => {});\ntest('alpha', () => {});"),
    }, ['--filter=root']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `the root cause alone, got: ${output}`).toEqual(['✓ the root cause']);
  });
});

describe('run.js: what a filtered run prints and exits', () => {
  test('two suites and a filter matching in one: the other prints no heading and is no failure, exit 0', () => {
    const { code, output } = runWith({
      'test/x.test.js': OUTER,
      'test/y.test.js': SUITE("test('delta', () => {});"),
    }, ['--filter=alpha']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(linesOf(output).includes('▶ test/y.test.js'), `no heading for y, got: ${output}`).toBe(false);
    expect(totalsOf(output).startsWith('1 passed, 0 failed'), `no failure counted, got: ${output}`).toBe(true);
  });

  test('a filter matching no case in the run: exit 1 with No case matches <text>', () => {
    const { code, output } = runWith({ 'test/x.test.js': OUTER }, ['--filter=zeta']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.trim() === 'No case matches zeta'), `the no-match line, got: ${output}`).toBe(true);
  });

  test('--filter= and --filter given twice: exit 1 with their line, and no suite runs', () => {
    for (const [args, line] of [
      [['--filter='], '--filter needs a text'],
      [['--filter=a', '--filter=b'], '--filter is given once'],
    ]) {
      const { code, output } = runWith({ 'test/x.test.js': OUTER }, args);
      expect(code, `${args.join(' ')}: exit 1, got: ${output}`).toBe(1);
      expect(linesOf(output).some((l) => l.trim().endsWith(line)), `${args.join(' ')}: "${line}", got: ${output}`).toBe(true);
      expect(output.includes('▶'), `${args.join(' ')}: no suite ran, got: ${output}`).toBe(false);
    }
  });

  test('a bare --filter reads as the empty text: exit 1 with --filter needs a text, and no suite runs', () => {
    const { code, output } = runWith({ 'test/x.test.js': OUTER }, ['--filter']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((l) => l.trim().endsWith('--filter needs a text')), `the line, got: ${output}`).toBe(true);
    expect(output.includes('▶'), `no suite ran, got: ${output}`).toBe(false);
  });

  test('test/x.test.js --filter=alpha runs only the matching cases of x.test.js', () => {
    const { code, output } = runWith({
      'test/x.test.js': OUTER,
      'test/y.test.js': SUITE("test('alpha in y', () => {});"),
    }, ['test/x.test.js', '--filter=alpha']);
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(marksOf(output), `x's alpha alone, got: ${output}`).toEqual(['✓ alpha']);
  });

  test('a matched case that fails: exit 1, its mark and its failure print as in any run', () => {
    const { code, output } = runWith({
      'test/x.test.js': SUITE(`
describe('outer', () => {
  test('alpha', () => { throw new Error('alpha breaks'); });
  test('beta', () => {});
});
`),
    }, ['--filter=alpha']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(marksOf(output), `alpha's failure mark, got: ${output}`).toEqual(['✗ alpha']);
    expect(listsOf(output).some((line) => line.includes('test/x.test.js › outer › alpha: alpha breaks')), `the failure list names it, got: ${output}`).toBe(true);
  });

  test('a filtered run prints filter: <text> before the first suite heading', () => {
    const { output } = runWith({ 'test/x.test.js': OUTER }, ['--filter=alpha']);
    const lines = linesOf(output);
    const at = lines.findIndex((line) => line.trim() === 'filter: alpha');
    expect(at >= 0 && at < lines.findIndex((line) => line.startsWith('▶ ')), `the filter line first, got: ${output}`).toBe(true);
  });

  test('a bare run with --filter in a repo with a mod suite never starts the mod half, and its skip line names the flag', () => {
    const claude = claudeStub();
    const { code, output } = runWith({ 'test/x.test.js': OUTER, ...MOD_FILES }, ['--filter=alpha'], { bins: [claude.bin] });
    expect(code, `exit 0, got: ${output}`).toBe(0);
    expect(claude.started(), `claude was never started, got: ${output}`).toBe(false);
    expect(listsOf(output).some((line) => line.includes('mod half') && line.includes('--filter')), `the skip line names the flag, got: ${output}`).toBe(true);
  });

  test('a filtered run under WORKKIT_TEST_SUMMARY adds the counts of the cases that ran', () => {
    const file = path.join(mkTmp('runner-filter-summary-'), 'summary');
    const { output } = runWith({
      'test/x.test.js': SUITE(`
describe('outer', () => {
  test('alpha', () => {});
  test('beta', () => { throw new Error('beta breaks'); });
});
test('gamma', () => {});
`),
    }, ['--filter=outer'], { env: { WORKKIT_TEST_SUMMARY: file } });
    const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : null;
    expect(lines, `alpha's pass and beta's failure alone, got: ${stripVTControlCharacters(output)}`).toEqual(['{"passed":1,"failed":1}']);
  });

  test('--other is read as a path: No suite matches --other, exit 1', () => {
    const { code, output } = runWith({ 'test/x.test.js': OUTER }, ['--other']);
    expect(code, `exit 1, got: ${output}`).toBe(1);
    expect(linesOf(output).some((line) => line.endsWith('No suite matches --other')), `the line, got: ${output}`).toBe(true);
  });
});
