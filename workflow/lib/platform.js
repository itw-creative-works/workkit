/**
 * workflow/lib/platform.js: the platform reads the kit's Node scripts share:
 * a path's native spelling, the claude home, a folder's or a
 * file's physical path, and whether the kit runs from Claude's plugin cache,
 * where a workkit clone outranks it.
 * Usage: const { nativePath, claudeHome, physicalDir, physicalPath, inPluginCache, cloneOutranks } = require('../lib/platform');
 */

const os = require('os');
const path = require('path');
const { spawnSync } = require('./run');
const { endOf } = require('./say');
const { readJsonOrNull } = require('./read');
const { isDir } = require('./lock');
const { physical } = require('./link');
const { isKitCheckout } = require('./repo');

// Read once at load, as lib/run.js reads it: nativePath's `platform` is the seam.
const PLATFORM = process.platform;

// A path already spelled for Windows: a drive letter and `:` then a separator, or two separators.
const WINDOWS_SPELLED = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/;

/**
 * The native spelling of a path (`wk_native_path`): `D:/a/x`, never `/d/a/x`,
 * the letter case kept. On Windows a path WINDOWS_SPELLED matches only has each
 * `\` made `/`, with no program started; any other goes through `cygpath -m`.
 * Unchanged elsewhere.
 * @param {string} p
 * @param {{ platform?: string }} [context] - the platform the spelling is for
 * @returns {string}
 * @throws {Error} when cygpath fails: an empty key is worse than none
 */
const nativePath = (p, { platform = PLATFORM } = {}) => {
  if (platform !== 'win32') return p;
  if (WINDOWS_SPELLED.test(p)) return p.replace(/\\/g, '/');
  const res = spawnSync('cygpath', ['-m', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  if (res.status !== 0) throw new Error(`nativePath: cygpath -m ${p} ${endOf(res)}`);
  return res.stdout.replace(/[\r\n]+$/, '');
};

/**
 * The claude home, read at the call: WORKFLOW_CLAUDE_HOME (the tests' seam),
 * else `<HOME>/.claude` with HOME as the shell reads it, else `os.homedir()`.
 * @returns {string}
 */
const claudeHome = () => process.env.WORKFLOW_CLAUDE_HOME || `${process.env.HOME || os.homedir()}/.claude`;

/** The physical path of a folder, or null when it is not one. */
const physicalDir = (dir) => {
  const real = physical(dir);
  return real !== null && isDir(real) ? real : null;
};

/**
 * A path's folder resolved through every link, its own name kept as written,
 * so a link to the file itself stays its own path.
 * @param {string} p
 * @returns {string|null} null when the folder does not resolve
 */
const physicalPath = (p) => {
  const dir = physicalDir(path.dirname(p));
  return dir === null ? null : `${dir}/${path.basename(p)}`;
};

/**
 * Whether the kit at `kitDir` is the workkit plugin's copy in Claude's plugin
 * cache: its manifest names workkit and its physical
 * path lies under the physical `<claude home>/plugins/cache/` (`claudeHome`).
 * @param {string} kitDir
 * @returns {boolean}
 */
const inPluginCache = (kitDir) => {
  const kit = physicalDir(kitDir);
  if (!kit || readJsonOrNull(path.join(kit, '.claude-plugin', 'plugin.json'))?.name !== 'workkit') return false;
  const home = physicalDir(claudeHome());
  return Boolean(home) && kit.startsWith(path.join(home, 'plugins', 'cache') + path.sep);
};

/**
 * Whether a clone outranks the cache: the kit is the
 * cached copy and the folder a machine-wide link names is a workkit clone.
 * @param {string} kitDir
 * @param {string} linkedDir
 * @returns {boolean}
 */
const cloneOutranks = (kitDir, linkedDir) => inPluginCache(kitDir) && isKitCheckout(linkedDir || '');

module.exports = {
  nativePath, claudeHome, physicalDir, physicalPath, inPluginCache, cloneOutranks,
};
