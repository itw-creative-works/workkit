// Tests for the one entry, workflow/test/lib/harness.js: it carries every
// export of the concern files behind it, a suite written on that one require
// alone runs the same by file and under the kit's runner, and a failure prints
// the first stack frame outside the library, whatever shape the frame takes.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
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

// A suite on the library whose one case throws an error carrying `stack`.
const THROWS = (stack) => `
const { test, summary, selfRun } = require(${JSON.stringify(path.join(KIT_LIB, 'harness.js'))});
module.exports = async () => {
  await test('throws', () => { const err = new Error('boom'); err.stack = ${JSON.stringify(stack)}; throw err; });
  return summary();
};
if (require.main === module) selfRun(module.exports);
`;

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// `stack` thrown by a one-case suite run by file: the suite's exit, its output,
// and the dimmed frame lines under the failure message.
const framesOf = (dir, stack) => {
  const file = path.join(dir, 'throws.test.js');
  fs.writeFileSync(file, THROWS(stack));
  const res = run(process.execPath, [file]);
  const frames = res.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith(DIM))
    .map((l) => l.slice(DIM.length, l.lastIndexOf(RESET)));
  return { status: res.status, output: res.output, frames };
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

  group('harness: the failure frame');

  await test('a stack carrying only a file:/// frame outside the library prints that frame as its path', () => {
    const dir = mkTmp('frame-');
    const outside = path.join(dir, 'x.js');
    const url = pathToFileURL(outside).href;
    for (const frame of [`at ${url}:3:5`, `at fn (${url}:3:5)`]) {
      const { status, output, frames } = framesOf(dir, `Error: boom\n    ${frame}`);
      assertEq(status, 1, `the case failed, got:\n${output}`);
      assertEq(frames.length, 1, `one frame line for "${frame}", got:\n${output}`);
      assert(frames[0].includes(`${outside}:3:5`) && !frames[0].includes('file:'), `"${frame}" prints as its path, got: ${frames[0]}`);
    }
  });

  await test('an `at async` frame with no parentheses, outside the library, prints as its path', () => {
    const dir = mkTmp('frame-');
    const outside = path.join(dir, 'x.js');
    for (const frame of [`at async ${outside}:3:5`, `at async ${pathToFileURL(outside).href}:3:5`]) {
      const { status, output, frames } = framesOf(dir, `Error: boom\n    ${frame}`);
      assertEq(status, 1, `the case failed, got:\n${output}`);
      assertEq(frames.length, 1, `one frame line for "${frame}", got:\n${output}`);
      assert(frames[0].includes(`${outside}:3:5`) && !frames[0].includes('file:'), `"${frame}" prints as its path, got: ${frames[0]}`);
    }
  });

  await test('a file:/// frame inside the library is skipped and the next frame, outside it, prints', () => {
    const dir = mkTmp('frame-');
    const inside = pathToFileURL(path.join(KIT_LIB, 'harness.js')).href;
    const outside = path.join(dir, 'y.js');
    const { status, output, frames } = framesOf(dir, `Error: boom\n    at ${inside}:10:5\n    at ${outside}:7:9`);
    assertEq(status, 1, `the case failed, got:\n${output}`);
    assertEq(frames.length, 1, `one frame line, got:\n${output}`);
    assert(frames[0].includes(`${outside}:7:9`), `the outside frame prints, not the library's, got: ${frames[0]}`);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
