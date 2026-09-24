//
// workflow/slug.js: what a repo is CALLED, for the Node half of the kit.
//
// The twin of workflow/slug.sh beside it, shape for shape: the same trims in
// the same order and the same regex, so the shell and Node can never disagree
// about what a repo is called. Change one and change the other.
//
// Its own file for the reason the shell seam has one: three callers want the
// answer and none of them owns it (the tower's roster, the morning brief's
// composer through it, and the CHANGELOG link filler), and a parse copied into
// any of them is the drift the one home was built to end. It requires nothing,
// so the engine stays as self-contained as workflow/README.md promises.
//
// Usage:
//   const { slugFromRemote } = require('./slug');
//

/**
 * `owner/repo` from a git remote URL, in either form git writes.
 *   git@github.com:owner/repo.git      ssh shorthand
 *   ssh://git@github.com/owner/repo    ssh URL
 *   https://github.com/owner/repo.git  https
 *   C:\Users\x\theirs.git              a local path, as Windows spells one
 *
 * Both separators count: git stores a remote exactly as it was given, so a
 * path typed natively on Windows comes back with backslashes. The trims and
 * the regex are `wk_slug_from_remote` in workflow/slug.sh, shape for shape, so
 * the two never disagree: the whitespace around the URL, then EVERY trailing
 * separator, then the `.git` a path that ended in one is still wearing.
 * @param {string} url
 * @returns {string|null}
 */
const slugFromRemote = (url) => {
  if (!url) return null;
  const trimmed = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/, '');
  const m = trimmed.match(/[:/\\]([^:/\\]+)[/\\]([^/\\]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
};

module.exports = { slugFromRemote };
