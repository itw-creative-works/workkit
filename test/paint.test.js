// Tests for workkit-core's painter (packages/core/test/lib/paint.js): `paint(text, stream)`
// colors a line by how it starts, after its indent, when the stream takes color by
// Node's rule, and hands the text back as it is otherwise. Run as a script it is the
// filter, painting each whole line of its input.

const path = require('path');
const { Writable } = require('stream');
const {
  describe, test, expect, before, after, until, start,
} = require('./lib/harness');
const { aloneEnv } = require('./lib/alone-env');

const PAINT = path.join(__dirname, '..', 'packages', 'core', 'test', 'lib', 'paint.js');
const { paint } = require(PAINT);

const ESC = '\u001b';
const GREEN = `${ESC}[32m`;
const RED = `${ESC}[31m`;
const GRAY = `${ESC}[90m`;
const COLOR_OFF = `${ESC}[39m`;
const BOLD = `${ESC}[1m`;
const BOLD_OFF = `${ESC}[22m`;

// The variables that bend Node's color rule, unset for the in-process cases so the stream decides.
const COLOR_VARS = ['FORCE_COLOR', 'NO_COLOR', 'NODE_DISABLE_COLORS'];

// A stream that is no terminal, and a terminal that shows color.
const sink = () => new Writable({ write(chunk, encoding, done) { done(); } });
const terminal = () => Object.assign(sink(), { isTTY: true, getColorDepth: () => 8, hasColors: () => true });

const BOLD_LINES = ['▶ test/x.test.js', '[outer › inner]', '3 passed, 0 failed (1.2s, 1 suite)', 'Failures:'];
const PLAIN_LINES = ['    at x.js:3', 'supervise: exit 0'];

describe('paint: a line on a stream that takes color', () => {
  const saved = {};
  before(() => {
    for (const name of COLOR_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });
  after(() => {
    for (const name of COLOR_VARS) if (saved[name] !== undefined) process.env[name] = saved[name];
  });

  test('`  ✓ adds`: the mark wrapped in green, the indent and the name unchanged', () => {
    expect(JSON.stringify(paint('  ✓ adds', terminal()))).toBe(JSON.stringify(`  ${GREEN}✓${COLOR_OFF} adds`));
  });

  test('`  ✗ adds`: the line after its indent red', () => {
    expect(JSON.stringify(paint('  ✗ adds', terminal()))).toBe(JSON.stringify(`  ${RED}✗ adds${COLOR_OFF}`));
  });

  test('`  ⊘ adds: later`: the line after its indent gray', () => {
    expect(JSON.stringify(paint('  ⊘ adds: later', terminal()))).toBe(JSON.stringify(`  ${GRAY}⊘ adds: later${COLOR_OFF}`));
  });

  test('a ▶ heading, a [describe › path] heading, the totals line and Failures: bold; slowest: gray', () => {
    for (const line of BOLD_LINES) {
      expect(JSON.stringify(paint(line, terminal())), `bold: ${line}`).toBe(JSON.stringify(`${BOLD}${line}${BOLD_OFF}`));
    }
    expect(JSON.stringify(paint('slowest: a 1.2s', terminal())), 'gray: slowest:').toBe(JSON.stringify(`${GRAY}slowest: a 1.2s${COLOR_OFF}`));
  });

  test('a stack frame and a closing line: the same bytes back', () => {
    for (const line of PLAIN_LINES) expect(JSON.stringify(paint(line, terminal())), line).toBe(JSON.stringify(line));
  });

  test('a stream that is no terminal, with no FORCE_COLOR: every line above comes back as the same bytes', () => {
    const lines = ['  ✓ adds', '  ✗ adds', '  ⊘ adds: later', ...BOLD_LINES, 'slowest: a 1.2s', ...PLAIN_LINES];
    for (const line of lines) expect(JSON.stringify(paint(line, sink())), line).toBe(JSON.stringify(line));
  });
});

describe('paint.js run as the filter', () => {
  test('under FORCE_COLOR=1: lines split mid-line arrive whole and painted, once each; a last line with no line end is written at the end of input', async (t) => {
    const filter = start(process.execPath, [PAINT], {
      env: aloneEnv({ FORCE_COLOR: '1', NO_COLOR: undefined, NODE_DISABLE_COLORS: undefined }),
      stdin: 'open',
    });
    t.after(() => filter.end('SIGKILL'));
    let exit = null;
    filter.done.then((value) => { exit = value; });

    // The first chunk ends inside the mark's bytes, the second inside the ✗ line.
    const first = Buffer.from('  ✓ adds\n');
    filter.child.stdin.write(first.subarray(0, 4));
    filter.child.stdin.write(Buffer.concat([first.subarray(4), Buffer.from('  ✗ br')]));
    expect(await until(() => filter.stdout().includes('adds\n')), `the first line never came out; stdout: ${JSON.stringify(filter.stdout())}, stderr: ${filter.stderr()}`).toBeTruthy();
    expect(JSON.stringify(filter.stdout()), 'the first line alone, painted, nothing of the second yet').toBe(JSON.stringify(`  ${GREEN}✓${COLOR_OFF} adds\n`));

    filter.child.stdin.end('oke\nsupervise: exit 0');
    expect(await until(() => exit !== null), `the filter never ended at the end of its input; stderr: ${filter.stderr()}`).toBeTruthy();
    expect(exit.status, `the filter's exit, stderr: ${filter.stderr()}`).toBe(0);
    expect(JSON.stringify(filter.stdout()), 'each line once, whole; the last one at the end of input')
      .toBe(JSON.stringify(`  ${GREEN}✓${COLOR_OFF} adds\n  ${RED}✗ broke${COLOR_OFF}\nsupervise: exit 0`));
  });
});
