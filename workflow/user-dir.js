// workflow/user-dir.js: the machine's own workkit folder, for the Node half of
// the kit. The twin of `wk_user_dir` in lib/platform.sh: change one and change
// the other. It requires nothing beyond Node, so the engine stays self-contained.
// Usage: const { userDir, homeUserDir, towerDir, WORKKIT_DIR } = require('./user-dir');

const os = require('os');
const path = require('path');

// The folder's name, in a home and in every repo alike.
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

/**
 * The tower clone, the one git repo in the machine folder (`wk_tower_dir`).
 * @param {string} [dir] the machine folder, userDir() by default
 * @returns {string}
 */
const towerDir = (dir = userDir()) => path.join(dir, 'tower');

module.exports = { userDir, homeUserDir, towerDir, WORKKIT_DIR };
