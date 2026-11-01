/**
 * hooks/mods/optin.js: the repo a Bash command acts on and whether it opted
 * in: the command's cd steps and the cwd decide, and a command the walk
 * cannot place runs the guards, so a guard fails closed (docs/hooks.md
 * § Where every hook stands down). The roster's one reader, a folder's origin
 * slug and the folder a gh journal line's call acted on live here too.
 */

import {
  GIT_VALUE_FLAGS, PLACEHOLDER, cdStep, count, foldRedirectAmp, isGitWord, isInterpreter, namesDirChange, peelPrefixes,
  slugFromRemote, stepDirs, stripHeredocs, stripQuotes,
} from './command.js';
import { settingsOptedIn } from './gate.js';
import { userDirOf } from './log.js';
import { parseJson } from './settings.js';

const MAY_MOVE = /(^|[^A-Za-z0-9_.-])eval([^A-Za-z0-9_.-]|$)|[ \t\n\r\f\v]-[A-Za-z]*[cC]|--git-dir|--work-tree|GIT_DIR=|GIT_WORK_TREE=|CDPATH=/;
const MOVES_BY_ENV = /(^|[^A-Za-z0-9_])(GIT_DIR|GIT_WORK_TREE|CDPATH)=/;

/**
 * Whether a folder is absolute: `/`-led, or a drive letter and `/`.
 * @param {string} path the folder
 * @returns {boolean}
 */
const isAbsolute = (path) => path.startsWith('/') || /^[A-Za-z]:\//.test(path);

// The cheap test sparing most commands the walk: could the text move its
// folder or repo? An empty quote pair is dropped first, as the shell drops it.
function mayMove(text) {
  const t = text.split("''").join('').split('""').join('');
  return namesDirChange(t) || MAY_MOVE.test(t);
}

// Does the quote-stripped step move its target where the cd walk cannot
// follow: a quoted command word, eval, an interpreter's -c string, or git's
// -C, --git-dir or --work-tree?
function moves(words, peel) {
  if (peel.isEval || peel.word.includes(PLACEHOLDER)) return true;
  const args = words.slice(peel.skip + 1);
  if (isInterpreter(peel.word)) {
    for (const a of args) {
      if (a.startsWith('--') || a.includes('>') || a.includes('<')) continue;
      if (a[0] === '-') {
        if (a.includes('c')) return true;
        continue;
      }
      return false;
    }
    return false;
  }
  if (!isGitWord(peel.word)) return false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (/^-C|^--git-dir(=|$)|^--work-tree(=|$)/.test(a)) return true;
    if (GIT_VALUE_FLAGS.has(a)) i += 1;
    else if (a[0] !== '-' && !a.includes('>') && !a.includes('<')) return false;
  }
  return false;
}

/**
 * A path with its `.` and `..` folded away by text, as the shell's own cd
 * folds them, backslashes read as `/` and a drive letter kept.
 * @param {string} path the path
 * @returns {string}
 */
function fold(path) {
  let p = path.replace(/\\/g, '/');
  if (!/\/\.\.?(\/|$)/.test(p)) return p;
  let head = '';
  if (/^[A-Za-z]:\//.test(p)) {
    head = p.slice(0, p.indexOf('/'));
    p = p.slice(p.indexOf('/') + 1);
  }
  let out = '';
  for (const part of p.split('/')) {
    if (part === '..') out = out.slice(0, Math.max(out.lastIndexOf('/'), 0));
    else if (part !== '' && part !== '.') out = `${out}/${part}`;
  }
  return `${head}${out || '/'}`;
}

// Every folder a cd step lands in; null when the command moves its target in
// a way the walk cannot follow.
function walk(text, cwd) {
  let s = stripQuotes(text);
  if (mayMove(text) && (text.includes('`') || count(text, '$(') !== count(s, '$('))) return null;
  s = foldRedirectAmp(s);
  if (MOVES_BY_ENV.test(s)) return null;
  const dirs = [];
  for (const { dir, text: step } of stepDirs(s)) {
    const words = step.split(/[ \t]+/).filter(Boolean);
    if (moves(words, peelPrefixes(words))) return null;
    if (!namesDirChange(step)) continue;
    const landed = cdStep(dir, step);
    if (landed === '?' || landed.includes(PLACEHOLDER)) return null;
    if (!isAbsolute(landed) && !cwd) return null;
    dirs.push(fold(isAbsolute(landed) ? landed : `${cwd}/${landed}`));
  }
  return dirs;
}

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

// The root of the repo holding each folder, each root once.
async function rootsOf(dirs, toplevel, exists) {
  const roots = [];
  for (const dir of dirs) {
    const root = dir ? await rootOf(dir, toplevel, exists) : null;
    if (root && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

// The roots the command acts on, null when it cannot be placed.
async function bashRoots({ command, cwd, toplevel, exists }) {
  if (!mayMove(command)) return rootsOf([cwd], toplevel, exists);
  const text = stripHeredocs(command);
  if (!mayMove(text)) return rootsOf([cwd], toplevel, exists);
  const walked = walk(text, cwd);
  if (walked === null) return null;
  return rootsOf([cwd, ...walked], toplevel, exists);
}

/**
 * The repo a Bash command acts on and whether it opted in: the cwd and each
 * folder a cd step lands in. Any of them opted in is a yes; so is a command
 * the walk cannot place.
 * @param {{command: string, cwd: string, toplevel: function, settingsOf: function, exists: function}} facts
 *   the command, its folder, and async reads: a folder's git root, a root's
 *   `.workkit/settings.json` text (null when absent), judged by
 *   settingsOptedIn, whether a path is there
 * @returns {Promise<{root: string|null, opted: boolean}>} the first opted-in
 *   root, else the first root (null when none or unplaced), and the answer
 */
export async function optinRepo(facts) {
  const roots = await bashRoots(facts);
  if (roots === null) return { root: null, opted: true };
  for (const root of roots) {
    if (settingsOptedIn(await facts.settingsOf(root))) return { root, opted: true };
  }
  return { root: roots[0] ?? null, opted: false };
}
