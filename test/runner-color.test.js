// Tests for the color of the kit's runner (packages/core/test/run.js): it writes no
// color code of its own, and paints what it prints by Node's rule, so a pipe gets
// plain lines, FORCE_COLOR=1 gets the same lines painted, and NO_COLOR keeps them plain.
// A failure Node colors under FORCE_COLOR reads as it does without it.

const { stripVTControlCharacters } = require('util');
const { describe, test, expect } = require('./lib/harness');
const { SUITE, mkWorld } = require('./lib/runner-world');

const ESC = '\u001b';
const GREEN = `${ESC}[32m`;
const RED = `${ESC}[31m`;

// One suite with a passing, a failing and a skipped case.
const MIXED = SUITE(`
test('passes', () => {});
test('fails', () => { expect(1).toBe(2); });
test('waits', { skip: 'later' }, () => {});
`);

// The env with none of the variables that bend Node's color rule, `extra` over it.
const colorEnv = (extra = {}) => ({
  FORCE_COLOR: undefined, NO_COLOR: undefined, NODE_DISABLE_COLORS: undefined, ...extra,
});

// One suite that does not parse, and one whose case fails on Node's own deep equality.
const UNPARSED = 'const x = ;\n';
const DEEP = SUITE(`
const assert = require('assert');
test('differs', () => { assert.deepStrictEqual({ a: 1, b: 'same' }, { a: 2, b: 'same' }); });
`);

// A world holding `suite` as test/x.test.js, run once per env given: each run's code and output.
const runSuite = (suite, ...envs) => {
  const w = mkWorld();
  w.write({ 'test/x.test.js': suite });
  return envs.map((env) => w.run([], { env: colorEnv(env) }));
};
const runMixed = (...envs) => runSuite(MIXED, ...envs);

// The lines of a run, its durations read as one word, so two runs compare.
const shapeOf = (output) => output.split(/\r?\n/).map((line) => line.replace(/\d+(?:\.\d+)?m?s\b/g, 'Ns'));

const markLine = (output, mark) => output.split(/\r?\n/).find((line) => stripVTControlCharacters(line).includes(mark));

// The lines after `Failures:`, whatever wraps that heading.
const failuresOf = (lines) => lines.slice(lines.findIndex((line) => stripVTControlCharacters(line) === 'Failures:') + 1);

// A line with the painter's own wrap taken off, by the painter's rule (paint.js): only a line
// that starts as the rule says, so a code Node wrote inside a message stays.
const unpaint = (line) => line
  .replace(/^(\s*)\u001b\[32m✓\u001b\[39m/, '$1✓')
  .replace(/^(\s*)\u001b\[31m(✗.*)\u001b\[39m$/, '$1$2')
  .replace(/^(\s*)\u001b\[90m((?:⊘|slowest:).*)\u001b\[39m$/, '$1$2')
  .replace(/^(\s*)\u001b\[1m((?:▶|\[|\d+ passed|Failures:).*)\u001b\[22m$/, '$1$2');

// The failed case's block (its ✗ line to the blank line after it) and the Failures: list.
const failedParts = (lines) => {
  const at = lines.findIndex((line) => stripVTControlCharacters(line).trim().startsWith('✗ differs'));
  const end = lines.findIndex((line, i) => i > at && line.trim() === '');
  return { block: lines.slice(at, end), failures: failuresOf(lines) };
};

describe('run.js: color by Node\'s rule', () => {
  test('a pass, a failure and a skip written to a pipe with no FORCE_COLOR: no escape byte in the output', () => {
    const [{ code, output }] = runMixed({});
    expect(code, `exit 1 for the failure, got: ${output}`).toBe(1);
    const plain = stripVTControlCharacters(output);
    for (const mark of ['✓ passes', '✗ fails', '⊘ waits']) expect(plain.includes(mark), `the run printed ${mark}, got: ${output}`).toBe(true);
    expect(output.includes(ESC), `no escape byte, got: ${JSON.stringify(output)}`).toBe(false);
  });

  test('the same run under FORCE_COLOR=1: the ✓ line green, the ✗ line red, and with the codes removed the lines of the plain run', () => {
    const [plain, forced] = runMixed({}, { FORCE_COLOR: '1' });
    expect(forced.code, `exit 1 for the failure, got: ${forced.output}`).toBe(1);
    const pass = markLine(forced.output, '✓ passes');
    const fail = markLine(forced.output, '✗ fails');
    expect(Boolean(pass) && pass.includes(`${GREEN}✓`), `the ✓ line holds the green code, got: ${JSON.stringify(pass)}`).toBe(true);
    expect(Boolean(fail) && fail.includes(`${RED}✗`), `the ✗ line holds the red code, got: ${JSON.stringify(fail)}`).toBe(true);
    expect(shapeOf(stripVTControlCharacters(forced.output)), `the plain run's lines, plain: ${plain.output}`).toEqual(shapeOf(plain.output));
  });

  test('the same run under FORCE_COLOR=1 and NO_COLOR=1: no escape byte in the output', () => {
    const [{ code, output }] = runMixed({ FORCE_COLOR: '1', NO_COLOR: '1' });
    expect(code, `exit 1 for the failure, got: ${output}`).toBe(1);
    expect(stripVTControlCharacters(output).includes('✓ passes'), `the run printed its marks, got: ${output}`).toBe(true);
    expect(output.includes(ESC), `no escape byte, got: ${JSON.stringify(output)}`).toBe(false);
  });
});

describe('run.js: a failure reads the same under FORCE_COLOR=1', () => {
  test('a suite that does not parse, under FORCE_COLOR=1: Failures: names it load, the line a plain run prints', () => {
    const [plain, forced] = runSuite(UNPARSED, {}, { FORCE_COLOR: '1' });
    const plainFailures = shapeOf(plain.output).filter(Boolean);
    const forcedFailures = shapeOf(stripVTControlCharacters(forced.output)).filter(Boolean);
    const named = failuresOf(forcedFailures);
    expect(named.some((line) => line.trim().startsWith('- load test/x.test.js: ')), `named load test/x.test.js, got: ${forced.output}`).toBe(true);
    expect(named, `the plain run's Failures: lines, plain: ${plain.output}`).toEqual(failuresOf(plainFailures));
  });

  test('a case failing on assert.deepStrictEqual, under FORCE_COLOR=1: its block and its Failures: lines, the painter\'s wrap off, are the plain run\'s', () => {
    const [plain, forced] = runSuite(DEEP, {}, { FORCE_COLOR: '1' });
    expect(forced.code, `exit 1 for the failure, got: ${forced.output}`).toBe(1);
    const want = failedParts(shapeOf(plain.output));
    const got = failedParts(shapeOf(forced.output).map(unpaint));
    expect(want.block.length > 1, `the plain run printed the case's message under its mark, got: ${plain.output}`).toBe(true);
    expect(got.block, `the case block, forced: ${JSON.stringify(forced.output)}`).toEqual(want.block);
    expect(got.failures, `the Failures: lines, forced: ${JSON.stringify(forced.output)}`).toEqual(want.failures);
  });
});
