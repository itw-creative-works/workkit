/* eslint-disable no-console */
//
// Tests for tests/run.js - the Node suite runner itself: its handling of a
// suite that skips for a missing precondition, and the by-file contract every
// suite it discovers must keep. `npm test` is the one command everywhere, so a
// suite the machine cannot answer must report a named skip and leave the run
// green, while a real throw still fails it; and `node tests/<path>.test.js`
// must run the suite on its own, so every suite ends with the selfRun line.
//

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, selfRun, summary } = require('./lib/harness');
const { findSuites } = require('./lib/suites');

const RUNNER = path.join(__dirname, 'run.js');
const HARNESS = path.join(__dirname, 'lib', 'harness.js');
const SUITES = path.join(__dirname, 'lib', 'suites.js');

// A throwaway tests/ tree holding one suite, run through the real runner.
const runWithSuite = (body) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  // The runner discovers suites beside itself and skips lib/, so the fixture
  // mirrors that layout: a copy of the runner, the real harness and suite
  // discovery, one suite.
  fs.copyFileSync(RUNNER, path.join(dir, 'run.js'));
  fs.copyFileSync(HARNESS, path.join(dir, 'lib', 'harness.js'));
  fs.copyFileSync(SUITES, path.join(dir, 'lib', 'suites.js'));
  fs.writeFileSync(path.join(dir, 'fixture.test.js'), body);
  const res = spawnSync('node', [path.join(dir, 'run.js')], { encoding: 'utf8', timeout: 20000 });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: res.status, output: (res.stdout || '') + (res.stderr || '') };
};

const SELF_RUN = /^if \(require\.main === module\) selfRun\(/m;

const SUITE = (inner) => `
const { test, assert, skip, skipSuite, summary } = require('./lib/harness');
const run = async () => {
${inner}
};
module.exports = async () => { await run(); return summary(); };
`;

const run = async () => {
  group('run.js: a suite that cannot run here');

  await test('a skipped suite names its reason and keeps the run green', () => {
    const { code, output } = runWithSuite(SUITE(`
  skipSuite('needs a thing this machine lacks');
  await test('never reached', () => { assert(false, 'must not run'); });
`));
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(output.includes('needs a thing this machine lacks'), `states the reason, got: ${output}`);
    assert(output.includes('1 suite skipped'), `counts the skip, got: ${output}`);
    assert(!output.includes('must not run'), 'its cases never ran');
  });

  await test('a suite that throws for any other reason still fails the run', () => {
    const { code, output } = runWithSuite(SUITE(`
  throw new Error('a genuine explosion');
`));
    assertEq(code, 1, `exit 1, got: ${output}`);
    assert(output.includes('a genuine explosion'), `reports the error, got: ${output}`);
    assert(!output.includes('skipped'), 'never reported as a skip');
  });

  await test('a per-case skip() is named in the totals without counting as a pass', () => {
    const { code, output } = runWithSuite(SUITE(`
  await test('runs here', () => { assert(true); });
  skip('gated case', 'no widget on this machine');
`));
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(output.includes('1 passed, 0 failed, 1 case skipped'), `totals separate the skip, got: ${output}`);
    assert(output.includes('fixture.test.js › gated case: no widget on this machine'), `names the skip, got: ${output}`);
  });

  await test('a passing suite reports no skip note at all', () => {
    const { code, output } = runWithSuite(SUITE(`
  await test('passes', () => { assert(true); });
`));
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(output.includes('1 passed, 0 failed'), `totals only, got: ${output}`);
    assert(!output.includes('skipped'), 'no skip note when nothing skipped');
  });

  // A suite is also run on its own by file (`node tests/<path>.test.js`); one
  // without the selfRun line runs zero cases that way and exits 0.
  group('run.js: every suite runs by file');

  await test('every discovered suite ends with the selfRun block', () => {
    const missing = findSuites(__dirname)
      .filter((file) => !SELF_RUN.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(__dirname, file))
      .sort();
    assert(missing.length === 0, `suites without \`if (require.main === module) selfRun(\` pass empty by file:\n    ${missing.join('\n    ')}`);
  });
};

module.exports = async () => {
  await run();
  return summary();
};

if (require.main === module) selfRun(module.exports);
