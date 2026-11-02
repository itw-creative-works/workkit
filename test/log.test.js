// Tests for the per-case log through the harness: a case's log lines print
// under it when it fails and stay quiet when it passes, TEST_LOG=1 prints them
// under both, a line logged outside any case prints at once, a failure
// names the test file's own frame, not the harness's, and the two indenters
// keep a quoted text off column zero.

const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, run, indentRest, indentWriter,
} = require('./lib/harness');

const HARNESS = path.join(__dirname, '..', 'packages', 'core', 'test', 'lib', 'harness.js');

// A suite on the kit's harness: a passing and a failing case that each log one
// line, then a closing case that bounds what prints under the failing one.
const SUITE = `
const { test, assert, log, summary, selfRun } = require(${JSON.stringify(HARNESS)});
const cases = async () => {
  await test('the passing case', () => { log('pass-side', 'note'); });
  await test('the failing case', () => { log('fail-side', 'note'); assert(false, 'it broke'); });
  await test('the closing case', () => {});
};
module.exports = async () => { await cases(); return summary(); };
if (require.main === module) selfRun(module.exports);
`;

// A suite that logs before its first case and between its first two, and two
// failing cases, the first logging a line of its own.
const OUTSIDE = `
const { test, assert, log, summary, selfRun } = require(${JSON.stringify(HARNESS)});
const cases = async () => {
  log('before-first', 'note');
  await test('the first case', () => { log('in-first', 'note'); assert(false, 'first broke'); });
  log('between', 'note');
  await test('the second case', () => { assert(false, 'second broke'); });
  await test('the closing case', () => {});
};
module.exports = async () => { await cases(); return summary(); };
if (require.main === module) selfRun(module.exports);
`;

// A suite that logs a two-line line before any case, in a passing case and in a failing case.
const TWO_LINES = `
const { test, assert, log, summary, selfRun } = require(${JSON.stringify(HARNESS)});
const cases = async () => {
  log('outside one\\noutside two');
  await test('the passing case', () => { log('passing one\\npassing two'); });
  await test('the failing case', () => { log('inside one\\ninside two'); assert(false, 'it broke'); });
  await test('the closing case', () => {});
};
module.exports = async () => { await cases(); return summary(); };
if (require.main === module) selfRun(module.exports);
`;

// The scratch suite `source` run by file, with `extra` over an env holding no TEST_LOG.
const runSuite = (extra = {}, source = SUITE) => {
  const file = path.join(mkTmp('log-'), 'scratch.test.js');
  fs.writeFileSync(file, source);
  const env = { ...process.env, ...extra };
  if (!('TEST_LOG' in extra)) delete env.TEST_LOG;
  const res = run(process.execPath, [file], { env });
  return { file, lines: stripVTControlCharacters(res.stdout).split(/\r?\n/) };
};

// The lines printed after case `name`'s own line and before case `next`'s.
const under = (lines, name, next) => {
  const from = lines.findIndex((l) => l.includes(name));
  const to = lines.findIndex((l) => l.includes(next));
  assert(from >= 0 && to > from, `cases "${name}" then "${next}" printed, got:\n${lines.join('\n')}`);
  return lines.slice(from + 1, to);
};

const cases = async () => {
  group('log: the per-case log');

  await test('log lines print under a failing case and not a passing one; with TEST_LOG=1 under both', () => {
    const quiet = runSuite().lines;
    assert(under(quiet, 'the failing case', 'the closing case').some((l) => l.includes('fail-side note')),
      `the failing case's line, its parts joined by a space, prints under it, got:\n${quiet.join('\n')}`);
    assert(!quiet.some((l) => l.includes('pass-side note')), `the passing case's line stays quiet, got:\n${quiet.join('\n')}`);
    const loud = runSuite({ TEST_LOG: '1' }).lines;
    assert(under(loud, 'the passing case', 'the failing case').some((l) => l.includes('pass-side note')), `TEST_LOG=1 prints the passing case's line under it, got:\n${loud.join('\n')}`);
    assert(under(loud, 'the failing case', 'the closing case').some((l) => l.includes('fail-side note')), `and the failing case's under it, got:\n${loud.join('\n')}`);
  });

  await test('a line logged outside any case prints at once, ahead of the next case; a line logged in a case prints under that case alone', () => {
    const { lines } = runSuite({}, OUTSIDE);
    const at = (text) => lines.findIndex((l) => l.includes(text));
    assert(at('before-first note') >= 0 && at('before-first note') < at('the first case'),
      `the line logged before the first case prints ahead of its mark, got:\n${lines.join('\n')}`);
    assert(at('between note') >= 0 && at('between note') < at('the second case'),
      `the line logged between cases prints ahead of the second case's mark, got:\n${lines.join('\n')}`);
    assert(under(lines, 'the first case', 'the second case').some((l) => l.includes('in-first note')),
      `the first case's own line prints under it, got:\n${lines.join('\n')}`);
    const second = under(lines, 'the second case', 'the closing case');
    assert(!second.some((l) => /in-first note|between note|before-first note/.test(l)),
      `nothing logged before the second case prints under it, got:\n${second.join('\n')}`);
  });

  await test('a logged line holding a newline prints its second line at the case indent, outside a case and under a failing one', () => {
    const { lines } = runSuite({}, TWO_LINES);
    assert(lines.includes('    outside two'), `the outside line's second line at the case indent, got:\n${lines.join('\n')}`);
    assert(under(lines, 'the failing case', 'the closing case').includes('    inside two'),
      `the failing case's second line under it at the case indent, got:\n${lines.join('\n')}`);
    assert(!lines.some((l) => l.startsWith('outside two') || l.startsWith('inside two')), `no second line at column zero, got:\n${lines.join('\n')}`);
  });

  await test('with TEST_LOG=1 a passing case\'s logged line holding a newline prints its second line at the case indent', () => {
    const { lines } = runSuite({ TEST_LOG: '1' }, TWO_LINES);
    assert(under(lines, 'the passing case', 'the failing case').includes('    passing two'),
      `the passing case's second line under it at the case indent, got:\n${lines.join('\n')}`);
    assert(!lines.some((l) => l.startsWith('passing two')), `no second line at column zero, got:\n${lines.join('\n')}`);
  });

  group('log: the failure names the test file');

  await test('a failing case carries the first stack frame from the test file, none from the harness', () => {
    const { file, lines } = runSuite();
    const block = under(lines, 'the failing case', 'the closing case');
    assert(block.some((l) => l.includes(`${file}:`)), `a frame naming ${file}, got:\n${block.join('\n')}`);
    const harnessFrame = `${path.join('packages', 'core', 'test', 'lib', 'harness.js')}:`;
    assert(!block.some((l) => l.includes(harnessFrame)), `no frame from the harness, got:\n${block.join('\n')}`);
  });

  group('log: the indenters');

  await test('indentRest leaves a one-line text as it is and prefixes every later line of a three-line text', () => {
    assertEq(indentRest('only line'), 'only line', 'a one-line text is unchanged');
    assertEq(indentRest('first\nsecond\nthird'), 'first\n    second\n    third', 'every line after the first at the case indent');
  });

  await test('indentWriter carries a line across chunks and indents each line once', () => {
    const written = [];
    const write = indentWriter((chunk) => written.push(chunk));
    for (const chunk of ['ab', 'c\nd', '\n']) write(chunk);
    assertEq(written.join(''), '    abc\n    d\n', 'every line at the case indent, a split line once');
  });

  // A real stream calls a write's callback on a later tick, so one turn of the loop has run it.
  await test('indentWriter writes a Buffer chunk indented and calls the callback passed with a chunk', async () => {
    const written = [];
    const sink = new Writable({ write(chunk, encoding, done) { written.push(String(chunk)); done(); } });
    const write = indentWriter(sink.write.bind(sink));
    let called = false;
    write(Buffer.from('one\ntwo\n'), () => { called = true; });
    await new Promise((resolve) => { setImmediate(resolve); });
    assertEq(written.join(''), '    one\n    two\n', 'the Buffer\'s lines at the case indent');
    assert(called, 'the callback passed with the chunk was called');
  });

  await test('indentWriter over a character split across two Buffer chunks writes it whole', () => {
    const written = [];
    const sink = new Writable({ write(chunk, encoding, done) { written.push(chunk); done(); } });
    const write = indentWriter(sink.write.bind(sink));
    write(Buffer.from([0xe2, 0x9c]));
    write(Buffer.from([0x93]));
    assertEq(Buffer.concat(written).toString(), '    ✓', 'the check mark at the case indent, its bytes whole');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
