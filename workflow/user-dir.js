// workflow/user-dir.js: the machine's own workkit folder, for the engine.
// Beyond Node it requires lib/platform.js alone, so the engine stays self-contained.
// Usage: const { userDir, homeUserDir, towerDir, WORKKIT_DIR } = require('./user-dir');

const os = require('os');
const path = require('path');
const { nativePath } = require('./lib/platform');

// The folder's name, in a home and in every repo alike.
const WORKKIT_DIR = '.workkit';

/**
 * The folder under <home>, WORKFLOW_HOME never read: the roster readers resolve
 * through os.homedir() alone, which is why jobs/morning.js pins WORKFLOW_HOME there.
 * @param {string} [home] overrides os.homedir()
 * @returns {string}
 */
const homeUserDir = (home) => path.join(home || os.homedir(), WORKKIT_DIR);

/**
 * The folder, WORKFLOW_HOME first, else ~/.workkit, the variable
 * read in its native spelling (nativePath), so a Git Bash `/c/...` is `C:/...`.
 * @param {string} [home] overrides os.homedir() for the default
 * @returns {string}
 * @throws {Error} nativePath's, when WORKFLOW_HOME cannot be read
 */
const userDir = (home) => (process.env.WORKFLOW_HOME
  ? nativePath(process.env.WORKFLOW_HOME, { variable: 'WORKFLOW_HOME' })
  : homeUserDir(home));

/**
 * The tower clone, the one git repo in the machine folder.
 * @param {string} [dir] the machine folder, userDir() by default
 * @returns {string}
 */
const towerDir = (dir = userDir()) => path.join(dir, 'tower');

module.exports = { userDir, homeUserDir, towerDir, WORKKIT_DIR };
