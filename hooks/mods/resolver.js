/**
 * hooks/mods/resolver.js: manager:resolver's decision, the model a crew spawn
 * runs on, from the ladder and the session's own model
 * (docs/hooks.md § manager:resolver).
 */

import { crewClass, isAdvise, modelTier, rungRank } from './manager.js';

/**
 * The model the spawn must run on, or null when nothing changes: a type that
 * is no crew class, `enabled: false`, a rung the ladder lacks, a given model in
 * rewrite mode (the manager's deliberate override), or in advise mode a given
 * model that already matches. A worker or verifier never runs a stronger rung
 * than the session's own.
 * @param {object} config the effective config (managerConfig)
 * @param {string} subagentType the spawn's agent type
 * @param {string|undefined} parentModel the session's model
 * @param {string|undefined} givenModel the model the spawn was given
 * @returns {string|null}
 */
export function resolverModel(config, subagentType, parentModel, givenModel) {
  const cls = crewClass(subagentType);
  if (!cls || config.enabled === false) return null;
  if (!isAdvise(config) && givenModel) return null;
  let rung = config.tiers?.[config.classes?.[cls]];
  if (!rung || rungRank(config, rung) < 0) return null;
  const sessionTier = modelTier(parentModel);
  if ((cls === 'worker' || cls === 'verifier') && sessionTier
    && rungRank(config, sessionTier) > rungRank(config, rung)) {
    rung = sessionTier;
  }
  const model = config.ladder[rung];
  if (!model) return null;
  if (isAdvise(config) && givenModel === model) return null;
  return model;
}

/**
 * The advise mode's refusal, naming the model to re-issue the spawn with.
 * @param {string} subagentType the spawn's agent type
 * @param {string} model the model resolverModel answered
 * @returns {string}
 */
export function resolverAdvice(subagentType, model) {
  const cls = crewClass(subagentType) ?? subagentType;
  return `manager:resolver: ${cls} runs on ${model} for this session. Re-issue the Agent call with model: ${model}`;
}
