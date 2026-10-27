// Tests for workflow/workkit.sh: the `test` verb, the repo's own `npm test` run
// from its root, so npm's script shell records what the run proved.
// The shared prologue is ./helpers.js; the script shell's world is test/lib/script-shell.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, assertEq, summary, selfRun, seeded,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, shellPath, joinPath, basePathWithout,
} = require('../../lib/platform');
const { treeHash } = require('../../lib/suite-record');
const {
  EXE_CLAUDE_HOME, wireShell, scratchNpmrc, skipWithoutWrapper, recorded, assertRecord, packaged,
} = require('../../lib/script-shell');
const {
  WORKFLOW_DIR, CLI, cleanup, writeStub, mkWorld, runCli, mkRepo,
} = require('./helpers');

// A suite in the harness's shape, its one case named `name`.
const SUITE = (name) => `
const { test, assert, summary } = require('./lib/harness');
module.exports = async () => {
  await test('${name}', () => { assert(true); });
  return summary();
};
`;

// The files of a repo whose `npm test` is the kit's runner, the way the kit's
// own test/run.js reaches it, with suites a and b, plus a nested package whose
// own test script would say `nested-ran`.
const copyFixture = seeded((seed) => {
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(seed, rel)), { recursive: true });
    fs.writeFileSync(path.join(seed, rel), text);
  };
  write('package.json', `${JSON.stringify({ name: 'fixture', private: true, scripts: { test: 'node test/run.js' } }, null, 2)}\n`);
  write('test/run.js', `require(${JSON.stringify(path.join(WORKFLOW_DIR, 'test', 'run.js'))}).main(['--root', require('path').dirname(__dirname), ...process.argv.slice(2)]);\n`);
  write('test/lib/harness.js', `module.exports = require(${JSON.stringify(path.join(WORKFLOW_DIR, 'test', 'lib', 'harness.js'))});\n`);
  write('test/a.test.js', SUITE('a case'));
  write('test/b.test.js', SUITE('b case'));
  write('packages/foo/package.json', `${JSON.stringify({ name: 'foo', scripts: { test: 'echo nested-ran' } })}\n`);
});

// The fixture's root package.json, `scripts` its whole scripts block (none when absent).
const writePackage = (repo, scripts) => fs.writeFileSync(path.join(repo, 'package.json'),
  `${JSON.stringify({ name: 'fixture', private: true, ...(scripts ? { scripts } : {}) })}\n`);

const mkTestRepo = () => {
  const repo = mkRepo();
  copyFixture(repo);
  return repo;
};

// `workkit test <args>` from `cwd`, on a machine whose npm names the script
// shell, node and npm on PATH unless `env` says otherwise.
const runTest = (world, args = [], { cwd, env = {} } = {}) => {
  const res = runCli(world, ['test', ...args], {
    cwd,
    env: {
      PATH: joinPath(NODE_DIR, world.env.PATH),
      NPM_CONFIG_USERCONFIG: scratchNpmrc(wireShell(world.workflowHome)),
      ...(IS_WINDOWS ? { WORKFLOW_CLAUDE_HOME: EXE_CLAUDE_HOME } : {}),
      ...env,
    },
  });
  return { ...res, lines: stripVTControlCharacters(res.said).split(/\r?\n/) };
};

const ran = (lines, name) => lines.some((line) => line.includes(name));

// The totals line: `passed` passing cases, none failed, across `suites` suites.
const TOTALS = (passed, suites) => new RegExp(`^${passed} passed, 0 failed \\(\\d+(?:\\.\\d+)?s, ${suites} suites?\\)$`);

const cases = async () => {
  skipWithoutWrapper();

  group('workkit test: the repo\'s npm test, from its root');

  await test('workkit test test/a.test.js runs only that suite and the package record holds the root on the tree', () => {
    const world = mkWorld({ claude: false });
    const repo = mkTestRepo();
    const tree = treeHash(repo);
    const { code, said, lines } = runTest(world, ['test/a.test.js'], { cwd: repo });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(ran(lines, 'a case') && !ran(lines, 'b case'), `only the named suite ran, got: ${said}`);
    assert(lines.some((line) => TOTALS(1, 1).test(line)), `the totals count the one suite, got: ${said}`);
    assertEq(packaged(world, repo), JSON.stringify([tree, '.']), `the tree it ran on, then the root package, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('workkit test with no path runs every suite and the suite record holds the tree', () => {
    const world = mkWorld({ claude: false });
    const repo = mkTestRepo();
    const tree = treeHash(repo);
    const { code, said, lines } = runTest(world, [], { cwd: repo });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(lines.some((line) => TOTALS(2, 2).test(line)), `both suites ran, got: ${said}`);
    assertRecord(recorded(world, repo), tree, `the record holds the working tree it proved, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('from a nested package\'s folder the verb runs the root\'s npm test, never the nested one', () => {
    const world = mkWorld({ claude: false });
    const repo = mkTestRepo();
    const { code, said, lines } = runTest(world, [], { cwd: path.join(repo, 'packages', 'foo') });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(lines.some((line) => TOTALS(2, 2).test(line)), `the root's suites ran, got: ${said}`);
    assert(!ran(lines, 'nested-ran'), `the nested package's script never ran, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  for (const [shape, scripts] of [['no test script', undefined], ['an empty test script', { test: '' }]]) {
    await test(`a package.json with ${shape}: one error line naming it, exit 1, nothing run`, () => {
      const world = mkWorld({ claude: false });
      const repo = mkTestRepo();
      writePackage(repo, scripts);
      const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
      const { code, said, lines } = runTest(world, [], { cwd: repo });
      assertEq(code, 1, `exit 1, got: ${said}`);
      const printed = lines.filter((line) => line.trim());
      assert(printed.length === 1 && printed[0].includes(`test: ${root}/package.json has no test script`), `the one error line, got: ${said}`);
      assert(!ran(lines, 'a case') && !ran(lines, 'b case'), `no suite ran, got: ${said}`);
      cleanup(world.root); cleanup(repo);
    });
  }

  // `workkit` on PATH is this CLI. Without the guard the script shell's lock
  // refuses the nested root run, and past that the stub refuses a third call,
  // so no chain outlives the deadline.
  await test('a test script of workkit test, run through npm by the verb: exit 1 with the hand-off line, no loop', () => {
    const world = mkWorld({ claude: false });
    const repo = mkTestRepo();
    writePackage(repo, { test: 'workkit test' });
    const bin = path.join(world.root, 'workkit-bin');
    fs.mkdirSync(bin);
    writeStub(path.join(bin, 'workkit'), [
      'export WK_LOOP_DEPTH=$(( ${WK_LOOP_DEPTH:-0} + 1 ))',
      'if [ "$WK_LOOP_DEPTH" -gt 2 ]; then exit 99; fi',
      `exec bash "${shellPath(CLI)}" "$@"`,
    ]);
    const { code, said } = runTest(world, [], { cwd: repo, env: { PATH: joinPath(bin, NODE_DIR, world.env.PATH) } });
    assertEq(code, 1, `exit 1, got: ${said}`);
    assert(said.includes('test: workkit test was started inside an npm test, so it stops instead of looping; a test script of `workkit test` must point at the runner (node test/run.js)'),
      `the hand-off line, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('node on PATH but no npm: the npm error line, exit 1', () => {
    const world = mkWorld({ claude: false });
    const repo = mkTestRepo();
    const noNpm = basePathWithout(world.root, 'npm');
    const { code, said } = runTest(world, [], { cwd: repo, env: { PATH: joinPath(world.bin, noNpm) } });
    assertEq(code, 1, `exit 1, got: ${said}`);
    assert(said.includes('test: the verb runs npm test, and there is no npm on PATH'), `the npm error line, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
