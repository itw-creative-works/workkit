// Tests for the one entry, workflow/test/lib/harness.js: it carries every
// export of the concern files behind it, and a suite written on that one
// require alone runs the same by file and under the kit's runner.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, run,
} = require('./lib/harness');

const KIT_LIB = path.join(__dirname, '..', 'workflow', 'test', 'lib');
const RUNNER = path.join(__dirname, '..', 'workflow', 'test', 'run.js');
const CONCERNS = ['process', 'scratch', 'seed', 'suites', 'log', 'spawn'];

// A suite on the one require alone, reaching a scratch folder, a wait, a child
// run and the log through it: three cases that pass.
const ONE_REQUIRE = `
const fs = require('fs');
const path = require('path');
const { test, assert, assertEq, summary, selfRun, mkTmp, until, run, log } = require('./lib/harness');
const cases = async () => {
  await test('a scratch folder and a wait', async () => {
    const file = path.join(mkTmp('one-'), 'mark');
    fs.writeFileSync(file, 'x');
    assert(await until(() => fs.existsSync(file)), 'the mark is seen');
  });
  await test('a child run', () => {
    assertEq(run(process.execPath, ['-e', 'process.stdout.write("hi")']).stdout, 'hi', 'the child spoke');
  });
  await test('a logged case', () => { log('a', 'note'); });
};
module.exports = async () => { await cases(); return summary(); };
if (require.main === module) selfRun(module.exports);
`;

// A scratch repo whose test/ holds the harness re-export and the one suite.
const mkRepo = () => {
  const root = mkTmp('one-require-');
  run('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, 'test', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test', 'lib', 'harness.js'), `module.exports = require(${JSON.stringify(path.join(KIT_LIB, 'harness.js'))});\n`);
  fs.writeFileSync(path.join(root, 'test', 'one.test.js'), ONE_REQUIRE);
  return root;
};

// A node run from `root`: its exit and both streams with the colors stripped.
const node = (root, args) => {
  const res = run(process.execPath, args, { cwd: root });
  return { code: res.status, output: stripVTControlCharacters(res.output) };
};

// How many case lines in `output` carry the pass mark, and the fail mark.
const marks = (output) => {
  const lines = output.split(/\r?\n/).map((l) => l.trim());
  return { passed: lines.filter((l) => l.startsWith('✓')).length, failed: lines.filter((l) => l.startsWith('✗')).length };
};

const cases = async () => {
  group('harness: the one entry');

  await test('the entry exposes every export of process, scratch, seed, suites, log and spawn', () => {
    const entry = new Set(Object.keys(require('./lib/harness')));
    const missing = CONCERNS
      .flatMap((name) => Object.keys(require(path.join(KIT_LIB, `${name}.js`))).sort().map((key) => `${name}.${key}`))
      .filter((named) => !entry.has(named.slice(named.indexOf('.') + 1)));
    assertEq(missing.join(', '), '', 'every concern export reachable through the one require');
  });

  await test('a suite on the one require alone runs by file and under the runner with the same totals', () => {
    const root = mkRepo();
    const alone = node(root, [path.join('test', 'one.test.js')]);
    assertEq(alone.code, 0, `by file exits 0, got:\n${alone.output}`);
    assertEq(JSON.stringify(marks(alone.output)), JSON.stringify({ passed: 3, failed: 0 }), `by file, three passes, got:\n${alone.output}`);
    const pooled = node(root, [RUNNER]);
    assertEq(pooled.code, 0, `under the runner exits 0, got:\n${pooled.output}`);
    assertEq(JSON.stringify(marks(pooled.output)), JSON.stringify({ passed: 3, failed: 0 }), `under the runner, the same three, got:\n${pooled.output}`);
    assert(pooled.output.includes('3 passed, 0 failed'), `the runner's totals agree, got:\n${pooled.output}`);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
