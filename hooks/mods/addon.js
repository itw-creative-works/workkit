/**
 * hooks/mods/addon.js: manager:addon's personal add-on, the text of the
 * machine folder's agents/<name>.md stacked onto a `workkit:<name>` spawn
 * (docs/agents.md § Personal add-ons).
 */

/**
 * Where a spawn's add-on lives, or null for a type that is not `workkit:<name>`.
 * @param {string} userDir the machine folder (userDir in ./log.js)
 * @param {string} agentType the spawn's agent type
 * @returns {string|null}
 */
export function addonPath(userDir, agentType) {
  const match = /^workkit:(.+)$/.exec(String(agentType ?? ''));
  return match ? `${userDir}/agents/${match[1]}.md` : null;
}

/**
 * The added context for an add-on's text under its one-line header, or null
 * for a missing or blank file, the normal case.
 * @param {string|null|undefined} text the add-on file's text
 * @param {string} agentType the spawn's agent type
 * @param {string} path the add-on file's path
 * @returns {string|null}
 */
export function addonContext(text, agentType, path) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  return `Personal add-on for ${agentType} (from ${path}):\n${text.replace(/\n+$/, '')}`;
}
