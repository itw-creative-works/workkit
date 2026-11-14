// Tests for workflow/user-dir.js: the machine folder for the Node half of the
// kit, the twin of `wk_user_dir` in workflow/lib/platform.sh (cased in
// test/scripts/platform.test.js).

const os = require('os');
const path = require('path');
const { describe, test, expect } = require('../lib/harness');

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

describe('user-dir: the machine folder', () => {
  test('userDir: WORKFLOW_HOME wins, else .workkit under the home, else under os.homedir()', () => {
    expect(withWorkflowHome('/w/kit', () => userDir('/h')), 'the override').toBe('/w/kit');
    expect(withWorkflowHome(undefined, () => userDir('/h')), 'the home given').toBe(path.join('/h', '.workkit'));
    expect(withWorkflowHome(undefined, () => userDir()), 'the real home').toBe(path.join(os.homedir(), '.workkit'));
    expect(withWorkflowHome('', () => userDir('/h')), 'an empty override is none').toBe(path.join('/h', '.workkit'));
  });

  test('homeUserDir: .workkit under the home, and WORKFLOW_HOME never read', () => {
    expect(withWorkflowHome('/w/kit', () => homeUserDir('/h')), 'the override ignored').toBe(path.join('/h', '.workkit'));
    expect(withWorkflowHome('/w/kit', () => homeUserDir()), 'the real home').toBe(path.join(os.homedir(), '.workkit'));
  });
});
