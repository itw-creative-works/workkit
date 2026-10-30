// Tests for workflow/workkit.sh: the `test` verb, the repo's own `npm test` run
// from its root, so npm's script shell records what the run proved. The repo is
// on the workkit-core package (test/lib/core-repo.js); the shared prologue is
// ./helpers.js; the script shell's world is test/lib/script-shell.js.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { stripVTControlCharacters } = require('util');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../../lib/harness');
const {
  IS_WINDOWS, NODE_DIR, shellPath, joinPath, basePathWithout,
} = require('../../lib/platform');
const { treeHash } = require('../../lib/suite-record');
const {
  EXE_CLAUDE_HOME, wireShell, scratchNpmrc, skipWithoutWrapper, recorded, assertRecord, packaged,
} = require('../../lib/script-shell');
const { TOTALS, mkCoreRepo } = require('../../lib/core-repo');
const {
  CLI, cleanup, writeStub, mkWorld, runCli,
} = require('./helpers');

// The fixture's root package.json, `scripts` its whole scripts block (none when absent).
const writePackage = (repo, scripts) => fs.writeFileSync(path.join(repo, 'package.json'),
  `${JSON.stringify({ name: 'fixture', private: true, ...(scripts ? { scripts } : {}) })}\n`);

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

const cases = async () => {
  skipWithoutWrapper();

  group('workkit test: the repo\'s npm test, from its root');

  await test('workkit test test/a.test.js runs only that suite and the package record holds the root on the tree', () => {
    const world = mkWorld({ claude: false });
    const repo = mkCoreRepo();
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
    const repo = mkCoreRepo();
    const tree = treeHash(repo);
    const { code, said, lines } = runTest(world, [], { cwd: repo });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(lines.some((line) => TOTALS(2, 2).test(line)), `both suites ran, got: ${said}`);
    assertRecord(recorded(world, repo), tree, `the record holds the working tree it proved, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('from a nested package\'s folder the verb runs the root\'s npm test, never the nested one', () => {
    const world = mkWorld({ claude: false });
    const repo = mkCoreRepo();
    fs.mkdirSync(path.join(repo, 'packages', 'foo'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'packages', 'foo', 'package.json'),
      `${JSON.stringify({ name: 'foo', scripts: { test: 'echo nested-ran' } })}\n`);
    const { code, said, lines } = runTest(world, [], { cwd: path.join(repo, 'packages', 'foo') });
    assertEq(code, 0, `exit 0, got: ${said}`);
    assert(lines.some((line) => TOTALS(2, 2).test(line)), `the root's suites ran, got: ${said}`);
    assert(!ran(lines, 'nested-ran'), `the nested package's script never ran, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  for (const [shape, scripts] of [['no test script', undefined], ['an empty test script', { test: '' }]]) {
    await test(`a package.json with ${shape}: one error line naming it, exit 1, nothing run`, () => {
      const world = mkWorld({ claude: false });
      const repo = mkCoreRepo();
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

  // `workkit` on PATH is this CLI, which the script reaches with no package
  // installed. Without the guard the script shell's lock refuses the nested root
  // run, and past that the stub refuses a third call, so no chain outlives the deadline.
  await test('a test script of workkit test with no workkit-core installed: non-zero with the missing-package line, no loop', () => {
    const world = mkWorld({ claude: false });
    const repo = mkCoreRepo();
    fs.rmSync(path.join(repo, 'node_modules'), { recursive: true, force: true });
    const bin = path.join(world.root, 'workkit-bin');
    fs.mkdirSync(bin);
    writeStub(path.join(bin, 'workkit'), [
      'export WK_LOOP_DEPTH=$(( ${WK_LOOP_DEPTH:-0} + 1 ))',
      'if [ "$WK_LOOP_DEPTH" -gt 2 ]; then exit 99; fi',
      `exec bash "${shellPath(CLI)}" "$@"`,
    ]);
    const { code, said } = runTest(world, [], { cwd: repo, env: { PATH: joinPath(bin, NODE_DIR, world.env.PATH) } });
    assert(code !== 0, `non-zero, got ${code}: ${said}`);
    assert(said.includes('workkit-core is not installed here: run npm install'), `the missing-package line, got: ${said}`);
    cleanup(world.root); cleanup(repo);
  });

  await test('node on PATH but no npm: the npm error line, exit 1', () => {
    const world = mkWorld({ claude: false });
    const repo = mkCoreRepo();
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
