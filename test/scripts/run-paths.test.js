// Tests for workflow/lib/run-paths.js, the Node home of a run's log and lock: runPaths for the
// suite, the supervised run, the CI watch and a narrowed run's slot, each log in the log folder
// when git ignores it there and under the machine's markers otherwise; testSlots, the slots whose
// lock folder stands; clearSlot, one slot's log and record removed and another's kept.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp,
} = require('../lib/harness');
const { homeEnv, samePath } = require('../lib/platform');
const { mkRepo } = require('../lib/git-repo');
const { repoMarkerPath } = require('../lib/suite-record');

// A scratch home and machine folder for this process, set before run-paths.js loads, so
// the markers and git's ignore rules are this suite's own, never the machine's.
const HOME = mkTmp('run-paths-home-');
const WORKFLOW_HOME = path.join(HOME, '.workkit');
Object.assign(process.env, homeEnv(HOME, { WORKFLOW_HOME }));
delete process.env.XDG_CONFIG_HOME;

const { runPaths, testSlots, clearSlot } = require('../../workflow/lib/run-paths');

/** A committed repo, `.workkit/` ignored when <ignored>; its root as git prints it, and its folder. */
const repoOf = (ignored) => {
  const r = mkRepo('run-paths-', { 'app.js': '', ...(ignored ? { '.gitignore': '.workkit/*\n' } : {}) }, undefined, { optIn: false });
  return { root: r.git('rev-parse', '--show-toplevel').trim(), repo: r.repo };
};

/** <repo>'s marker <name> under the scratch machine folder, <suffix> after its key. */
const marker = (repo, name, suffix = '') => `${repoMarkerPath(WORKFLOW_HOME, name, repo)}${suffix}`;

/** Asserts runPaths' answer, awaited, against <wanted> `{ log, lock }`, a path in either spelling. */
const answers = async (asked, wanted, what) => {
  const got = await asked;
  for (const key of ['log', 'lock']) {
    expect(samePath(got[key], wanted[key], process.platform), `${what} ${key}: wanted ${wanted[key]}, got ${got[key]}`).toBe(true);
  }
};

const SLOT = 123;

describe('runPaths', () => {
  test('a repo whose log folder git ignores: each log in it, each lock under the machine\'s markers, a slot\'s both ending .<pid>', async () => {
    const { root, repo } = repoOf(true);
    const logs = path.join(root, '.workkit');
    await answers(runPaths(root, 'suite'), { log: path.join(logs, 'suite.log'), lock: marker(repo, 'claude-suite-lock') }, 'suite');
    await answers(runPaths(root, 'run'), { log: path.join(logs, 'run.log'), lock: marker(repo, 'claude-run-lock') }, 'run');
    await answers(runPaths(root, 'ci'), { log: path.join(logs, 'ci.log'), lock: marker(repo, 'claude-ci-watch-lock') }, 'ci');
    await answers(runPaths(root, 'test', SLOT), { log: path.join(logs, `test.log.${SLOT}`), lock: marker(repo, 'claude-test-lock', `.${SLOT}`) }, 'test');
  });

  test('a repo whose log folder git does not ignore: each log under the machine\'s markers, so no log is in the tree', async () => {
    const { root, repo } = repoOf(false);
    await answers(runPaths(root, 'suite'), { log: marker(repo, 'claude-suite.log'), lock: marker(repo, 'claude-suite-lock') }, 'suite');
    await answers(runPaths(root, 'run'), { log: marker(repo, 'claude-run.log'), lock: marker(repo, 'claude-run-lock') }, 'run');
    await answers(runPaths(root, 'ci'), { log: marker(repo, 'claude-ci.log'), lock: marker(repo, 'claude-ci-watch-lock') }, 'ci');
    await answers(runPaths(root, 'test', SLOT), { log: marker(repo, 'claude-test.log', `.${SLOT}`), lock: marker(repo, 'claude-test-lock', `.${SLOT}`) }, 'test');
  });
});

describe('testSlots and clearSlot', () => {
  test('testSlots: the pid of each slot whose lock folder stands, live or not, never a record alone or another repo\'s slot', async () => {
    const { root, repo } = repoOf(true);
    const other = repoOf(true);
    for (const pid of [111, 222]) fs.mkdirSync(marker(repo, 'claude-test-lock', `.${pid}`), { recursive: true });
    fs.writeFileSync(marker(repo, 'claude-test-lock', '.333.done'), '333 0\n');
    fs.mkdirSync(marker(other.repo, 'claude-test-lock', '.444'), { recursive: true });
    const slots = (await testSlots(root)).map(String).sort();
    expect(slots.join(' '), 'the two slots whose lock folder stands').toBe('111 222');
  });

  test('clearSlot: the slot\'s log and the record beside its lock removed, another slot\'s log and record kept', async () => {
    const { root, repo } = repoOf(true);
    const slotOf = (pid) => ({ log: path.join(repo, '.workkit', `test.log.${pid}`), record: marker(repo, 'claude-test-lock', `.${pid}.done`) });
    const [cleared, kept] = [slotOf(111), slotOf(222)];
    for (const { log, record } of [cleared, kept]) {
      for (const file of [log, record]) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, 'x\n');
      }
    }
    await clearSlot(root, 111);
    expect(fs.existsSync(cleared.log) || fs.existsSync(cleared.record), `the slot's log and record are gone: ${cleared.log}, ${cleared.record}`).toBe(false);
    expect(fs.existsSync(kept.log) && fs.existsSync(kept.record), `the other slot's log and record are kept: ${kept.log}, ${kept.record}`).toBe(true);
  });
});
