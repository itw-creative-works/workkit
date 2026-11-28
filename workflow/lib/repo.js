/**
 * workflow/lib/repo.js: what a repo is, for the kit's Node scripts: its origin
 * slug, whether it is a clone of the kit itself, and whether its package.json
 * takes the kit's test runner.
 * Usage: const { repoSlug, isKitCheckout, hasCorePackage } = require('../lib/repo');
 */

const path = require('path');
const { gitIn } = require('./git');
const { readJsonOrNull } = require('./read');
const { slugFromRemote } = require('../slug');

// A workkit repo under any owner, any letter case.
const KIT_SLUG = /^[^/]+\/workkit$/i;

/**
 * The origin slug of the git working tree at `dir`, `''` when
 * it has none.
 * @param {string} [dir] the cwd by default
 * @returns {string}
 */
const repoSlug = (dir = '.') => {
  const res = gitIn(dir, ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? slugFromRemote(res.stdout) ?? '' : '';
};

/**
 * Whether `dir` lies in a git working tree whose origin names the workkit repo:
 * a clone of the kit itself.
 * @param {string} dir
 * @returns {boolean}
 */
const isKitCheckout = (dir) => Boolean(dir) && KIT_SLUG.test(repoSlug(dir));

/**
 * Whether `<dir>/package.json` names workkit-core, the kit's test runner, in
 * its devDependencies; an absent or null devDependencies is none.
 * @param {string} [dir] the cwd by default
 * @returns {boolean}
 */
const hasCorePackage = (dir = '.') => {
  // At the call, not at load: this file must load with no hooks/ beside it.
  const { isPlain } = require('../../hooks/mods/settings.js');
  const pkg = readJsonOrNull(path.join(dir, 'package.json'));
  if (!isPlain(pkg)) return false;
  const dev = pkg.devDependencies ?? {};
  return isPlain(dev) && Object.hasOwn(dev, 'workkit-core');
};

module.exports = { repoSlug, isKitCheckout, hasCorePackage };
