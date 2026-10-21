/**
 * hooks/mods/gate.js: the opt-in rule the module's gate applies, the same as
 * hook_repo_opted_in in hooks/lib/optin.sh: a repo opted in when its
 * .workkit/settings.json exists and does not hold `"enabled": false`.
 */

// The hooks that run in every repo, opted in or not: each speaks to the
// machine (the setup reminder, the restart notice), never to a repo.
const EXEMPT = new Set(['workflow:standards', 'workflow:reload-guard']);

/**
 * Whether a repo's settings text opts it in; a file with no `enabled` key is
 * the legacy yes, so a declined file is the only no.
 * @param {string|null|undefined} text the settings file's text, null when absent
 * @returns {boolean}
 */
export function settingsOptedIn(text) {
  if (typeof text !== 'string') return false;
  return !/"enabled"[^\S\n]*:[^\S\n]*false/.test(text);
}

/**
 * Whether a hook runs whatever the repo decided.
 * @param {string} hook the hook as settings name it (`workflow:standards`)
 * @returns {boolean}
 */
export function isExempt(hook) {
  return EXEMPT.has(hook);
}
