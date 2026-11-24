// Tests for the two catches of the committed reads: the export of a folder's committed files
// (workflow/home/committed.js) and the runner list a kit folder holds (workflow/home/runner.js). Each catches the
// one failure it expects; any other error is thrown.

const fs = require('fs');
const path = require('path');
const {
  describe, test, expect, mkTmp, run,
} = require('../../lib/harness');
const { jsPath } = require('../../lib/platform');
const { caught } = require('../../lib/caught');
const { git } = require('./helpers');
const { exportOf } = require('../../../workflow/home/committed');
const { runnerList } = require('../../../workflow/home/runner');

const COMMITTED = path.join(__dirname, '..', '..', '..', 'workflow', 'home', 'committed.js');

/** A repo whose `app` folder holds one file, staged; committed when <commit>. Answers the app folder. */
const appRepo = ({ commit }) => {
  const repo = mkTmp('committed-repo-');
  git(repo, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(repo, 'app'));
  fs.writeFileSync(path.join(repo, 'app', 'README.md'), '# the app\n');
  git(repo, 'add', 'app');
  if (commit) git(repo, '-c', 'user.name=seed', '-c', 'user.email=seed@localhost', 'commit', '-q', '-m', 'chore: the app');
  return path.join(repo, 'app');
};

/** A kit folder whose runner-files.js holds <text>. */
const kitWithList = (text) => {
  const kit = mkTmp('committed-kit-');
  fs.mkdirSync(path.join(kit, 'workflow', 'home'), { recursive: true });
  fs.writeFileSync(path.join(kit, 'workflow', 'home', 'runner-files.js'), text);
  return kit;
};

describe('committed.js: the export\'s catch', () => {
  test('a git failure in the export gives no folder, and the source names it', () => {
    // Staged but never committed: the folder is tracked and HEAD does not exist, so git's read of it fails.
    const app = appRepo({ commit: false });
    const script = `Promise.resolve(require(${jsPath(COMMITTED)}).source(process.argv[1], process.argv[2])).then((a) => process.stdout.write(JSON.stringify(a)));`;
    const res = run(process.execPath, ['-e', script, mkTmp('committed-scratch-'), app], { env: { ...process.env, NO_COLOR: '1' } });
    expect(res.status, `the call answered, stderr: ${res.stderr}`).toBe(0);
    expect(JSON.parse(res.stdout), 'no folder to read').toBe('');
    expect(res.stderr.includes('could not export the committed files'), `the line names the failure, got: ${res.stderr}`).toBe(true);
  });

  test('an error that is not git\'s is thrown', async () => {
    // The committed file's place in the export is already a folder: git reads it fine, and the export's own write fails.
    const app = appRepo({ commit: true });
    const scratch = mkTmp('committed-scratch-');
    fs.mkdirSync(path.join(scratch, 'src', 'README.md'), { recursive: true });
    expect(await caught(() => exportOf(scratch, app)), 'the write\'s error, thrown').toBeInstanceOf(Error);
  });
});

describe('runner.js: the list\'s catch', () => {
  test('a list that cannot be loaded reads as no list, and an error its load throws is thrown', async () => {
    expect(runnerList(kitWithList('module.exports = [\n')), 'a list that does not parse').toEqual([]);
    const err = await caught(() => runnerList(kitWithList('module.exports = null.pairs;\n')));
    expect(err, 'the list\'s own TypeError').toBeInstanceOf(TypeError);
  });

  test('a list that requires a file that is not there reads as no list', () => {
    expect(runnerList(kitWithList("module.exports = require('./gone');\n")), 'a list that cannot be loaded').toEqual([]);
  });
});
