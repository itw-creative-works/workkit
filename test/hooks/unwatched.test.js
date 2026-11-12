// Tests for workflow:unwatched, unwatchedGuard(facts) in hooks/mods/unwatched.js, run as its
// entry on the Bash chain (hooks/mods/guards.js) with a real io over a real repo: a background
// test run the supervisor does not read gets one notice naming the `workkit supervise` form,
// never a deny; a run the supervisor reads, a call in the foreground, a run that is no test and
// a repo that has not opted in get nothing. The chain's order is test/mods/guards-tree-guard.test.ts.

const fs = require('fs');
const path = require('path');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp, seeded,
} = require('../lib/harness');
const { homeEnv, spawnSync } = require('../lib/platform');
const { mods, textOf } = require('../lib/mods-inputs');
const { ioIn } = require('../../workflow/lib/io');
const { OPT_IN_SHAPES } = require('../lib/git-repo');

const HOOK = 'workflow:unwatched';
const NOTE = (command) => `workflow:unwatched: the supervisor does not read this background test run; start that step as workkit supervise -- ${command}`;

// A repo with one package folder under its root, opted in unless the shape says not, and an empty home.
const seed = seeded((dir, { optIn }) => {
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'packages', 'core'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'home'));
  fs.writeFileSync(path.join(repo, 'packages', 'core', 'package.json'), '{ "scripts": { "test": "workkit test" } }\n');
  if (optIn) {
    fs.mkdirSync(path.join(repo, '.workkit'));
    fs.writeFileSync(path.join(repo, '.workkit', 'settings.json'), OPT_IN_SHAPES.current);
  }
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  if (init.status !== 0) throw new Error(`git init: ${init.stderr}`);
});

/** A fresh copy of the world: `{ repo, env }`. */
const mkWorld = ({ optIn = true } = {}) => {
  const dir = mkTmp('wk-unwatched-');
  seed(dir, { optIn });
  return { repo: path.join(dir, 'repo'), env: homeEnv(path.join(dir, 'home'), { PATH: process.env.PATH }) };
};

/** The notice the chain's unwatched entry answers for `command` run from `cwd`, '' for none; never a deny. */
const noticeFor = async (world, command, { cwd = world.repo, background = true } = {}) => {
  const { BASH_GUARDS, runChain } = mods('guards');
  const entry = BASH_GUARDS.filter((g) => g.hook === HOOK);
  assertEq(entry.length, 1, `${HOOK} is on the Bash chain once`);
  const chain = await runChain(ioIn(world.env), world.env, entry, { command, cwd, background });
  assert(!chain.error && !chain.deny, `the hook neither crashed nor denied, got: ${chain.error || chain.deny}`);
  return textOf(chain.notice).replace(/\n$/, '');
};

const cases = async () => {
  group('workflow:unwatched: a background test run the supervisor does not read');

  await test('a background npm test -- test/x.test.js in an opted-in repo: the notice names workkit supervise -- npm test -- test/x.test.js', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'npm test -- test/x.test.js'), NOTE('npm test -- test/x.test.js'), 'the notice');
  });

  await test('a background bare npm test run from a package folder under the root: the notice', async () => {
    const world = mkWorld();
    const cwd = path.join(world.repo, 'packages', 'core');
    assertEq(await noticeFor(world, 'npm test', { cwd }), NOTE('npm test'), 'the notice');
  });

  await test('a background bare npm test after a cd into a package folder: the notice, naming the test step alone', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'cd packages/core && npm test'), NOTE('npm test'), 'the notice');
  });

  await test('a background workkit test test/x.test.js: the notice names workkit supervise -- workkit test test/x.test.js', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'workkit test test/x.test.js'), NOTE('workkit test test/x.test.js'), 'the notice');
  });

  await test('a background npm run test:unit: the notice names workkit supervise -- npm run test:unit', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'npm run test:unit'), NOTE('npm run test:unit'), 'the notice');
  });

  await test('two unread test steps in one background command: one notice line per step, in order', async () => {
    const world = mkWorld();
    const notice = await noticeFor(world, 'npm test -- test/a.test.js; npm test -- test/b.test.js');
    assertEq(notice, [NOTE('npm test -- test/a.test.js'), NOTE('npm test -- test/b.test.js')].join('\n'), 'the notice');
  });

  group('workflow:unwatched: nothing to say');

  await test('a background bare npm test in the repo root: nothing', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'npm test'), '', 'no notice');
  });

  await test('a background bare npm run test in the repo root: nothing, the same supervised suite run as npm test', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'npm run test'), '', 'no notice');
  });

  await test('a background bare workkit test run from a package folder under the root: nothing, the verb moves to the root itself', async () => {
    const world = mkWorld();
    const cwd = path.join(world.repo, 'packages', 'core');
    assertEq(await noticeFor(world, 'workkit test', { cwd }), '', 'no notice');
  });

  await test('a background workkit prove, or a background workkit supervise -- npm test -- test/x.test.js: nothing', async () => {
    const world = mkWorld();
    for (const command of ['workkit prove', 'workkit supervise -- npm test -- test/x.test.js']) {
      assertEq(await noticeFor(world, command), '', `no notice: ${command}`);
    }
  });

  await test('the narrowed npm test -- test/x.test.js not in the background: nothing', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'npm test -- test/x.test.js', { background: false }), '', 'no notice');
  });

  await test('a background npm run build: nothing', async () => {
    const world = mkWorld();
    assertEq(await noticeFor(world, 'npm run build'), '', 'no notice');
  });

  await test('a background npm test -- test/x.test.js in a repo that has not opted in: nothing', async () => {
    const world = mkWorld({ optIn: false });
    assertEq(await noticeFor(world, 'npm test -- test/x.test.js'), '', 'no notice');
  });
};

module.exports = async () => {
  await cases();
  return summary();
};

if (require.main === module) selfRun(module.exports);
