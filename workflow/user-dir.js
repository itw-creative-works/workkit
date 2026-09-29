// workflow/user-dir.js: the machine's own workkit folder, for the Node half of
// the kit. The twin of `wk_user_dir` in lib/platform.sh: change one and change
// the other. It requires nothing beyond Node, so the engine stays self-contained.
// Usage: const { userDir, homeUserDir } = require('./user-dir');

const os = require('os');
const path = require('path');

const WORKKIT_DIR = '.workkit';

/**
 * The folder under <home>, WORKFLOW_HOME never read: the roster readers resolve
 * through os.homedir() alone, which is why morning.sh pins WORKFLOW_HOME there.
 * @param {string} [home] overrides os.homedir()
 * @returns {string}
 */
const homeUserDir = (home) => path.join(home || os.homedir(), WORKKIT_DIR);

/**
 * The folder, WORKFLOW_HOME first, as `wk_user_dir` resolves it.
 * @param {string} [home] overrides os.homedir() for the default
 * @returns {string}
 */
const userDir = (home) => process.env.WORKFLOW_HOME || homeUserDir(home);

module.exports = { userDir, homeUserDir };
