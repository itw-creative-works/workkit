// Tests for `workkit prove`: the root suite run on exactly the staged tree, in a
// throwaway copy under the home's `.cache/workkit/proof`, recording the index's
// tree on green (docs/project-state.md § The proof), and ending a suite that
// freezes. Each case is a real repo with its own home and TMPDIR, on a machine
// whose npm names the kit's wrapper.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, run, pidIn, mkTmp, until,
} = require('../lib/harness');
const {
  NODE_DIR, SYSTEM_PATH, shellPath, joinPath, which, stubTool, basePathWithout, nodeEnv, skipWithoutCaughtSignal,
} = require('../lib/platform');
const { recordArgv, readArgv, fmtCalls } = require('../lib/argv-log');
const { mkRepo, OPT_IN_SHAPES } = require('../lib/git-repo');
const { treeOf } = require('../lib/red-snapshot');
const {
  suiteMarkerPath, suiteLogPath, reviewMarkerPath, kitIndexTree, plantRecord,
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
  CHECK_MINUTES, skipOnWindows, checkSettings, reap, realOf,
} = require('../lib/supervise');
const { workkitStart } = require('../lib/supervise-world');

const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });

const CLI = path.join(__dirname, '..', '..', 'workflow', 'workkit.js');

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

// The number of worktrees git lists for the world's repo, its own among them.
const worktreeCount = (w) => w.git('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;

// The last line of <text>, its closing newline aside.
const lastOf = (text) => text.replace(/\n$/, '').split('\n').pop();

// The repo root as git spells it, the spelling a prove: line prints.
const topOf = (w) => w.git('rev-parse', '--show-toplevel').trim();

// Whether <fn> threw.
const threw = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// A fixture test that marks it started at PROVE_STARTED, then holds the run until PROVE_GO exists.
const WAITS = [
  "const fs = require('fs');",
  "fs.writeFileSync(process.env.PROVE_STARTED, '');",
  'const t = setInterval(() => { if (fs.existsSync(process.env.PROVE_GO)) clearInterval(t); }, 50);',
  '',
].join('\n');

/** The pids from <pid> up to the nearest ancestor whose command line <match> accepts, by `ps`; empty when none does. */
const chainUpTo = (pid, match) => {
  const chain = [];
  for (let at = pid; at > 1;) {
    const res = run('ps', ['-o', 'ppid=,command=', '-p', String(at)]);
    const row = /^\s*(\d+)\s+(.*)$/.exec(res.stdout.trim());
    if (!row) return [];
    chain.push(at);
    if (match(row[2])) return chain;
    at = Number(row[1]);
  }
  return [];
};

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

    // A fixture test writing, to the file PROVE_SEEN names, the Claude home it was handed: as given, real, and its entries.
    const CLAUDE_HOME_SEEN = [
      "const fs = require('fs');",
      "const home = process.env.WORKFLOW_CLAUDE_HOME || '';",
      "const dir = home !== '' && fs.existsSync(home) && fs.statSync(home).isDirectory();",
      'fs.writeFileSync(process.env.PROVE_SEEN, JSON.stringify({ home, real: dir ? fs.realpathSync(home) : null, entries: dir ? fs.readdirSync(home) : null }));',
      '',
    ].join('\n');

    test('the suite runs with an empty WORKFLOW_CLAUDE_HOME of its own in the run folder, never the caller\'s, gone after', () => {
      const w = mkWorld({ 'test/claude-home.test.js': CLAUDE_HOME_SEEN });
      const seen = path.join(w.dir, 'seen.json');
      const caller = path.join(w.dir, 'caller-claude');
      fs.mkdirSync(caller);
      stagePassing(w);
      const res = prove(w, { PROVE_SEEN: seen, WORKFLOW_CLAUDE_HOME: caller });
      expect(res.code, `green, got: ${res.said}`).toBe(0);
      const report = JSON.parse(fs.readFileSync(seen, 'utf8'));
      expect(report.entries, `an existing empty folder, got: ${JSON.stringify(report)}`).toEqual([]);
      const parts = path.relative(cacheBase(fs.realpathSync(homeOf(w))), report.real).split(path.sep);
      expect(parts.length === 3 && parts[0] === 'proof' && /^[^/\\]{6}$/.test(parts[1]) && parts[2] !== 'copy',
        `a folder of its own in proof/<id>/, beside the copy, got: ${parts.join('/')}`).toBeTruthy();
      expect(report.real === fs.realpathSync(caller), 'not the caller\'s').toBe(false);
      expect(fs.existsSync(report.home), 'gone after the run').toBe(false);
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

  describe('workkit prove: the stops before a run', () => {
    // Nothing started: no run folder, no worktree beside the repo's own, no record.
    const assertNothingRun = (w, label) => {
      expect(runFolders(homeOf(w)).join(', '), `${label}: no run folder`).toBe('');
      expect(worktreeCount(w), `${label}: no worktree added`).toBe(1);
      expect(recorded(w), `${label}: nothing recorded`).toBe(undefined);
    };

    test('any argument: the usage line, exit 2', () => {
      const w = mkWorld();
      const res = runCli(w, ['prove', 'now'], { cwd: w.repo, env: wiredNpmEnv(w) });
      expect(res.code, `exit 2, got: ${res.said}`).toBe(2);
      expect(res.err, 'the usage line').toBe('prove: takes no arguments (usage: workkit prove)\n');
      assertNothingRun(w, 'usage');
      cleanup(w.dir);
    });

    test('outside a git repository, with no test script, with no npm on PATH: its prove: line each, exit 1', () => {
      const w = mkWorld();
      const outside = runCli(w, ['prove'], { cwd: mkTmp('prove-outside-'), env: wiredNpmEnv(w) });
      expect(outside.code, `outside a repo: exit 1, got: ${outside.said}`).toBe(1);
      expect(lastOf(outside.err), 'outside a repo').toBe('prove: not inside a git repository');

      const bare = mkWorld({ 'package.json': `${JSON.stringify({ name: 'fixture', version: '1.0.0' })}\n` });
      const noScript = prove(bare);
      expect(noScript.code, `no test script: exit 1, got: ${noScript.said}`).toBe(1);
      expect(lastOf(noScript.err), 'no test script')
        .toBe(`prove: ${topOf(bare)} declares no test script, so there is no suite to prove`);
      assertNothingRun(bare, 'no test script');

      const noNpm = prove(w, { PATH: basePathWithout(w.dir, 'npm'), ...nodeEnv });
      expect(noNpm.code, `no npm: exit 1, got: ${noNpm.said}`).toBe(1);
      expect(lastOf(noNpm.err), 'no npm').toBe('prove: npm is not on PATH');
      assertNothingRun(w, 'no npm');
      cleanup(w.dir);
      cleanup(bare.dir);
    });

    test('a logs.dir outside the repo: one line naming it, exit 1, nothing written outside', () => {
      const w = mkWorld({ '.workkit/settings.json': `${JSON.stringify({ enabled: true, logs: { dir: '../x' } })}\n` });
      stagePassing(w);
      const res = prove(w);
      expect(res.code, `exit 1, got: ${res.said}`).toBe(1);
      expect(res.said.split('\n').filter((l) => l.includes('logs.dir') && l.includes('../x')).length, `one line names logs.dir, got: ${res.said}`).toBe(1);
      expect(fs.existsSync(path.join(w.dir, 'x')), 'nothing written outside the repo').toBe(false);
      assertNothingRun(w, 'logs.dir');
      cleanup(w.dir);
    });
  });

  describe('workkit prove: a root suite run already live', () => {
    test('a second prove while one runs: the line names the pid and the suite log, exit 1; the first goes on green', async () => {
      const w = mkWorld({ 'test/wait.test.js': WAITS });
      stagePassing(w);
      const started = path.join(w.dir, 'started');
      const go = path.join(w.dir, 'go');
      const env = { ...wiredNpmEnv(w), PROVE_STARTED: started, PROVE_GO: go };
      const first = workkitStart(['prove'], { cwd: w.repo, env });
      try {
        expect(await until(() => fs.existsSync(started)), `the first suite never started: ${first.output()}`).toBeTruthy();
        const second = prove(w, { PROVE_STARTED: started, PROVE_GO: go });
        expect(second.code, `exit 1, got: ${second.said}`).toBe(1);
        const said = second.err.match(/^prove: a root suite run is already running \(pid (\d+)\); its output is in (.+)$/m);
        expect(Boolean(said) && Number(said[1]) > 0, `the line with a pid, got: ${second.err}`).toBe(true);
        expect(realOf(said[2]), `the line names the suite log, got: ${second.err}`).toBe(realOf(suiteLogPath(w.workflowHome, w.repo)));
        fs.writeFileSync(go, '');
        const { status } = await first.done;
        expect(status, `the first run is green: ${first.output()}`).toBe(0);
      } finally {
        await first.end('SIGKILL');
      }
      cleanup(w.dir);
    });
  });

  describe('workkit prove: a body that cannot go on', () => {
    // A stop inside the body: its line, exit 1, the worktree and the run folder removed, no record.
    const assertStopped = (w, res, line, label) => {
      expect(res.code, `${label}: exit 1, got: ${res.said}`).toBe(1);
      expect(res.said.split('\n').includes(line), `${label}: the line, got: ${res.said}`).toBe(true);
      expect(runFolders(homeOf(w)).join(', '), `${label}: the run folder is gone`).toBe('');
      expect(worktreeCount(w), `${label}: the worktree is gone`).toBe(1);
      expect(recorded(w), `${label}: nothing recorded`).toBe(undefined);
    };

    test('an unmerged path in the index: the could-not-write line, exit 1, nothing left', () => {
      const w = mkWorld();
      w.git('checkout', '-q', '-b', 'other');
      w.write('app.js', 'module.exports = 5;\n');
      w.git('commit', '-q', '-am', 'other');
      w.git('checkout', '-q', 'main');
      w.write('app.js', 'module.exports = 6;\n');
      w.git('commit', '-q', '-am', 'main');
      expect(threw(() => w.git('merge', '-q', 'other')), 'the merge stops on a conflict').toBe(true);
      const res = prove(w);
      assertStopped(w, res, "prove: could not write the whole index's tree for the copy (an unmerged path blocks it); resolve it and stage again", 'unmerged');
      cleanup(w.dir);
    });

    test('a repo with no commit: the no-commit line, exit 1, nothing left', () => {
      const w = mkWorld();
      w.git('update-ref', '-d', 'HEAD');
      const res = prove(w);
      assertStopped(w, res, `prove: ${topOf(w)} has no commit to add a worktree of`, 'no commit');
      cleanup(w.dir);
    });

    test('a suite that passes but changes the copy\'s tree: its line, exit 1, no record, nothing left', () => {
      const w = mkWorld({ 'test/make.test.js': "require('fs').writeFileSync(require('path').join(__dirname, '..', 'made.txt'), 'x\\n');\n" });
      stagePassing(w);
      const res = prove(w);
      assertStopped(w, res, "prove: the suite passed, but it changed the copy's tree, so no record was written", 'changed tree');
      cleanup(w.dir);
    });

    test('a body ended by TERM: exit 143, prove: exit 143 last, the worktree and the run folder gone, no record', {
      skip: skipWithoutCaughtSignal(),
    }, async () => {
      const hang = "require('fs').writeFileSync(process.env.PROVE_PID, String(process.pid));\nsetInterval(() => {}, 1 << 30);\n";
      const w = mkWorld({ 'test/hang.test.js': hang });
      const pidFile = path.join(w.dir, 'hang.pid');
      const call = workkitStart(['prove'], { cwd: w.repo, env: { ...wiredNpmEnv(w), PROVE_PID: pidFile } });
      try {
        expect(await until(() => pidIn(pidFile) > 0), `the suite never started: ${call.output()}`).toBeTruthy();
        // The body and every process between it and the suite, as an end of the run's tree reaches them.
        const chain = chainUpTo(pidIn(pidFile), (command) => command.includes('prove.js') && command.includes('--body'));
        expect(chain.length > 1, `the body is among the suite's ancestors: ${call.output()}`).toBe(true);
        for (const pid of chain) process.kill(pid, 'SIGTERM');
        const { status } = await call.done;
        expect(status, `exit 143: ${call.output()}`).toBe(143);
        expect(lastOf(call.output().replace(/\r/g, '')), 'the last line').toBe('prove: exit 143');
        expect(runFolders(homeOf(w)).join(', '), 'the run folder is gone').toBe('');
        expect(worktreeCount(w), 'the worktree is gone').toBe(1);
        expect(recorded(w), 'nothing recorded').toBe(undefined);
      } finally {
        await call.end('SIGKILL');
        reap(pidIn(pidFile));
      }
      cleanup(w.dir);
    });
  });

  describe('workkit prove: the hold, asked in process', () => {
    test('a proved index tree in a Claude session: the hold\'s line, exit 1, the record as it was, and no bash started on the way', () => {
      const w = mkWorld();
      stagePassing(w);
      holdBreaking(w);
      const tree = indexTree(w);
      plantRecord(w.workflowHome, w.repo, tree);
      // A bash first on PATH that records each start, then hands it to the real one;
      // the command itself is workflow/workkit.js under the running node.
      // The rest of PATH is node and the system tools, so no shim of the session's is a bash script reached by name.
      const bin = mkTmp('prove-bash-');
      const starts = path.join(bin, 'starts.log');
      stubTool(bin, 'bash', ['#!/bin/bash', recordArgv(starts), `exec "${shellPath(which('bash', SYSTEM_PATH))}" "$@"`]);
      const env = { ...wiredNpmEnv(w), CLAUDECODE: '1', PATH: joinPath(bin, NODE_DIR, SYSTEM_PATH) };
      const res = run(process.execPath, [CLI, 'prove'], { cwd: w.repo, env });
      expect(res.status, `refused with exit 1, got: ${res.status} ${res.stdout}${res.stderr}`).toBe(1);
      expect(res.stderr.includes('suite-hold: this tree is already proved'), `the hold's line, got: ${res.stderr}`).toBe(true);
      expect(recorded(w), 'the record as it was').toBe(`${tree}\n`);
      expect(fmtCalls(readArgv(starts)), 'no bash was started').toBe(fmtCalls([]));
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
