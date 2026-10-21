/**
 * hooks/mods/frame.js: whose words a prompt is, the owner's or Claude Code's
 * own. The dotfiles harness's frame.js is pinned to these three shapes by test.
 */

// An opening tag other than the owner's paste, or a frame line anywhere.
const TAG = /^\s*<[A-Za-z][A-Za-z0-9_.:-]*>/;
const PASTE = /^\s*<pasted_content/;
const FRAME = /\[SYSTEM NOTIFICATION - NOT USER INPUT\]|Another Claude session sent a message|<agent-message |\[Subagent hand-back\]/;

/**
 * Whether Claude Code delivered the prompt itself (a task notification, a
 * subagent hand-back, an agent message) rather than the owner typing it.
 * @param {string} text the prompt
 * @returns {boolean}
 */
export function isSystemPrompt(text) {
  const prompt = String(text ?? '');
  return FRAME.test(prompt) || (TAG.test(prompt) && !PASTE.test(prompt));
}
