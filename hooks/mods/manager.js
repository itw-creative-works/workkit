/**
 * hooks/mods/manager.js: the manager system's reads: the family a model id
 * belongs to, a crew class by either spelling, and the effective config, three
 * layers deep-merged (docs/hooks.md § manager:resolver).
 */

const CLASSES = new Set(['scout', 'worker', 'verifier', 'advisor']);

// The rungs a ladder with no tiers falls back to, as the shell reads default.
export const DEFAULT_TIERS = { frontier: 'fable', workhorse: 'opus' };

export const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A layer as the hook reads it: the parsed file, or its text; anything else,
// or text that does not parse, adds nothing.
export const parsed = (layer) => {
  if (typeof layer !== 'string') return layer;
  try {
    return JSON.parse(layer);
  } catch {
    return undefined;
  }
};

// jq's `*`: objects merge key by key, recursively; any other value replaces.
const deepMerge = (base, over) => {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = isPlain(out[key]) && isPlain(value) ? deepMerge(out[key], value) : value;
  }
  return out;
};

// The overridable slice of a settings file's `manager` block: `mode`,
// `enabled` and the three tiers; `classes` and `ladder` stay global.
const managerLayer = (settings) => {
  const file = parsed(settings);
  if (!isPlain(file)) return {};
  const block = file.manager ?? {};
  if (!isPlain(block)) return {};
  const given = block.tiers ?? {};
  if (!isPlain(given)) return {};
  const tiers = {};
  for (const name of ['frontier', 'workhorse', 'fast']) {
    if (given[name] !== undefined && given[name] !== null) tiers[name] = given[name];
  }
  const layer = {};
  if (block.mode !== undefined && block.mode !== null) layer.mode = block.mode;
  if (block.enabled !== undefined && block.enabled !== null) layer.enabled = block.enabled;
  if (Object.keys(tiers).length > 0) layer.tiers = tiers;
  return layer;
};

/**
 * The family of a model id (`fable`, `opus`, `sonnet`, `haiku`), a context
 * suffix such as `[1m]` ignored.
 * @param {string|undefined} id a model id or alias
 * @returns {string|null} the family, null when unknown
 */
export function modelTier(id) {
  const base = String(id ?? '').split('[')[0].toLowerCase();
  return ['fable', 'opus', 'sonnet', 'haiku'].find((family) => base.includes(family)) ?? null;
}

/**
 * The crew class a subagent type names, bare or `workkit:`-prefixed.
 * @param {string|undefined} subagentType the spawn's agent type
 * @returns {string|null} `scout`, `worker`, `verifier` or `advisor`, else null
 */
export function crewClass(subagentType) {
  const name = String(subagentType ?? '').replace(/^workkit:/, '');
  return CLASSES.has(name) ? name : null;
}

/**
 * The effective config: the ladder, then the user's `manager` block, then the
 * repo's, each beating the one before. A layer that cannot be read adds
 * nothing; `enabled: false` stays in the result for the readers to honour.
 * @param {object|string|null} ladder the ladder file, parsed or as text
 * @param {object|string|null} userSettings the user settings file, parsed or as text
 * @param {object|string|null} repoSettings the repo settings file, parsed or as text
 * @returns {object}
 */
export function managerConfig(ladder, userSettings, repoSettings) {
  const global = parsed(ladder);
  const base = isPlain(global) ? global : {};
  return deepMerge(deepMerge(base, managerLayer(userSettings)), managerLayer(repoSettings));
}

/**
 * A rung's place in the ladder's key order, 0 the strongest.
 * @param {object} config the effective config
 * @param {string} rung the rung's name
 * @returns {number} the place, -1 for a rung the ladder does not carry
 */
export function rungRank(config, rung) {
  const ladder = isPlain(config.ladder) ? config.ladder : {};
  return Object.keys(ladder).indexOf(rung);
}

/**
 * Whether the config reads the advise mode; anything else is rewrite.
 * @param {object} config the effective config
 * @returns {boolean}
 */
export function isAdvise(config) {
  return config.mode === 'advise';
}
