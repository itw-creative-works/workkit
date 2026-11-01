/**
 * hooks/mods/gate.js: the opt-in rule the module's gate applies: a repo opted
 * in when its .workkit/settings.json exists, parses (an empty file is the
 * legacy yes) and its top-level `enabled` is not false: the engine's
 * wk_settings_declined, turned round.
 */

import { parseJson } from './settings.js';

// The hooks that run in every repo, opted in or not: each speaks to the
// machine (the setup reminder, the restart notice), never to a repo.
const EXEMPT = new Set(['workflow:standards', 'workflow:reload-guard']);

/**
 * Whether a repo's settings text opts it in: false when it is absent, does not
 * parse, or its top-level `enabled` is false; a nested `enabled` is never read,
 * and a file with no top-level key, empty text included, is the legacy yes.
 * The module's one opt-in reader, the engine's node read (wk_settings_declined).
 * @param {string|null|undefined} text the settings file's text, null when absent
 * @returns {boolean}
 */
export function settingsOptedIn(text) {
  if (typeof text === 'string' && text.trim() === '') return true;
  const settings = parseJson(text);
  return settings !== null && settings.enabled !== false;
}

/**
 * Whether the repo at a root opted in: its `.workkit/settings.json` judged by
 * settingsOptedIn.
 * @param {string} root the repo root
 * @param {function} read async, a file's text or null
 * @returns {Promise<boolean>}
 */
export async function rootOptedIn(root, read) {
  return settingsOptedIn(await read(`${root}/.workkit/settings.json`));
}

/**
 * Whether a hook runs whatever the repo decided.
 * @param {string} hook the hook as settings name it (`workflow:standards`)
 * @returns {boolean}
 */
export function isExempt(hook) {
  return EXEMPT.has(hook);
}
