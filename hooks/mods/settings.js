/**
 * hooks/mods/settings.js: the one settings loader, the kit defaults under the
 * machine's file under the repo's (workflow/README.md § The two settings
 * files), for the mods and the engine's Node scripts alike, and the
 * findings.file, commit.attribution and docs.bullets predicates, the
 * docs.paths and tests.check readers and the route sentence read through it.
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

// The fault of a value set aside at the dotted `key` of `file`.
const keyFault = (file, key) => ({ file, key, line: `${file}: ${key} is not an object, so the value below it stands` });

// Objects merge key by key; a null, absent or non-object value over an object
// leaves the lower one's, so no layer blanks a block of defaults; any other
// value, an array included, replaces it. Each non-null value so set aside is
// pushed on `faults` as `{ file, key, line }`, key the dotted path.
const mergeLayer = (base, over, faults, file, prefix = '') => {
  if (!isPlain(over)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (value === null || value === undefined) continue;
    if (isPlain(out[key])) {
      if (isPlain(value)) out[key] = mergeLayer(out[key], value, faults, file, `${prefix}${key}.`);
      else faults.push(keyFault(file, `${prefix}${key}`));
    } else {
      out[key] = value;
    }
  }
  return out;
};

// A layer file's parse, its fault pushed on `faults`, key null, when its text
// is neither empty nor a JSON object: such a file adds nothing.
const layerOf = (text, file, faults) => {
  const value = parseJson(text);
  if (typeof text === 'string' && text.trim() !== '' && !isPlain(value)) {
    faults.push({ file, key: null, line: `${file} is not a JSON object, so it adds nothing` });
  }
  return value;
};

// The three texts as one view: the kit defaults, the machine file, the repo
// file, each beating the one before; `enabled` is the repo file's alone. The
// faults are every layer and value the merge set aside, in walk order.
const mergedView = ([file, userFile, repoFile], [defaultsText, userText, repoText]) => {
  const defaults = parseJson(defaultsText);
  if (!isPlain(defaults)) {
    throw new Error(`workkit: the kit's settings defaults ${file} ${defaultsText === null ? 'is missing' : 'is not a JSON object'}; reinstall the kit`);
  }
  const faults = [];
  const user = layerOf(userText, userFile, faults);
  const below = mergeLayer(defaults, user, faults, userFile);
  const repo = layerOf(repoText, repoFile, faults);
  const view = mergeLayer(below, repo, faults, repoFile);
  const own = isPlain(repo) ? repo.enabled : undefined;
  return { view: { ...view, enabled: own ?? defaults.enabled }, faults };
};

/**
 * The repo's own settings file at a root, the one spelling the loader reads
 * and its fault lines name.
 * @param {string} root the repo root
 * @returns {string}
 */
export const repoSettingsFile = (root) => `${root}/.workkit/settings.json`;

// The three files read and walked once: mergedView's answer, a promise of it
// when `read` is async.
const walk = (read, { kit, root, user }) => {
  const files = [`${kit}/defaults/settings.json`, user, root ? repoSettingsFile(root) : null];
  const texts = [read(files[0]), read(user), root ? read(files[2]) : null];
  return texts.some((t) => typeof t?.then === 'function')
    ? Promise.all(texts).then((done) => mergedView(files, done))
    : mergedView(files, texts);
};

// `fn` of a walk's answer, a promise of it when the walk is one.
const after = (walked, fn) => (typeof walked?.then === 'function' ? walked.then(fn) : fn(walked));

/**
 * The settings every reader sees: `<kit>/defaults/settings.json`, then the
 * machine's file, then the `.workkit/settings.json` at `root`, merged key by
 * key (docs/project-state.md § The model). A layer that is absent or does not
 * parse adds nothing, the second named by settingsFaults; missing or broken
 * defaults throw, naming the file.
 * @param {function} read a file's text or null, sync (fs) or async (io.read)
 * @param {{kit: string, root: string|null, user: string}} where the kit root,
 *   the repo root (null outside a repo), the machine file's path
 * @returns {object|Promise<object>} the merged view, a promise when `read` is async
 */
export function loadSettings(read, where) {
  return after(walk(read, where), ({ view }) => view);
}

/**
 * What the merge loadSettings makes set aside, one `{ file, key, line }` each:
 * a layer file whose text is neither empty nor a JSON object (key null), and a
 * non-null value that is no object where the layers below hold one (key its
 * dotted path). `line` is the sentence naming it. Missing or broken defaults throw.
 * @param {function} read a file's text or null, sync (fs) or async (io.read)
 * @param {{kit: string, root: string|null, user: string}} where as loadSettings takes it
 * @returns {object[]|Promise<object[]>} the faults, a promise when `read` is async
 */
export function settingsFaults(read, where) {
  return after(walk(read, where), ({ faults }) => faults);
}

/**
 * The settingsFaults faults whose key is `prefix` or under `prefix.`, in order;
 * a whole-file fault has no key, so none of them.
 * @param {object[]} faults settingsFaults' answer
 * @param {string} prefix a dotted key
 * @returns {object[]}
 */
export function faultsUnder(faults, prefix) {
  return faults.filter(({ key }) => key !== null && (key === prefix || key.startsWith(`${prefix}.`)));
}

// The files a mod's io reads its settings from: the machine file the one under the user dir.
const whereOf = (root, env, pluginRoot) => ({ kit: pluginRoot, root, user: `${userDirOf(env)}/settings.json` });

/**
 * The merged settings of a repo root through the hooks' io, the machine file
 * the one under the user dir.
 * @param {string|null} root the repo root, null for none
 * @param {object} env the variables the module read
 * @param {{read: function, pluginRoot: string}} io a file's text, the kit root
 * @returns {Promise<object>}
 */
export async function rootSettings(root, env, { read, pluginRoot }) {
  return loadSettings(read, whereOf(root, env, pluginRoot));
}

/**
 * settingsFaults of a repo root through the hooks' io, as rootSettings reads it.
 * @param {string|null} root the repo root, null for none
 * @param {object} env the variables the module read
 * @param {{read: function, pluginRoot: string}} io a file's text, the kit root
 * @returns {Promise<object[]>}
 */
export async function rootFaults(root, env, { read, pluginRoot }) {
  return settingsFaults(read, whereOf(root, env, pluginRoot));
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
 * Whether commit.attribution is off: on unless a settings file says false
 * (docs/hooks.md § safety:commit-attribution).
 * @param {object} settings the merged view (loadSettings)
 * @returns {boolean}
 */
export function attributionOff(settings) {
  return String(settings.commit?.attribution) === 'false';
}

/**
 * Whether docs.bullets is on: off unless a settings file says true
 * (docs/hooks.md § docs:board-guard).
 * @param {object} settings the merged view (loadSettings)
 * @returns {boolean}
 */
export function bulletsOn(settings) {
  return String(settings.docs?.bullets) === 'true';
}

/**
 * The doc set docs.paths names, the paths from the repo root the markdown
 * shape check judges (docs/hooks.md § docs:board-guard), or null when the
 * value is not an array of strings or an entry can match nothing: one ending
 * in neither `/` nor `.md`, starting with `/`, or holding a backslash.
 * @param {object} settings the merged view (loadSettings)
 * @returns {string[]|null}
 */
export function shapePaths(settings) {
  const paths = settings.docs?.paths;
  const usable = (path) => typeof path === 'string' && (path.endsWith('/') || path.endsWith('.md'))
    && !path.startsWith('/') && !path.includes('\\');
  return Array.isArray(paths) && paths.every(usable) ? paths : null;
}

/**
 * The minutes between a supervised run's checks, tests.check (docs/tests.md
 * § The checks).
 * @param {object} settings the merged view (loadSettings)
 * @returns {number}
 * @throws {Error} when the value is not a finite number above 0, naming it in
 *   its JSON form, or as written when it is a number JSON cannot spell (Infinity)
 */
export function checkMinutes(settings) {
  const minutes = settings.tests?.check;
  if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) return minutes;
  const shown = typeof minutes === 'number' ? String(minutes) : JSON.stringify(minutes);
  throw new Error(`tests.check must be a number of minutes above 0 (got ${shown})`);
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
