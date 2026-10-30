// Tests for the workkit-core package as a repo installs it: `npm test` of
// `workkit test` reaches the runner through the package's bin, whole or narrowed
// to one file, the bin refuses every other verb, and `workkit-core/test` gives
// the harness to `require()` and `import` alike. The repo is test/lib/core-repo.js.

const fs = require('fs');
const path = require('path');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, assertEq, summary, selfRun, run,
} = require('../lib/harness');
const { BASH, NO_RC, NODE_DIR, SYSTEM_PATH, joinPath } = require('../lib/platform');
const {
  TOTALS, skipWithoutNpm, npmIn, mkCoreRepo,
} = require('../lib/core-repo');

// What the harness entry exports, every one of which `workkit-core/test` carries.
const HARNESS_EXPORTS = [
  'CASE_INDENT', 'PIPE_GRACE_MS', 'POOL', 'SPAWN_DEADLINE', 'WORKKIT_DIR', 'alive', 'assert', 'assertEq',
  'drain', 'elapsedUntil', 'endTree', 'findModSuites', 'findSuites', 'group', 'hasLaunchd', 'log', 'mkTmp',
  'openCase', 'readPid', 'run', 'seeded', 'selfRun', 'skip', 'skipSuite', 'start', 'stripAnsi', 'summary',
  'test', 'testUnless', 'until',
];

const linesOf = (output) => stripVTControlCharacters(output).split(/\r?\n/);
const ran = (output, name) => linesOf(output).some((line) => line.includes(name));

// The installed bin by its name, through the shim npm made for it.
const bin = (repo, args) => {
  const res = run(BASH, [...NO_RC, '-c', 'exec node_modules/.bin/workkit "$@"', 'workkit', ...args], {
    cwd: repo, env: { ...process.env, PATH: joinPath(NODE_DIR, SYSTEM_PATH) },
  });
  return { code: res.status, output: stripVTControlCharacters(res.output) };
};

const cases = async () => {
  skipWithoutNpm();

  group('workkit-core: npm test runs the runner through the bin');

  await test('npm test in a repo on the package runs every suite and prints the totals line', () => {
    const repo = mkCoreRepo();
    const { code, output } = npmIn(repo, ['test']);
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(ran(output, 'a case') && ran(output, 'b case'), `both suites ran, got: ${output}`);
    assert(linesOf(output).some((line) => TOTALS(2, 2).test(line)), `the totals line counts both, got: ${output}`);
  });

  await test('npm test -- test/a.test.js runs only that suite', () => {
    const repo = mkCoreRepo();
    const { code, output } = npmIn(repo, ['test', '--', 'test/a.test.js']);
    assertEq(code, 0, `exit 0, got: ${output}`);
    assert(ran(output, 'a case') && !ran(output, 'b case'), `only the named suite ran, got: ${output}`);
    assert(linesOf(output).some((line) => TOTALS(1, 1).test(line)), `the totals count the one suite, got: ${output}`);
  });

  group('workkit-core: the bin\'s other verbs');

  await test('the bin with a verb of the global command exits 2, naming the global command, running nothing', () => {
    const repo = mkCoreRepo();
    const { code, output } = bin(repo, ['setup']);
    assertEq(code, 2, `exit 2, got: ${output}`);
    assert(output.startsWith('\u2716 setup: '), `the global command's error shape, got: ${output}`);
    assert(/global/i.test(output) && output.includes('workkit'), `names the global workkit command, got: ${output}`);
    assert(!ran(output, 'a case') && !linesOf(output).some((line) => / passed, \d+ failed/.test(line)), `no suite ran, got: ${output}`);
  });

  await test('the bin with no verb exits 2, naming the global command, running nothing', () => {
    const repo = mkCoreRepo();
    const { code, output } = bin(repo, []);
    assertEq(code, 2, `exit 2, got: ${output}`);
    assert(output.startsWith('\u2716 workkit: '), `the global command's error shape, got: ${output}`);
    assert(/global/i.test(output), `names the global workkit command, got: ${output}`);
    assert(!ran(output, 'a case') && !linesOf(output).some((line) => / passed, \d+ failed/.test(line)), `no suite ran, got: ${output}`);
  });

  group('workkit-core/test: the harness through require and import');

  await test('require(\'workkit-core/test\') and import both carry every harness export', () => {
    const repo = mkCoreRepo();
    const print = 'console.log(JSON.stringify(Object.keys(h)))';
    fs.writeFileSync(path.join(repo, 'cjs.cjs'), `const h = require('workkit-core/test');\n${print};\n`);
    fs.writeFileSync(path.join(repo, 'esm.mjs'), `import * as h from 'workkit-core/test';\n${print};\n`);
    for (const file of ['cjs.cjs', 'esm.mjs']) {
      const res = run(process.execPath, [file], { cwd: repo });
      assertEq(res.status, 0, `${file} loads the package, got: ${res.output}`);
      const keys = JSON.parse(res.stdout.trim().split('\n').pop());
      const missing = HARNESS_EXPORTS.filter((name) => !keys.includes(name));
      assertEq(missing.join(', '), '', `${file}: every harness export, got: ${keys.join(', ')}`);
    }
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
