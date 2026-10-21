/**
 * hooks/mods/spawn-guard.js: manager:spawn-guard's warning, never a block: a
 * crew spawn carrying a hand-passed model (silent in advise mode, which asks
 * for one), or a frontier session spawning the advisor.
 */

import { DEFAULT_TIERS, crewClass, isAdvise, modelTier } from './manager.js';

/**
 * The warning for a spawn, or null when there is nothing to say.
 * @param {object} config the effective config (managerConfig)
 * @param {string} subagentType the spawn's agent type
 * @param {string|undefined} givenModel the model the spawn was given
 * @param {string|undefined} parentModel the session's model
 * @returns {string|null}
 */
export function spawnGuardWarning(config, subagentType, givenModel, parentModel) {
  const cls = crewClass(subagentType);
  if (!cls || config.enabled === false) return null;
  if (Object.keys(config.ladder ?? {}).length === 0) return null;
  const warnings = [];
  if (givenModel && !isAdvise(config)) {
    warnings.push(`the ${cls} spawn passed model: ${givenModel}. The manager:resolver hook owns crew models; drop the param and let the ladder resolve it.`);
  }
  const frontier = config.tiers?.frontier || DEFAULT_TIERS.frontier;
  const tier = modelTier(parentModel);
  if (cls === 'advisor' && tier && tier === frontier) {
    warnings.push('this session already runs the frontier model: the advisor is redundant here.');
  }
  return warnings.length > 0 ? `manager:spawn-guard: ${warnings.join(' ')}` : null;
}
