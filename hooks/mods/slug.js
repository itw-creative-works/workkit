/**
 * hooks/mods/slug.js: what a repo is called, for the hooks module. The
 * module's copy of slugFromRemote in workflow/slug.js and wk_slug_from_remote
 * in workflow/lib/slug.sh, shape for shape, since a hooks module cannot import
 * CommonJS: change all three together.
 */

/**
 * `owner/repo` from a git remote URL or a local path in either separator,
 * null when it names none.
 * @param {string} url the remote
 * @returns {string|null}
 */
export function slugFromRemote(url) {
  if (!url) return null;
  const trimmed = url.trim().replace(/[/\\]+$/, '').replace(/\.git$/, '');
  const m = trimmed.match(/[:/\\]([^:/\\]+)[/\\]([^/\\]+)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}
