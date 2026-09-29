// Tests for workflow/user-dir.js: the machine folder for the Node half of the
// kit, the twin of `wk_user_dir` in workflow/lib/platform.sh (cased in
// tests/scripts/platform.test.js).

const os = require('os');
const path = require('path');
const { group, test, assertEq, summary, selfRun } = require('../lib/harness');

const { userDir, homeUserDir } = require(path.join(__dirname, '..', '..', 'workflow', 'user-dir.js'));

/** Run <fn> with WORKFLOW_HOME set to <value> (undefined unsets it), then put it back. */
const withWorkflowHome = (value, fn) => {
  const before = process.env.WORKFLOW_HOME;
  if (value === undefined) delete process.env.WORKFLOW_HOME;
  else process.env.WORKFLOW_HOME = value;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.WORKFLOW_HOME;
    else process.env.WORKFLOW_HOME = before;
  }
};

const run = async () => {
  group('user-dir: the machine folder');

  await test('userDir: WORKFLOW_HOME wins, else .workkit under the home, else under os.homedir()', () => {
    assertEq(withWorkflowHome('/w/kit', () => userDir('/h')), '/w/kit', 'the override');
    assertEq(withWorkflowHome(undefined, () => userDir('/h')), path.join('/h', '.workkit'), 'the home given');
    assertEq(withWorkflowHome(undefined, () => userDir()), path.join(os.homedir(), '.workkit'), 'the real home');
    assertEq(withWorkflowHome('', () => userDir('/h')), path.join('/h', '.workkit'), 'an empty override is none');
  });

  await test('homeUserDir: .workkit under the home, and WORKFLOW_HOME never read', () => {
    assertEq(withWorkflowHome('/w/kit', () => homeUserDir('/h')), path.join('/h', '.workkit'), 'the override ignored');
    assertEq(withWorkflowHome('/w/kit', () => homeUserDir()), path.join(os.homedir(), '.workkit'), 'the real home');
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
