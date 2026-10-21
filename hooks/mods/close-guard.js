/**
 * hooks/mods/close-guard.js: manager:close-guard's warning, never a block,
 * over the turn that just ended: rule 3, a frontier session making the edits
 * itself with no worker; rule 4, a worker spawned with no verifier
 * (docs/hooks.md § manager:close-guard).
 */

import { isSystemPrompt } from './frame.js';
import { DEFAULT_TIERS, modelTier } from './manager.js';

const DEFAULT_CLOSE_EDITS = 5;
const EDITS = new Set(['Edit', 'Write']);
const SPAWNS = new Set(['Task', 'Agent']);

// An owner prompt: a user entry with text, carrying no tool results, that
// Claude Code did not deliver itself.
const isOwnerPrompt = (message, isSystemPrompt) => message.role === 'user'
  && Boolean(message.text)
  && !(message.toolResults?.length > 0)
  && !isSystemPrompt(message.text);

/**
 * The turn's counts: every entry after the last owner prompt; none in view is
 * an empty turn.
 * @param {object[]} messages the transcript, the session's SessionMessage rows
 * @param {(text: string) => boolean} isSystemPrompt the frame test (mods/frame.js)
 * @returns {{edits: number, workers: number, verifiers: number}}
 */
export function turnFacts(messages, isSystemPrompt) {
  const facts = { edits: 0, workers: 0, verifiers: 0 };
  const start = messages.findLastIndex((message) => isOwnerPrompt(message, isSystemPrompt));
  if (start === -1) return facts;
  for (const message of messages.slice(start + 1)) {
    for (const use of message.toolUses ?? []) {
      if (EDITS.has(use.tool)) facts.edits += 1;
      if (!SPAWNS.has(use.tool)) continue;
      const type = String(use.input?.subagent_type ?? '?').replace(/^workkit:/, '');
      if (type === 'worker') facts.workers += 1;
      if (type === 'verifier') facts.verifiers += 1;
    }
  }
  return facts;
}

/**
 * The warning for a turn, or null when there is nothing to say.
 * @param {{edits: number, workers: number, verifiers: number}} facts the turn's counts (turnFacts)
 * @param {object} options the session's reading
 * @param {string|null} options.tier the session model's family (modelTier)
 * @param {string} [options.frontier] the frontier rung, `fable` when unset
 * @param {number|string} [options.closeEdits] MANAGER_CLOSE_EDITS; anything but digits reads 5
 * @returns {string|null}
 */
export function closeGuardWarning(facts, { tier, frontier, closeEdits }) {
  const bar = /^\d+$/.test(String(closeEdits ?? '')) ? Number(closeEdits) : DEFAULT_CLOSE_EDITS;
  const warnings = [];
  if (tier && tier === (frontier || DEFAULT_TIERS.frontier) && facts.edits >= bar && facts.workers === 0) {
    warnings.push(`the frontier model made ${facts.edits} edits itself this turn with no worker spawn: implementation belongs with workkit:worker`);
  }
  if (facts.workers >= 1 && facts.verifiers === 0) {
    warnings.push(`${facts.workers} worker spawn(s) this turn and no verifier: consider a verifier pass over the build`);
  }
  return warnings.length > 0 ? `manager:close-guard: ${warnings.join('; ')}.` : null;
}

/**
 * The hook: the turn read from the session and its warning logged, never a
 * block or a context. A stop already continuing for a Stop hook was judged once.
 * @param {object} io the engine calls as plain functions: `config(cwd)` (the
 *   effective manager config), `model()`, `messages()`, `log(text)`
 * @param {object} env the variables the module read, for MANAGER_CLOSE_EDITS
 * @param {object} e the Stop input
 * @returns {Promise<void>}
 */
export async function closeGuardGather(io, env, e) {
  if (e.stop_hook_active) return;
  const config = await io.config(e.cwd);
  if (config.enabled === false) return;
  const [model, messages] = await Promise.all([io.model(), io.messages()]);
  const facts = turnFacts(messages, isSystemPrompt);
  const warning = closeGuardWarning(facts, { tier: modelTier(model), frontier: config.tiers?.frontier, closeEdits: env.MANAGER_CLOSE_EDITS });
  if (warning) io.log(warning);
}
