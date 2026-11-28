/**
 * workflow/lib/participation.js: what the kit means by its own git hooks
 * folder, for the kit's Node scripts: a kit's folder under any spelling, one
 * spelled as a kit's, and one a kit's or its leftover. The Node half of the
 * `wk_githooks_*` rules in githooks/hook.sh. Also the check a file is
 * there and executable, which those rules use.
 * Usage: const { githooksKit, githooksSpelled, githooksKitlike, gitHooksInstalled, executable } = require('../lib/participation');
 */

const fs = require('fs');
const path = require('path');
const { localConfig } = require('./git');
const { isFile, isDir } = require('./lock');
const { physical } = require('./link');

// A kit's hooks folder, by its physical path's last two parts.
const KIT_HOOKS = /[\\/]workflow[\\/]githooks$/;

/** Whether `file` is there and executable. */
const executable = (file) => {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/**
 * The kit root whose hooks folder `folder` is (`wk_githooks_kit`), a relative
 * folder read against `root` as git reads it: its physical path ends
 * /workflow/githooks and it holds both hooks and judge.js. Null otherwise.
 * @param {string} root
 * @param {string} folder
 * @returns {string|null}
 */
const githooksKit = (root, folder) => {
  if (!folder || !isDir(root)) return null;
  const real = physical(path.resolve(root, folder));
  if (real === null || !isDir(real) || !KIT_HOOKS.test(real)) return null;
  if (!executable(path.join(real, 'pre-commit')) || !executable(path.join(real, 'commit-msg'))) return null;
  return isFile(path.join(real, 'judge.js')) ? path.dirname(path.dirname(real)) : null;
};

/**
 * Whether `folder` is spelled as a kit's hooks folder (`wk_githooks_spelled`):
 * the kit's own path or the engine link's.
 * @param {string} folder
 * @returns {boolean}
 */
const githooksSpelled = (folder) => /\/(workflow|workkit)\/githooks$/.test(folder);

/**
 * Whether `folder` is a kit's (`githooksKit`), or spelled as one and gone: a
 * plugin update's leftover or a dangling link (`wk_githooks_kitlike`). An
 * existing folder of the repo's own that only ends /workflow/githooks is not.
 * @param {string} root
 * @param {string} folder
 * @returns {boolean}
 */
const githooksKitlike = (root, folder) => {
  if (githooksKit(root, folder) !== null) return true;
  if (!githooksSpelled(folder)) return false;
  return !(isDir(root) && fs.existsSync(path.resolve(root, folder)));
};

/** The folder core.hooksPath names in <root> when it is a kit's hooks folder, else null. */
const gitHooksInstalled = (root) => {
  const folder = localConfig(root, ['--path', 'core.hooksPath']);
  return githooksKit(root, folder) === null ? null : folder;
};

module.exports = {
  githooksKit, githooksSpelled, githooksKitlike, gitHooksInstalled, executable,
};
