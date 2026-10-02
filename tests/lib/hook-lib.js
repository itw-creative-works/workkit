// The snippet runner for hooks/_lib.sh: a bash with the library sourced runs
// one snippet and hands back its exit code and both streams. Consumers: the
// tests/hooks/lib and lib-record suites.

const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SYSTEM_BASH, SYSTEM_PATH, NO_RC, shellPath } = require('./platform');

const LIB = shellPath(path.join(__dirname, '..', '..', 'hooks', '_lib.sh'));

/**
 * Run <snippet> with hooks/_lib.sh sourced. bash is spawned by absolute path so
 * a case can hand over a PATH holding nothing at all.
 * @param {string} snippet - the bash run after the source line
 * @param {object} [env] - merged over the system PATH and the real HOME
 * @returns {{code: number, stdout: string, stderr: string}}
 */
const runLib = (snippet, env = {}) => {
  const res = spawnSync(SYSTEM_BASH, [...NO_RC, '-c', `. "${LIB}"\n${snippet}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: 10000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

module.exports = { runLib };
