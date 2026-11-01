/**
 * hooks/mods/commit-gate/checks.js: the commit gate's reads of plain text:
 * what a committed path is (docs, a version manifest), the version stamp's
 * JSON compare, and the issues a message closes and names, and a closing line
 * naming more than one. Plain functions; the git and gh reads are the gatherer's.
 */

import { isPlain, parseJson } from '../settings.js';
import { CODE_EXT } from '../test-reminder.js';

// The trailer that closes an issue, read per line off the message.
const TRAILER = /(^|[^A-Za-z0-9])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[ \t\r\f\v]+#[0-9]+/gim;
// A closing trailer whose #N is followed by more bare #M, apart only by spaces, commas or `and`.
const SHARED = new RegExp(`${TRAILER.source}((?:(?:[ \\t,]|\\band\\b)+#[0-9]+\\b)+)`, 'gim');
// A #N glued to a run that opens with a letter, `_`, `.`, `/`, `-`, `&` or `$` is another thing's.
const GLUED = /[A-Za-z_./&$-][A-Za-z0-9_./&$-]*#[0-9]+/g;

/**
 * Whether a committed path reads as docs: under a docs folder unless its
 * extension is code (an executable script there is code), and a docs
 * basename (`*.md`, CHANGELOG, LICENSE) wherever it lives.
 * @param {string} path a repo-relative path
 * @returns {boolean}
 */
export function isDocPath(path) {
  const base = path.split('/').pop();
  if (/\.md$/.test(base) || /^(CHANGELOG|LICENSE)(\..*)?$/.test(base)) return true;
  return /(^|\/)docs\//.test(path) && !CODE_EXT.test(base);
}

/**
 * Whether a path is a version manifest, a package.json, its package-lock.json
 * or a .claude-plugin/plugin.json at any depth, which a version-only bump
 * keeps out of the code a commit carries.
 * @param {string} path a repo-relative path
 * @returns {boolean}
 */
export function isManifest(path) {
  return /(^|\/)package(-lock)?\.json$/.test(path) || /(^|\/)\.claude-plugin\/plugin\.json$/.test(path);
}

// A value as text with every object's keys sorted, so two parses compare whole.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const parsedObject = (text) => {
  const value = parseJson(text);
  return isPlain(value) ? value : null;
};

// `strip` over the object, and over a lockfile's other version spots: each
// local package's entry (the root, a workspace member), never a dependency's.
function stamps(object, strip) {
  const top = strip(object);
  if (object.lockfileVersion === undefined || !isPlain(object.packages)) return top;
  const local = (key, entry) => isPlain(entry) && !key.split('/').includes('node_modules');
  return { ...top, packages: Object.fromEntries(Object.entries(object.packages).map(([key, entry]) => [key, local(key, entry) ? strip(entry) : entry])) };
}

// The object less its version, every dependency pin equal to that version marked as moving with it.
function lockstep(object) {
  const { version = null, ...rest } = object;
  const pinned = canonical(version);
  return Object.fromEntries(Object.entries(rest).map(([key, value]) => {
    if (!/[dD]ependencies$/.test(key) || !value || typeof value !== 'object' || Array.isArray(value)) return [key, value];
    return [key, Object.fromEntries(Object.entries(value).map(([name, pin]) => [name, canonical(pin) === pinned ? '<lockstep>' : pin]))];
  }));
}

/**
 * Whether two texts of one JSON file differ only in `version`, or in it and
 * the exact dependency pins equal to it on each side; in a lockfile, also in
 * each local package entry's. Text that does not parse as an object is a no.
 * Its shell twin is hook_version_only_change in hooks/lib/tree.sh.
 * @param {string} head the file at HEAD
 * @param {string} copy the bytes the commit carries
 * @returns {boolean}
 */
export function versionOnly(head, copy) {
  const a = parsedObject(head);
  const b = parsedObject(copy);
  if (!a || !b) return false;
  const bare = ({ version, ...rest }) => rest;
  const same = (strip) => canonical(stamps(a, strip)) === canonical(stamps(b, strip));
  return same(bare) || same(lockstep);
}

/**
 * Whether the message carries a closing trailer (`Fixes #N`), the one parse
 * closedIssues makes.
 * @param {string} message the commit's message, the text git commits
 * @returns {boolean}
 */
export function closesAny(message) {
  return closedIssues(message).length > 0;
}

/**
 * The issue numbers the message closes, one per closing trailer.
 * @param {string} message the commit's message, the text git commits
 * @returns {number[]}
 */
export function closedIssues(message) {
  return [...message.matchAll(TRAILER)].map((m) => Number(m[0].match(/[0-9]+$/)[0]));
}

/**
 * Every issue the message names as a plain `#N`, ascending and each once; a
 * `#N` glued to a run opening with a letter, `_`, `.`, `/`, `-`, `&` or `$`
 * (owner/repo#N, page#N, &#N, $#) is not one, and digits alone open none.
 * @param {string} message the commit's message, the text git commits
 * @returns {number[]}
 */
export function namedIssues(message) {
  const numbers = [...message.replace(GLUED, '').matchAll(/#([0-9]+)/g)].map((m) => Number(m[1]));
  return [...new Set(numbers)].sort((x, y) => x - y);
}

/**
 * Every closing trailer that names more than one issue on its line
 * (`Fixes #1 #2`, `Fixes #1, #2`, `Fixes #1 and #2`): GitHub closes only the
 * first, and the release tools read it the same way. A number with its own
 * keyword (`Fixes #1, fixes #2`) or after other words is no part of it.
 * @param {string} message the commit's message, the text git commits
 * @returns {{keyword: string, issues: number[]}[]} the keyword as written, every number in order
 */
export function sharedTrailers(message) {
  return [...message.matchAll(SHARED)].map((m) => ({
    keyword: m[2],
    issues: [...m[0].slice(m[1].length).matchAll(/#([0-9]+)/g)].map((n) => Number(n[1])),
  }));
}
