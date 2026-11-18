// workflow/lib/git.js: the git reads the kit's Node scripts share, so a lookup
// has one spelling and every caller keeps its own reaction to a miss.
// Usage: const { repoRoot, headSha, gitIn } = require('../lib/git');

const { spawnSync } = require('./run');

// The most output one git read keeps, ample for a repo's whole path list.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * git run in `root` (`git -C <root> <args>`), as spawnSync answers, its output
 * kept up to GIT_MAX_BUFFER; each caller passes its own stdio, encoding and env.
 * @param {string} root
 * @param {string[]} args
 * @param {object} [options] spawnSync's options
 * @returns {object} spawnSync's result
 */
const gitIn = (root, args, options = {}) => spawnSync('git', ['-C', root, ...args], {
  maxBuffer: GIT_MAX_BUFFER, windowsHide: true, ...options,
});

/**
 * The git top level of `cwd`, or null outside a repo or for a folder that is
 * not there (git does not start in it).
 * @param {string} cwd
 * @returns {string|null}
 */
const repoRoot = (cwd) => {
  const res = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  return res.status === 0 ? res.stdout.trim() : null;
};

/**
 * The full sha of HEAD in `cwd`'s repo, or null outside a repo or in one with
 * no commit yet.
 * @param {string} cwd
 * @returns {string|null}
 */
const headSha = (cwd) => {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  });
  return res.status === 0 ? res.stdout.trim() : null;
};

module.exports = {
  repoRoot, headSha, gitIn, GIT_MAX_BUFFER,
};
