// The snippet runner for the engine's shell library: a bash with
// workflow/lib/platform.sh sourced runs one snippet and hands back its exit
// code and both streams. Consumers: the test/hooks/lib suite and
// test/scripts/watch.test.js.

const os = require('os');
const path = require('path');
const { SYSTEM_PATH, NO_RC, shellPath, spawnSystemBash } = require('./platform');
const { SPAWN_DEADLINE } = require('./harness');

const LIB = path.join(__dirname, '..', '..', 'workflow', 'lib');

/**
 * Run <snippet> with workflow/lib/platform.sh sourced.
 * bash is spawned by absolute path so a case can hand over a PATH holding nothing at all.
 * @param {string} snippet - the bash run after the source line
 * @param {object} [env] - merged over the system PATH and the real HOME
 * @returns {{code: number, stdout: string, stderr: string}}
 */
const runLib = (snippet, env = {}) => {
  const res = spawnSystemBash([...NO_RC, '-c', `. "${shellPath(path.join(LIB, 'platform.sh'))}"\n${snippet}`], {
    env: { PATH: SYSTEM_PATH, HOME: shellPath(os.homedir()), ...env },
    encoding: 'utf8',
    timeout: SPAWN_DEADLINE,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
};

module.exports = { runLib };
