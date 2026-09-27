// The suite marker read independently of hooks/lib/suite.sh: its path under a
// temp dir, the working tree's hash by the temp-index recipe, and one run of
// the recorder, safety/suite-marker. Consumers: the suite-guard, suite-marker
// and commit-gate suites.

const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { BASH, NO_RC, SYSTEM_PATH, shellPath } = require('./platform');
const { mkTmp } = require('./scratch');

const RECORDER = path.join(__dirname, '..', '..', 'hooks', 'safety', 'suite-marker', 'run.sh');

const repoRoot = (dir) => spawnSync('git', ['rev-parse', '--show-toplevel'],
  { cwd: dir, encoding: 'utf8' }).stdout.trim();

/** The marker file for <dir>'s repo under <tmp>, keyed by the sha1 of its root. */
const suiteMarkerPath = (tmp, dir) => path.join(tmp, 'claude-suite-marker',
  crypto.createHash('sha1').update(repoRoot(dir)).digest('hex'));

/** The working tree's `git write-tree` id, built in a throwaway index. */
const treeHash = (dir) => {
  const env = { ...process.env, GIT_INDEX_FILE: path.join(mkTmp('tree-index-'), 'index') };
  spawnSync('git', ['add', '-A'], { cwd: dir, env });
  return spawnSync('git', ['write-tree'], { cwd: dir, env, encoding: 'utf8' }).stdout.trim();
};

/** The Bash tool_response PostToolUse carries: no exit code, since it fires only after exit 0. */
const RESPONSE = { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };

/** Run the recorder on a Bash tool result; the default is a finished `npm test` at <dir>. */
const record = (tmp, dir, {
  command = 'npm test', cwd = dir, toolInput = {}, response = RESPONSE, env = {}, bash = BASH,
} = {}) => spawnSync(bash, [...NO_RC, shellPath(RECORDER)], {
  input: JSON.stringify({
    tool_name: 'Bash', cwd: shellPath(cwd), tool_input: { command, ...toolInput }, tool_response: response,
  }),
  env: { HOME: shellPath(os.homedir()), PATH: SYSTEM_PATH, TMPDIR: shellPath(tmp), ...env },
  encoding: 'utf8',
  timeout: 15000,
});

module.exports = { RECORDER, RESPONSE, suiteMarkerPath, treeHash, record };
