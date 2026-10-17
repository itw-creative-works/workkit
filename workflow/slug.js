// workflow/slug.js: what a repo is called, for the Node half of the kit.
// The twin of workflow/lib/slug.sh, shape for shape: change one and change the
// other. It requires nothing, so the engine stays self-contained.
// Usage: const { slugFromRemote, splitRepo } = require('./slug');

/**
 * `owner/repo` from a git remote URL, in either form git writes.
 *   git@github.com:owner/repo.git      ssh shorthand
 *   ssh://git@github.com/owner/repo    ssh URL
 *   https://github.com/owner/repo.git  https
 *   C:\Users\x\theirs.git              a local path, as Windows spells one
 * Both separators count: git stores a remote exactly as it was typed.
 * @param {string} url
 * @returns {string|null}
 */
const slugFromRemote = (url) => {
  if (!url) return null;
  const trimmed = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/, '');
  const m = trimmed.match(/[:/\\]([^:/\\]+)[/\\]([^/\\]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
};

/**
 * `owner/name` split into its two parts, or a throw: a repo in any other shape
 * is a caller's bug.
 * @param {string} repo
 * @returns {{owner: string, name: string}}
 */
const splitRepo = (repo) => {
  const m = typeof repo === 'string' && repo.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!m) throw new TypeError(`expected a repo as owner/name, got ${JSON.stringify(repo)}`);
  return { owner: m[1], name: m[2] };
};

module.exports = { slugFromRemote, splitRepo };
