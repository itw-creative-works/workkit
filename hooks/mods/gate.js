/**
 * hooks/mods/gate.js: the repo flag's one rule, a settings file's top-level
 * `enabled` as the heal reads it; the opt-in rule the module's gate applies on
 * it; and the session rule built on that, which the gh shim, the git judge and
 * the full-suite hold ask too.
 */

import { isPlain, repoSettingsFile } from './settings.js';

// The hooks that run in every repo, opted in or not: each speaks to the
// machine (the setup reminder, the restart notice), never to a repo.
const EXEMPT = new Set(['workflow:standards', 'workflow:reload-guard']);

/**
 * A settings text's top-level `enabled`, the whole text parsed once: `true` or
 * `false` when it is a boolean; `absent` when the text is blank or `null`, or
 * an object holds no boolean there; `unreadable` when it cannot be read (not a
 * string), does not parse, or holds a value that is not an object.
 * @param {string|null|undefined} text the settings file's text, null when unreadable
 * @returns {'true'|'false'|'absent'|'unreadable'}
 */
export function repoFlag(text) {
  if (typeof text !== 'string') return 'unreadable';
  if (text.trim() === '') return 'absent';
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return 'unreadable';
  }
  if (value === null) return 'absent';
  if (!isPlain(value)) return 'unreadable';
  return typeof value.enabled === 'boolean' ? String(value.enabled) : 'absent';
}

/**
 * Whether a repo's settings text opts it in: its top-level `enabled` is true
 * (repoFlag); anything else is off, and a nested `enabled` is never read. Only
 * the repo's own file says, never the machine's. The module's one opt-in
 * reader.
 * @param {string|null|undefined} text the settings file's text, null when absent
 * @returns {boolean}
 */
export function settingsOptedIn(text) {
  return repoFlag(text) === 'true';
}

/**
 * Whether a Claude session's checks rule in a repo: CLAUDECODE is `1`,
 * HOOK_DISABLE is not `1`, and the repo's settings text opts it in
 * (settingsOptedIn). The one session rule, for the shims and git's hooks too.
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
