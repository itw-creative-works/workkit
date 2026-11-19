/**
 * hooks/mods/gate.js: the opt-in rule the module's gate applies: a repo opted
 * in when its own .workkit/settings.json parses and its top-level `enabled` is
 * true, the default being false: the engine's wk_opted_in; and the session
 * rule built on it, the engine's wk_session_judges.
 */

import { isPlain, parseJson, repoSettingsFile } from './settings.js';

// The hooks that run in every repo, opted in or not: each speaks to the
// machine (the setup reminder, the restart notice), never to a repo.
const EXEMPT = new Set(['workflow:standards', 'workflow:reload-guard']);

/**
 * Whether a repo's settings text opts it in: true only when it parses and its
 * top-level `enabled` is true; absent, empty, unparsable or keyless text is
 * off, and a nested `enabled` is never read. Only the repo's own file says,
 * never the machine's. The module's one opt-in reader, the engine's wk_opted_in.
 * @param {string|null|undefined} text the settings file's text, null when absent
 * @returns {boolean}
 */
export function settingsOptedIn(text) {
  const settings = parseJson(text);
  return isPlain(settings) && settings.enabled === true;
}

/**
 * Whether a Claude session's checks rule in a repo: CLAUDECODE is `1`,
 * HOOK_DISABLE is not `1`, and the repo's settings text opts it in
 * (settingsOptedIn). The engine's wk_session_judges.
 * @param {object} env the variables the caller read
 * @param {string|null|undefined} settingsText the repo's settings file's text, null when absent
 * @returns {boolean}
 */
export function sessionJudges(env, settingsText) {
  return env.CLAUDECODE === '1' && env.HOOK_DISABLE !== '1' && settingsOptedIn(settingsText);
}

/**
 * Whether the repo at a root opted in: its `.workkit/settings.json` judged by
 * settingsOptedIn.
 * @param {string} root the repo root
 * @param {function} read async, a file's text or null
 * @returns {Promise<boolean>}
 */
export async function rootOptedIn(root, read) {
  return settingsOptedIn(await read(repoSettingsFile(root)));
}

/**
 * Whether a hook runs whatever the repo decided.
 * @param {string} hook the hook as settings name it (`workflow:standards`)
 * @returns {boolean}
 */
export function isExempt(hook) {
  return EXEMPT.has(hook);
}
