// workflow/lib/git.js: the git reads the kit's Node scripts share, so a lookup
// has one spelling and every caller keeps its own reaction to a miss.
// Usage: const { repoRoot, headSha } = require('../lib/git');

const { spawnSync } = require('child_process');

/**
 * The git top level of `cwd`, or null outside a repo or for a folder that is
 * not there (git does not start in it).
 * @param {string} cwd
 * @returns {string|null}
 */
const repoRoot = (cwd) => {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? res.stdout.trim() : null;
};

/**
 * The full sha of HEAD in `cwd`'s repo, or null outside a repo or in one with
 * no commit yet.
 * @param {string} cwd
 * @returns {string|null}
 */
const headSha = (cwd) => {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return res.status === 0 ? res.stdout.trim() : null;
};

module.exports = { repoRoot, headSha };
