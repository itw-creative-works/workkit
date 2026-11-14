/**
 * hooks/mods/optin.js: the roster's one reader, a folder's origin slug, a
 * file's path from its repo root, the root of the repo holding a folder, and
 * the folder a gh journal line's call acted on.
 */

import { userDirOf } from './log.js';
import { parseJson } from './settings.js';
import { slugFromRemote } from './slug.js';

/**
 * This machine's roster, `<user dir>/.repos.json`, parsed; null when absent
 * or unreadable.
 * @param {object} env the variables the module read
 * @param {function} read async, a file's text or null
 * @returns {Promise<object|null>}
 */
export async function rosterOf(env, read) {
  return parseJson(await read(`${userDirOf(env)}/.repos.json`));
}

/**
 * The rostered folder whose origin is `slug`, any letter case, enabled
 * entries only (wk_roster_path).
 * @param {string} slug the repo, owner/name
 * @param {object|null} roster the parsed roster (rosterOf)
 * @param {function} slugOf async, a folder's origin slug
 * @returns {Promise<string|null>}
 */
export async function rosterPath(slug, roster, slugOf) {
  const want = slug.toLowerCase();
  for (const [path, state] of Object.entries(roster?.repos ?? {})) {
    if (state === 'enabled' && String((await slugOf(path)) ?? '').toLowerCase() === want) return path;
  }
  return null;
}

/**
 * Whether the repo value names the session tree's origin, owner/name in any
 * letter case. No origin is never here.
 * @param {string} repo the repo named, owner/name
 * @param {string} here the session tree's origin slug, '' when it has none
 * @returns {boolean}
 */
export function ghRepoIsHere(repo, here) {
  return Boolean(here) && repo.toLowerCase() === here.toLowerCase();
}

/**
 * The origin slug of the git working tree at `dir`, '' when it has none (the
 * engine's rule: wk_repo_slug).
 * @param {string} dir the folder
 * @param {function} run runs `(argv, { cwd })`, resolving `{ exitCode, stdout }`
 * @returns {Promise<string>}
 */
export async function repoSlug(dir, run) {
  const remote = await run(['git', 'remote', 'get-url', 'origin'], { cwd: dir });
  return remote.exitCode === 0 ? slugFromRemote(remote.stdout) ?? '' : '';
}

/**
 * Whether `cwd` is inside a git work tree with no origin: a scratch or fixture
 * repo, outside the pipeline. An empty cwd, or one in no repo, is not.
 * @param {string} cwd the folder
 * @param {function} run runs `(argv, { cwd })`, resolving `{ exitCode, stdout }`
 * @returns {Promise<boolean>}
 */
export async function originless(cwd, run) {
  if (!cwd) return false;
  const inside = await run(['git', 'rev-parse', '--is-inside-work-tree'], { cwd });
  return inside.exitCode === 0 && (await repoSlug(cwd, run)) === '';
}

/**
 * A file's path from its repo root, through git's show-prefix run in its
 * folder, or null outside a repo.
 * @param {string} dir the file's folder
 * @param {function} run runs `(argv, { cwd })`, resolving `{ exitCode, stdout }`
 * @param {string} name the file's name
 * @returns {Promise<string|null>}
 */
export async function repoPathOf(dir, run, name) {
  const prefix = await run(['git', 'rev-parse', '--show-prefix'], { cwd: dir });
  return prefix.exitCode === 0 ? `${prefix.stdout.trim()}${name}` : null;
}

/**
 * The folder a gh journal line's call acted on and the repo it named: the
 * call's own folder when the repo is that folder's origin (or none), else the
 * repo's folder on this machine's roster, or a note, worded for
 * workflow:snapshot, when the roster holds none; workflow:public-mirror reads
 * the folder alone.
 * @param {{dir: string, repo: string}} call the call's folder and the repo the shim resolved, '' for none
 * @param {{roster: object|null, slugOf: function}} facts the roster (rosterOf) and `slugOf(dir)` async
 * @returns {Promise<{dir: string, repo: string}|{note: string}>}
 */
export async function placeLine({ dir, repo }, { roster, slugOf }) {
  if (!repo || ghRepoIsHere(repo, String((await slugOf(dir)) ?? ''))) return { dir, repo };
  const folder = await rosterPath(repo, roster, slugOf);
  if (!folder) return { note: `${repo} is not opted in on this machine's workkit roster (absent or declined), so no snapshot was taken or dropped for it.` };
  return { dir: folder, repo };
}

/**
 * The root of the repo holding a folder, asked from the folder itself or, when
 * git cannot answer there, from the folder holding `.git` for a path inside it
 * and the nearest existing folder for one not made yet, as the shell climbs.
 * @param {string} dir the folder
 * @param {function} toplevel async, the git root asked from a folder, or null
 * @param {function} [exists] async, whether a path is there; absent, no climb
 * @returns {Promise<string|null>}
 */
export async function rootOf(dir, toplevel, exists) {
  const root = await toplevel(dir);
  if (root || !exists) return root;
  const inGit = dir.search(/\/\.git(\/|$)/);
  let at = inGit === -1 ? dir : dir.slice(0, inGit) || '/';
  while (!(await exists(at)) && at !== '/' && at.includes('/')) at = at.slice(0, at.lastIndexOf('/')) || '/';
  return at === dir ? null : toplevel(at);
}
