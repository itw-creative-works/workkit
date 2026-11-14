// Tests for `workkit prove`: the root suite run on exactly the staged tree, in a
// throwaway copy under the home's `.cache/workkit/proof`, recording the index's
// tree on green (docs/project-state.md § The proof), and ending a suite that
// freezes. Each case is a real repo with its own home and TMPDIR, on a machine
// whose npm names the kit's wrapper.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, run, pidIn,
} = require('../lib/harness');
const { shellPath } = require('../lib/platform');
const { mkRepo, OPT_IN_SHAPES } = require('../lib/git-repo');
const { treeOf } = require('../lib/red-snapshot');
const {
  suiteMarkerPath, reviewMarkerPath, kitIndexTree, plantRecord,
} = require('../lib/suite-record');
const {
  skipWithoutWrapper, wiredNpmEnv, assertRecord,
} = require('../lib/script-shell');
const { runCli } = require('./workkit-cli/helpers');
const { gateOn } = require('../lib/real-gate');
const {
  homeOf, cacheBase, proofBase, runFolders, plantRun,
} = require('../lib/workflow-home');
const {
  CHECK_MINUTES, skipOnWindows, checkSettings, reap,
} = require('../lib/supervise');

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
const folderRun = (w) => run(process.execPath, ['run.js'], { cwd: w.repo }).status;

const prove = (w, env = {}) => runCli(w, ['prove'], { cwd: w.repo, env: { ...wiredNpmEnv(w), ...env } });

// A fixture test that writes, to the file PROVE_SEEN names, the root of the
// tree it runs in and the entries of the folder PROVE_TMP names.
const WHERE = [
  "const fs = require('fs'), path = require('path');",
  'fs.writeFileSync(process.env.PROVE_SEEN, JSON.stringify({',
  "  root: fs.realpathSync(path.join(__dirname, '..')),",
  '  tmp: fs.readdirSync(process.env.PROVE_TMP),',
  '}));',
  '',
].join('\n');

/** A world whose suite reports where it ran, and the env that names the report and the TMPDIR to list. */
const seeingWorld = () => {
  const w = mkWorld({ 'test/where.test.js': WHERE });
  const seen = path.join(w.dir, 'seen.json');
  return { w, seen, env: { PROVE_SEEN: seen, PROVE_TMP: w.tmp } };
};

/** The record a green run left for the world's repo, or undefined. */
const recorded = (w) => {
  const marker = suiteMarkerPath(w.workflowHome, w.repo);
  return fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : undefined;
};

// The index's id as the kit records it, `.workkit/` left out.
const indexTree = (w) => kitIndexTree(w.repo, w.env);

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

// What a run must leave as it found it: the status, the index's whole tree, the
// worktree list, the run folders and TMPDIR (the throwaway folder is gone), and
// a hash of every path outside .git.
const stateOf = (w) => ({
  status: w.git('status', '--porcelain'),
  index: w.git('write-tree').trim(),
  worktrees: w.git('worktree', 'list', '--porcelain'),
  runs: runFolders(homeOf(w)).join(', '),
  tmp: fs.readdirSync(w.tmp).join(', '),
  files: Object.fromEntries(Object.entries(treeOf(w.repo)).map(([rel, body]) => [rel, sha1(body)])),
});

const assertUnchanged = (before, after, label) => {
  expect(after.status, `${label}: git status --porcelain is unchanged`).toBe(before.status);
  expect(after.index, `${label}: the index tree is unchanged`).toBe(before.index);
  expect(after.worktrees, `${label}: the worktree list is unchanged, the copy removed`).toBe(before.worktrees);
  expect(after.runs, `${label}: proof/ holds no run folder`).toBe(before.runs);
  expect(after.tmp, `${label}: TMPDIR holds no throwaway folder`).toBe(before.tmp);
  expect(JSON.stringify(after.files, null, 1), `${label}: every file in the folder hashes the same`).toBe(JSON.stringify(before.files, null, 1));
};

describe('workkit prove', { skip: skipWithoutWrapper() }, () => {
  describe('workkit prove: the staged tree, never the folder', () => {
    test('held work breaking a test in the folder, passing work staged: green, the index tree recorded, check 5 passes', async () => {
      const w = mkWorld();
      stagePassing(w);
      holdBreaking(w);
      expect(folderRun(w) !== 0, 'the folder itself is red, so only a run on the staged tree is green').toBeTruthy();
      const index = indexTree(w);
      const res = prove(w);
      expect(res.code, `the staged tree is green, got: ${res.said}`).toBe(0);
      assertRecord(recorded(w), index, 'the record holds the index tree');

      const review = reviewMarkerPath(w.workflowHome, w.repo);
      fs.mkdirSync(path.dirname(review), { recursive: true });
      fs.writeFileSync(review, '');
      const out = await gateOn(w.repo, { ...wiredNpmEnv(w), TMPDIR: shellPath(w.tmp) });
      expect(out.deny, 'the commit of the staged tree passes the gate').toBe(null);
      expect(out.context.includes('suite proved'), `check 5 stands down on the record, got: ${out.context}`).toBeTruthy();
      cleanup(w.dir);
    });

    test('a record on the index tree, then the settings losing its version key staged: the gate still reads the commit as proved', async () => {
      const w = mkWorld();
      stagePassing(w);
      plantRecord(w.workflowHome, w.repo, indexTree(w));
      const review = reviewMarkerPath(w.workflowHome, w.repo);
      fs.mkdirSync(path.dirname(review), { recursive: true });
      fs.writeFileSync(review, '');
      w.write('.workkit/settings.json', OPT_IN_SHAPES.current);
      w.git('add', '.workkit/settings.json');
      const out = await gateOn(w.repo, { ...wiredNpmEnv(w), TMPDIR: shellPath(w.tmp) });
      expect(out.deny, 'the commit passes the gate').toBe(null);
      expect(out.context.includes('suite proved'), `check 5 stands down on the record, got: ${out.context}`).toBeTruthy();
      cleanup(w.dir);
    });

    test('another git holding the index lock: green, the index tree recorded, since the real index is never written', () => {
      const w = mkWorld();
      stagePassing(w);
      const index = indexTree(w);
      const lock = path.join(w.repo, '.git', 'index.lock');
      fs.writeFileSync(lock, '');
      const res = prove(w);
      expect(res.code, `a held index lock blocks no read, got: ${res.said}`).toBe(0);
      assertRecord(recorded(w), index, 'the record holds the index tree');
      expect(fs.existsSync(lock), 'the other git\'s lock stands').toBeTruthy();
      cleanup(w.dir);
    });

    test('staged work with a failing test: red, no record, non-zero exit', () => {
      const w = mkWorld();
      w.write('app.js', 'module.exports = 2;\n');
      w.git('add', 'app.js');
      w.write('app.js', 'module.exports = 1;\n');
      expect(folderRun(w), 'the folder itself is green, so only a run on the staged tree is red').toBe(0);
      const res = prove(w);
      expect(res.code !== 0, `the staged tree is red, got exit ${res.code}: ${res.said}`).toBeTruthy();
      expect(res.said.includes('2 !== 1'), `the suite's own failure reaches the caller, got: ${res.said}`).toBeTruthy();
      expect(recorded(w), 'a red run records nothing').toBe(undefined);
      cleanup(w.dir);
    });

    test('the status, the index tree and every file in the folder are the same before and after a run', () => {
      const green = mkWorld();
      green.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
      stagePassing(green);
      holdBreaking(green);
      const greenBefore = stateOf(green);
      expect(prove(green).code, 'the green run').toBe(0);
      assertUnchanged(greenBefore, stateOf(green), 'green');
      cleanup(green.dir);

      const red = mkWorld();
      red.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
      red.write('app.js', 'module.exports = 2;\n');
      red.git('add', 'app.js');
      red.write('test/held.test.js', "throw new Error('held work');\n");
      const redBefore = stateOf(red);
      expect(prove(red).code !== 0, 'the red run').toBeTruthy();
      assertUnchanged(redBefore, stateOf(red), 'red');
      cleanup(red.dir);
    });

    test('a test in the copy requiring a package from the gitignored node_modules runs green', () => {
      const w = mkWorld({ 'test/dep.test.js': "require('assert').strictEqual(require('tiny'), 5);\n" });
      w.write('node_modules/tiny/index.js', 'module.exports = 5;\n');
      stagePassing(w);
      const index = indexTree(w);
      const res = prove(w);
      expect(res.code, `the copy reaches node_modules, got: ${res.said}`).toBe(0);
      assertRecord(recorded(w), index, 'the record holds the index tree');
      expect(fs.readFileSync(path.join(w.repo, 'node_modules', 'tiny', 'index.js'), 'utf8'), 'the live node_modules is intact').toBe('module.exports = 5;\n');
      cleanup(w.dir);
    });

    test('a node_modules in an ignored folder reaches the proved copy as a regular file with the live content', () => {
      const check = [
        "const fs = require('fs'), path = require('path');",
        "const root = fs.realpathSync(path.join(__dirname, '..'));",
        "const file = path.join(root, 'cache', 'app', 'node_modules', 'x', 'index.js');",
        "require('assert').strictEqual(fs.realpathSync(file), file, 'the copy\\'s own file, through no link');",
        "require('assert').strictEqual(fs.readFileSync(file, 'utf8'), 'module.exports = 9;\\n');",
        '',
      ].join('\n');
      const w = mkWorld({ '.gitignore': 'node_modules/\ncache/\n', 'test/cache.test.js': check });
      w.write('cache/app/package.json', `${JSON.stringify({ name: 'app' })}\n`);
      w.write('cache/app/node_modules/x/index.js', 'module.exports = 9;\n');
      expect(folderRun(w), 'the check passes in the folder itself').toBe(0);
      stagePassing(w);
      const res = prove(w);
      expect(res.code, `the copy holds the ignored folder's module as it is, got: ${res.said}`).toBe(0);
      cleanup(w.dir);
    });
  });

  describe('workkit prove: the run folder', () => {
    /** The suite's report: its tree's root as `[proof, <id>, copy]` under the home's `.cache/workkit`, and the TMPDIR entries. */
    const seenBy = (w, seen) => {
      const report = JSON.parse(fs.readFileSync(seen, 'utf8'));
      const cache = cacheBase(fs.realpathSync(homeOf(w)));
      return { parts: path.relative(cache, report.root).split(path.sep), tmp: report.tmp };
    };

    test('the suite runs in <HOME>/.cache/workkit/proof/<id>/copy, no prove.* in TMPDIR, and the run folder is gone after', () => {
      const { w, seen, env } = seeingWorld();
      stagePassing(w);
      const res = prove(w, env);
      expect(res.code, `green, got: ${res.said}`).toBe(0);
      const { parts, tmp } = seenBy(w, seen);
      expect(parts.length === 3 && parts[0] === 'proof' && /^[^/\\]{6}$/.test(parts[1]) && parts[2] === 'copy',
        `the copy is proof/<six characters>/copy under the home's .cache/workkit, got: ${parts.join('/')}`).toBeTruthy();
      expect(!tmp.some((name) => name.startsWith('prove.')), `no prove.* in TMPDIR while the suite ran: ${tmp.join(', ')}`).toBeTruthy();
      expect(runFolders(homeOf(w)).join(', '), 'the run folder is gone').toBe('');
      cleanup(w.dir);
    });

    test('a run folder under proof/ changed over a day ago is removed by the next run, one changed within the day is left', () => {
      const w = mkWorld();
      plantRun(homeOf(w), 'stale1', 2);
      plantRun(homeOf(w), 'fresh1', 1 / 24);
      stagePassing(w);
      const res = prove(w);
      expect(res.code, `green, got: ${res.said}`).toBe(0);
      expect(runFolders(homeOf(w)).join(', '), 'the stale folder removed, the fresh one and nothing else left').toBe('fresh1');
      cleanup(w.dir);
    });

    test('a green suite whose record cannot be written: exit 1, no record, the run folder gone', () => {
      const { w, seen, env } = seeingWorld();
      stagePassing(w);
      fs.mkdirSync(suiteMarkerPath(w.workflowHome, w.repo), { recursive: true });
      const res = prove(w, env);
      expect(res.code, `the failed record write, got: ${res.said}`).toBe(1);
      expect(seenBy(w, seen).parts[0], `the suite ran in a run folder first: ${res.said}`).toBe('proof');
      expect(runFolders(homeOf(w)).join(', '), 'the run folder is gone').toBe('');
      cleanup(w.dir);
    });

    test('a proof/ no run folder can be made in: exit 1 with the could-not-make line, no record', () => {
      const w = mkWorld();
      stagePassing(w);
      fs.mkdirSync(path.dirname(proofBase(homeOf(w))), { recursive: true });
      fs.writeFileSync(proofBase(homeOf(w)), '');
      const res = prove(w);
      expect(res.code, `exit 1, got: ${res.said}`).toBe(1);
      const line = res.said.split('\n').find((l) => l.startsWith('prove: could not make a run folder under ')) || '';
      expect(line.endsWith('.cache/workkit/proof'), `the line names the folder, got: ${res.said}`).toBeTruthy();
      expect(recorded(w), 'nothing recorded').toBe(undefined);
      cleanup(w.dir);
    });
  });

  describe('workkit prove: CI set', () => {
    test('with CI=true: exit 1, the line on stderr, no run folder made, no suite run, no record', () => {
      const { w, seen, env } = seeingWorld();
      stagePassing(w);
      const res = prove(w, { ...env, CI: 'true' });
      expect(res.code, `exit 1, got: ${res.code} ${res.said}`).toBe(1);
      expect(res.err.split(/\r?\n/).includes('prove: CI is set, so no record would be written; run workkit prove again without CI'),
        `the line on stderr, got stderr: ${res.err} stdout: ${res.out}`).toBeTruthy();
      expect(runFolders(homeOf(w)).join(', '), 'no run folder, so no copy, was made').toBe('');
      expect(fs.existsSync(seen), 'the suite never ran').toBe(false);
      expect(recorded(w), 'nothing recorded').toBe(undefined);
      cleanup(w.dir);
    });
  });

  describe('workkit prove: the supervisor\'s checks', () => {
    test('a suite that freezes: exit 124, no record, the run folder gone', { skip: skipOnWindows() }, () => {
      // A test that writes its pid to the file PROVE_PID names and then waits in silence.
      const hang = "require('fs').writeFileSync(process.env.PROVE_PID, String(process.pid));\nsetInterval(() => {}, 1 << 30);\n";
      const w = mkWorld({ '.workkit/settings.json': checkSettings(CHECK_MINUTES, true), 'test/hang.test.js': hang });
      const pidFile = path.join(w.dir, 'hang.pid');
      try {
        const res = prove(w, { PROVE_PID: pidFile });
        expect(res.code, `the frozen run's code, got: ${res.said}`).toBe(124);
        expect(recorded(w), 'a frozen run records nothing').toBe(undefined);
        expect(runFolders(homeOf(w)).join(', '), 'the run folder is gone').toBe('');
      } finally {
        reap(pidIn(pidFile));
      }
      cleanup(w.dir);
    });
  });
});
