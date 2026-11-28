// Tests for workflow/user-dir.js: the machine folder for the kit's Node, the
// rule hooks/mods/log.js's userDir shares (both cased in test/hooks/twins.test.js).

const os = require('os');
const path = require('path');
const { describe, test, expect, mkTmp } = require('../lib/harness');
const { IS_WINDOWS, shellPath } = require('../lib/platform');

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
  // Drive-spelled, which nativePath keeps on every system.
  test('userDir: a WORKFLOW_HOME in the drive spelling wins, as given', () => {
    expect(withWorkflowHome('C:/w/kit', () => userDir('/h')), 'the override').toBe('C:/w/kit');
  });

  // The scratch folder is under TEMP, so its shell spelling is `/tmp/...`, which
  // Node would read from the drive root; it is read in the native spelling instead.
  test('userDir: a WORKFLOW_HOME in the Git Bash spelling is the same folder, in its drive spelling', {
    skip: !IS_WINDOWS && 'off Windows the shell spells a folder as Node reads it',
  }, () => {
    const machine = mkTmp('wk-user-dir-');
    expect(withWorkflowHome(shellPath(machine), () => userDir('/h')), 'the native folder in / separators').toBe(machine.replace(/\\/g, '/'));
  });

  test('userDir: with no WORKFLOW_HOME, .workkit under the home, else under os.homedir()', () => {
    expect(withWorkflowHome(undefined, () => userDir('/h')), 'the home given').toBe(path.join('/h', '.workkit'));
    expect(withWorkflowHome(undefined, () => userDir()), 'the real home').toBe(path.join(os.homedir(), '.workkit'));
    expect(withWorkflowHome('', () => userDir('/h')), 'an empty override is none').toBe(path.join('/h', '.workkit'));
  });

  test('homeUserDir: .workkit under the home, and WORKFLOW_HOME never read', () => {
    expect(withWorkflowHome('/w/kit', () => homeUserDir('/h')), 'the override ignored').toBe(path.join('/h', '.workkit'));
    expect(withWorkflowHome('/w/kit', () => homeUserDir()), 'the real home').toBe(path.join(os.homedir(), '.workkit'));
  });
});
