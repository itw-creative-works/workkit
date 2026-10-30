// Tests for the per-case log through the harness: a case's log lines print
// under it when it fails and stay quiet when it passes, TEST_LOG=1 prints them
// under both, a line logged outside any case prints at once, and a failure
// names the test file's own frame, not the harness's.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, summary, selfRun, mkTmp, run,
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

  group('log: the failure names the test file');

  await test('a failing case carries the first stack frame from the test file, none from the harness', () => {
    const { file, lines } = runSuite();
    const block = under(lines, 'the failing case', 'the closing case');
    assert(block.some((l) => l.includes(`${file}:`)), `a frame naming ${file}, got:\n${block.join('\n')}`);
    const harnessFrame = `${path.join('packages', 'core', 'test', 'lib', 'harness.js')}:`;
    assert(!block.some((l) => l.includes(harnessFrame)), `no frame from the harness, got:\n${block.join('\n')}`);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
