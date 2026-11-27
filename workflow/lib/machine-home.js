/**
 * workflow/lib/machine-home.js: the home, the one reading the command and the
 * jobs share. Its own file, since lib/platform.js reads no hooks/ module
 * (standards.js runs from workflow/ alone) and the command's kit carries no jobs/.
 * Usage: const { machineHome } = require('../lib/machine-home');
 */

const os = require('os');
const { nativePath } = require('./platform');
const { homeOf } = require('../../hooks/mods/log.js');

/**
 * The home: HOME, else USERPROFILE, else the account's home folder, so a start
 * with neither variable still has one; in its native spelling (nativePath), the
 * folder the lines print, so a Git Bash `/c/Users/x` is `C:/Users/x`.
 * @param {object} [env]
 * @param {{ platform?: string }} [context] - the platform the spelling is for, nativePath's seam
 * @returns {string}
 */
const machineHome = (env = process.env, context = {}) => nativePath(homeOf(env) || os.homedir(), context);

module.exports = { machineHome };
