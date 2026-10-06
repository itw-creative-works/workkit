/* eslint-disable no-console */
// Tests for tests/run.js, the suite runner: a suite this machine cannot answer
// reports a named skip and leaves the run green while a real throw fails it,
// suite paths narrow a run to those suites, and every suite it discovers runs
// alone by file.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, selfRun, summary } = require('./lib/harness');
const { findSuites } = require('./lib/suites');
const { mkTmp } = require('./lib/scratch');

const RUNNER = path.join(__dirname, 'run.js');
const LIB = path.join(__dirname, 'lib');

// A throwaway repo whose tests/ folder holds `suites` (file name to body), run
// from its root through the real runner with the arguments `argsFor(root)`
// returns. The runner discovers suites beside itself and skips lib/, so the
// fixture mirrors that layout: a copy of the runner, the real lib/, the suites.
const runSuites = (suites, argsFor = () => []) => {
  const root = mkTmp('runner-');
  const dir = path.join(root, 'tests');
  fs.mkdirSync(dir);
  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.copyFileSync(RUNNER, path.join(dir, 'run.js'));
  fs.cpSync(LIB, path.join(dir, 'lib'), { recursive: true });
  for (const [name, body] of Object.entries(suites)) fs.writeFileSync(path.join(dir, name), body);
  const res = spawnSync('node', [path.join(dir, 'run.js'), ...argsFor(root)], { cwd: root, encoding: 'utf8', timeout: 20000 });
  fs.rmSync(root, { recursive: true, force: true });
  return { code: res.status, output: (res.stdout || '') + (res.stderr || '') };
};

const runWithSuite = (body) => runSuites({ 'fixture.test.js': body });

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

  group('run.js: suite paths narrow the run');

  // Three suites with distinct case names and counts, so the output and the
  // totals both say which ran.
  const three = {
    'alpha.test.js': SUITE(`  await test('alpha case', () => { assert(true); });`),
    'beta.test.js': SUITE(`
  await test('beta case one', () => { assert(true); });
  await test('beta case two', () => { assert(true); });
`),
    'gamma.test.js': SUITE(`
  for (const n of [1, 2, 3, 4]) await test(\`gamma case \${n}\`, () => { assert(true); });
`),
  };

  // One path relative to the repo root, one absolute: the two forms the runner takes.
  await test('two paths run only those two suites and the totals count only them', () => {
    const { code, output } = runSuites(three, (root) => ['tests/alpha.test.js', path.join(root, 'tests', 'beta.test.js')]);
    assertEq(code, 0, `exit 0, got: ${output}`);
    for (const ran of ['alpha case', 'beta case one', 'beta case two']) {
      assert(output.includes(ran), `ran "${ran}", got: ${output}`);
    }
    assert(!output.includes('gamma'), `the unnamed suite never ran, got: ${output}`);
    assert(output.includes('3 passed, 0 failed'), `totals count only the two, got: ${output}`);
    assert(output.includes('2 suites)'), `names two suites, got: ${output}`);
  });

  await test('a path matching no suite exits 1 naming it and runs nothing', () => {
    const { code, output } = runSuites(three, () => ['tests/alpha.test.js', 'tests/missing.test.js']);
    assertEq(code, 1, `exit 1, got: ${output}`);
    assert(output.includes('No suite matches tests/missing.test.js'), `names the path, got: ${output}`);
    assert(!output.includes('alpha case'), `no suite ran, the named good one included, got: ${output}`);
  });

  await test('no arguments runs every suite as before', () => {
    const { code, output } = runSuites(three);
    assertEq(code, 0, `exit 0, got: ${output}`);
    for (const ran of ['alpha case', 'beta case two', 'gamma case 4']) {
      assert(output.includes(ran), `ran "${ran}", got: ${output}`);
    }
    assert(output.includes('7 passed, 0 failed'), `totals count all three, got: ${output}`);
    assert(output.includes('3 suites)'), `names three suites, got: ${output}`);
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
