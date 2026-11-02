/**
 * hooks/mods/settings.js: the one settings loader, the kit defaults under the
 * machine's file under the repo's (workflow/README.md § The two settings
 * files), for the mods and the engine's Node scripts alike, and the
 * findings.file predicate and route sentence read through it.
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

// Objects merge key by key; a null, absent or non-object value over an object
// leaves the lower one's, so no layer blanks a block of defaults; any other
// value, an array included, replaces it.
const mergeLayer = (base, over) => {
  if (!isPlain(over)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === null || value === undefined) continue;
    if (isPlain(out[key])) {
      if (isPlain(value)) out[key] = mergeLayer(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
};

// The three texts as one view: the kit defaults, the machine file, the repo
// file, each beating the one before; `enabled` is the repo file's alone.
const mergedView = (file, [defaultsText, userText, repoText]) => {
  const defaults = parseJson(defaultsText);
  if (!isPlain(defaults)) {
    throw new Error(`workkit: the kit's settings defaults ${file} ${defaultsText === null ? 'is missing' : 'is not a JSON object'}; reinstall the kit`);
  }
  const repo = parseJson(repoText);
  const view = mergeLayer(mergeLayer(defaults, parseJson(userText)), repo);
  const own = isPlain(repo) ? repo.enabled : undefined;
  return { ...view, enabled: own ?? defaults.enabled };
};

/**
 * The settings every reader sees: `<kit>/defaults/settings.json`, then the
 * machine's file, then the `.workkit/settings.json` at `root`, merged key by
 * key (docs/project-state.md § The model). A layer that is absent or does not
 * parse adds nothing; missing or broken defaults throw, naming the file.
 * @param {function} read a file's text or null, sync (fs) or async (io.read)
 * @param {{kit: string, root: string|null, user: string}} where the kit root,
 *   the repo root (null outside a repo), the machine file's path
 * @returns {object|Promise<object>} the merged view, a promise when `read` is async
 */
export function loadSettings(read, { kit, root, user }) {
  const file = `${kit}/defaults/settings.json`;
  const texts = [read(file), read(user), root ? read(`${root}/.workkit/settings.json`) : null];
  return texts.some((t) => typeof t?.then === 'function')
    ? Promise.all(texts).then((done) => mergedView(file, done))
    : mergedView(file, texts);
}

/**
 * The merged settings of a repo root through the hooks' io, the machine file
 * the one under the user dir.
 * @param {string|null} root the repo root, null for none
 * @param {object} env the variables the module read
 * @param {{read: function, pluginRoot: string}} io a file's text, the kit root
 * @returns {Promise<object>}
 */
export async function rootSettings(root, env, { read, pluginRoot }) {
  return loadSettings(read, { kit: pluginRoot, root, user: `${userDirOf(env)}/settings.json` });
}

/**
 * The merged settings for a folder: rootSettings of the repo holding it.
 * @param {string|null} cwd the folder
 * @param {object} env the variables the module read
 * @param {{top: function, read: function, pluginRoot: string}} io the git root asked from a folder, a file's text, the kit root
 * @returns {Promise<object>}
 */
export async function settingsOf(cwd, env, io) {
  return rootSettings(cwd ? await io.top(cwd) : null, env, io);
}

/**
 * The home repo the merged settings name (`site.repo`), null unless it is an
 * `owner/name` string: the one rule every home-slug reader applies.
 * @param {object} settings the merged view (loadSettings)
 * @returns {string|null}
 */
export function homeSlugOf(settings) {
  const repo = settings.site?.repo;
  return typeof repo === 'string' && repo.includes('/') ? repo : null;
}

/**
 * Whether findings.file is on: off unless a settings file says true
 * (docs/project-state.md § How big is one issue).
 * @param {object} settings the merged view (loadSettings)
 * @returns {boolean}
 */
export function findingsOn(settings) {
  return String(settings.findings?.file) === 'true';
}

/**
 * The one sentence naming where a finding outside the issue in hand goes: a
 * status:inbox issue while findings.file is on, said in chat under 🧭 Findings
 * for the owner to answer file or drop while it is off.
 * @param {object} settings the merged view (loadSettings)
 * @returns {string}
 */
export function findingsRoute(settings) {
  return findingsOn(settings)
    ? 'File a finding as a status:inbox issue with gh instead; where GitHub cannot be reached, put it in chat and let the owner decide.'
    : 'Say findings in chat under 🧭 Findings instead, one bullet each, for the owner to answer file or drop; file nothing on your own.';
}
