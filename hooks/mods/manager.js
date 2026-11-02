/**
 * hooks/mods/manager.js: the manager system's reads: the family a model id
 * belongs to, a crew class by either spelling, and the effective config, the
 * ladder under the merged settings' `manager` block (docs/hooks.md § manager:resolver).
 */

import { isPlain, parseJson } from './settings.js';

const CLASSES = new Set(['scout', 'worker', 'verifier', 'advisor']);

// A ladder as the hook reads it: the parsed file, or its text; anything else,
// or text that does not parse, adds nothing.
const parsed = (layer) => (typeof layer === 'string' ? parseJson(layer) : layer);

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
 * The effective config: the ladder's `classes` and `ladder`, then `mode`,
 * `enabled` and `tiers` from the merged settings' `manager` block (the kit
 * defaults, the machine's file, the repo's: loadSettings in settings.js). A
 * ladder that cannot be read adds nothing; `enabled: false` stays in the
 * result for the readers to honour.
 * @param {object|string|null} ladder the ladder file, parsed or as text
 * @param {object} settings the merged settings (loadSettings)
 * @returns {object}
 */
export function managerConfig(ladder, settings) {
  const global = parsed(ladder);
  const block = isPlain(settings.manager) ? settings.manager : {};
  return { ...(isPlain(global) ? global : {}), mode: block.mode, enabled: block.enabled, tiers: block.tiers };
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
