// Tests for `workkit prove`: the root suite run on exactly the staged tree, in a
// throwaway copy outside the repo, recording the index's tree on green
// (docs/project-state.md § The proof). Every case is a real throwaway repo with
// a home and a TMPDIR of its own, on a machine whose npm names the kit's wrapper.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun,
} = require('../lib/harness');
const {
  IS_WINDOWS, BASH, NO_RC, NODE_DIR, shellPath, joinPath,
} = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');
const { treeOf } = require('../lib/red-snapshot');
const { suiteMarkerPath, reviewMarkerPath } = require('../lib/suite-record');
const { skipWithoutWrapper } = require('../lib/script-shell');
const {
  runHook, standDownMessage, scratchNpmrc, WRAPPER, EXE_ENV, EXE_CLAUDE_HOME,
} = require('../hooks/commit-gate/helpers');

const CLI = path.join(__dirname, '..', '..', 'workflow', 'workkit.sh');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// The fixture's suite: every file under test/ required in turn, so an untracked
// test file is part of the run the way a real suite's discovery makes it.
const RUNNER = [
  "const fs = require('fs'), path = require('path');",
  "for (const f of fs.readdirSync(path.join(__dirname, 'test'))) require(path.join(__dirname, 'test', f));",
  '',
].join('\n');
const TEST_OF = (value) => `require('assert').strictEqual(require('../app'), ${value});\n`;

/**
 * A committed repo whose root `test` script runs `run.js` over `test/`: `app.js`
 * exports 1 and `test/app.test.js` asserts 1; node_modules is ignored.
 */
const mkWorld = (extra = {}) => mkRepo('prove-', {
  'package.json': `${JSON.stringify({ name: 'fixture', version: '1.0.0', scripts: { test: 'node run.js' } })}\n`,
  '.gitignore': 'node_modules/\n',
  'run.js': RUNNER,
  'app.js': 'module.exports = 1;\n',
  'test/app.test.js': TEST_OF(1),
  ...extra,
});

// Passing work staged: app.js at 2, its test asserting 2.
const stagePassing = (w) => {
  w.write('app.js', 'module.exports = 2;\n');
  w.write('test/app.test.js', TEST_OF(2));
  w.git('add', 'app.js', 'test/app.test.js');
};

// Held work the commit leaves out: an unstaged edit breaking the staged test,
// and an untracked test that fails.
const holdBreaking = (w) => {
  w.write('app.js', 'module.exports = 3;\n');
  w.write('test/held.test.js', "throw new Error('held work');\n");
};

// The fixture's suite run straight in the working folder.
const folderRun = (w) => spawnSync(process.execPath, ['run.js'], { cwd: w.repo, encoding: 'utf8' }).status;

// npm beside this node naming the kit's wrapper, as `workkit setup` leaves a machine.
const proveEnv = (w) => ({
  ...w.env,
  PATH: joinPath(NODE_DIR, w.env.PATH),
  NPM_CONFIG_USERCONFIG: scratchNpmrc(WRAPPER),
  ...EXE_ENV,
  ...(IS_WINDOWS ? { WORKFLOW_CLAUDE_HOME: EXE_CLAUDE_HOME } : {}),
});

const prove = (w) => {
  const res = spawnSync(BASH, [...NO_RC, shellPath(CLI), 'prove'], {
    cwd: w.repo, env: proveEnv(w), input: '', encoding: 'utf8', timeout: 120000,
  });
  assert(res.status !== null, `workkit prove finished (no timeout, no signal): ${res.error || ''}`);
  return { code: res.status, said: `${res.stdout || ''}${res.stderr || ''}` };
};

/** The record a green run left for the world's repo, or undefined. */
const recorded = (w) => {
  const marker = suiteMarkerPath(w.tmp, w.repo);
  return fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : undefined;
};

const indexTree = (w) => w.git('write-tree').trim();

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

// What a run must leave as it found it: the status, the index tree, the
// worktree list, TMPDIR bar the suite's own records (the throwaway folder is
// gone), and a hash of every path outside .git.
const stateOf = (w) => ({
  status: w.git('status', '--porcelain'),
  index: indexTree(w),
  worktrees: w.git('worktree', 'list', '--porcelain'),
  tmp: fs.readdirSync(w.tmp).filter((name) => !name.startsWith('claude-suite')).join(', '),
  files: Object.fromEntries(Object.entries(treeOf(w.repo)).map(([rel, body]) => [rel, sha1(body)])),
});

const assertUnchanged = (before, after, label) => {
  assertEq(after.status, before.status, `${label}: git status --porcelain is unchanged`);
  assertEq(after.index, before.index, `${label}: the index tree is unchanged`);
  assertEq(after.worktrees, before.worktrees, `${label}: the worktree list is unchanged, the copy removed`);
  assertEq(after.tmp, before.tmp, `${label}: TMPDIR holds no throwaway folder beside the suite's records`);
  assertEq(JSON.stringify(after.files, null, 1), JSON.stringify(before.files, null, 1),
    `${label}: every file in the folder hashes the same`);
};

const run = async () => {
  skipWithoutWrapper();

  group('workkit prove: the staged tree, never the folder');

  await test('held work breaking a test in the folder, passing work staged: green, the index tree recorded, check 5 passes', () => {
    const w = mkWorld();
    stagePassing(w);
    holdBreaking(w);
    assert(folderRun(w) !== 0, 'the folder itself is red, so only a run on the staged tree is green');
    const index = indexTree(w);
    const res = prove(w);
    assertEq(res.code, 0, `the staged tree is green, got: ${res.said}`);
    assertEq(recorded(w), `${index}\n`, 'the record holds the index tree');

    const review = reviewMarkerPath(w.tmp, w.repo);
    fs.mkdirSync(path.dirname(review), { recursive: true });
    fs.writeFileSync(review, '');
    const out = runHook(w.repo, 'git commit -m "feat: thing"', undefined, { TMPDIR: shellPath(w.tmp) });
    assertEq(out.code, 0, `the commit of the staged tree passes the gate, got: ${out.stderr}`);
    assert(standDownMessage(out).includes('suite proved'), `check 5 stands down on the record, got: ${out.stdout}`);
    cleanup(w.dir);
  });

  await test('staged work with a failing test: red, no record, non-zero exit', () => {
    const w = mkWorld();
    w.write('app.js', 'module.exports = 2;\n');
    w.git('add', 'app.js');
    w.write('app.js', 'module.exports = 1;\n');
    assertEq(folderRun(w), 0, 'the folder itself is green, so only a run on the staged tree is red');
    const res = prove(w);
    assert(res.code !== 0, `the staged tree is red, got exit ${res.code}: ${res.said}`);
    assert(res.said.includes('2 !== 1'), `the suite's own failure reaches the caller, got: ${res.said}`);
    assertEq(recorded(w), undefined, 'a red run records nothing');
    cleanup(w.dir);
  });

  await test('the status, the index tree and every file in the folder are the same before and after a run', () => {
    const green = mkWorld();
    green.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
    stagePassing(green);
    holdBreaking(green);
    const greenBefore = stateOf(green);
    assertEq(prove(green).code, 0, 'the green run');
    assertUnchanged(greenBefore, stateOf(green), 'green');
    cleanup(green.dir);

    const red = mkWorld();
    red.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
    red.write('app.js', 'module.exports = 2;\n');
    red.git('add', 'app.js');
    red.write('test/held.test.js', "throw new Error('held work');\n");
    const redBefore = stateOf(red);
    assert(prove(red).code !== 0, 'the red run');
    assertUnchanged(redBefore, stateOf(red), 'red');
    cleanup(red.dir);
  });

  await test('a test in the copy requiring a package from the gitignored node_modules runs green', () => {
    const w = mkWorld({ 'test/dep.test.js': "require('assert').strictEqual(require('tiny'), 5);\n" });
    w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
    stagePassing(w);
    const index = indexTree(w);
    const res = prove(w);
    assertEq(res.code, 0, `the copy reaches node_modules, got: ${res.said}`);
    assertEq(recorded(w), `${index}\n`, 'the record holds the index tree');
    assertEq(fs.readFileSync(path.join(w.repo, 'node_modules', 'tiny', 'index.js'), 'utf8'),
      'module.exports = 5;\n', 'the live node_modules is intact');
    cleanup(w.dir);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
