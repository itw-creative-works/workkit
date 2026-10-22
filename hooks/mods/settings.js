/**
 * hooks/mods/settings.js: the two workkit settings files a folder reads, the
 * repo's over the machine's (workflow/README.md § The two settings files),
 * the one-key read across them, and the findings.file predicate and route
 * sentence read through it. Plain functions over the parsed files.
 */

import { userDirOf } from './log.js';

/**
 * Text as JSON, null when it is absent or does not parse: the module's one
 * safe parse, settings files and gh's answers alike.
 * @param {string|null} text the file's text
 * @returns {*}
 */
export function parseJson(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Whether a value is a plain object: not null, not an array.
 * @param {*} value the value
 * @returns {boolean}
 */
export const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The two settings files a folder reads, parsed: the `.workkit/settings.json`
 * at its repo's root (none outside a repo) and the machine's
 * `<user dir>/settings.json`; each null when absent or unreadable.
 * @param {string} cwd the folder
 * @param {object} env the variables the module read
 * @param {{top: function, read: function}} io the git root asked from a folder, a file's text
 * @returns {Promise<[object|null, object|null]>} `[repo, user]`, the order settingGet takes
 */
export async function settingsLayers(cwd, env, { top, read }) {
  const root = cwd ? await top(cwd) : null;
  const [repo, user] = await Promise.all([
    root ? read(`${root}/.workkit/settings.json`) : null, read(`${userDirOf(env)}/settings.json`),
  ]);
  return [parseJson(repo), parseJson(user)];
}

/**
 * One key's value: the repo file's when the key is there, else the machine
 * file's, else undefined; a literal false is a value, an empty string none.
 * @param {string} path the key, dotted (`findings.file`)
 * @param {object|null} repo the repo's .workkit/settings.json, parsed
 * @param {object|null} user the machine's ~/.workkit/settings.json, parsed
 * @returns {*}
 */
export function settingGet(path, repo, user) {
  for (const layer of [repo, user]) {
    const value = path.split('.').reduce((at, key) => (at && typeof at === 'object' ? at[key] : undefined), layer);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

/**
 * Whether findings.file is on: off unless a settings file says true
 * (docs/project-state.md § How big is one issue).
 * @param {object|null} repo the repo's settings, parsed
 * @param {object|null} user the machine's settings, parsed
 * @returns {boolean}
 */
export function findingsOn(repo, user) {
  return String(settingGet('findings.file', repo, user)) === 'true';
}

/**
 * The one sentence naming where a finding outside the issue in hand goes: a
 * status:inbox issue while findings.file is on, said in chat under 🧭 Findings
 * for the owner to answer file or drop while it is off.
 * @param {object|null} repo the repo's settings, parsed
 * @param {object|null} user the machine's settings, parsed
 * @returns {string}
 */
export function findingsRoute(repo, user) {
  return findingsOn(repo, user)
    ? 'File a finding as a status:inbox issue with gh instead; where GitHub cannot be reached, put it in chat and let the owner decide.'
    : 'Say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own.';
}
