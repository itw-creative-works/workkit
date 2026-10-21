/**
 * hooks/mods/feature.js: workflow:feature's instruction, fired by a line about
 * working an issue, once per session after a strong match
 * (docs/hooks.md § workflow:feature).
 */

import { isSystemPrompt } from './frame.js';

// STRONG: `#N` or a whole-word queue phrase (`presume` is not `resume`). WEAK:
// a bare 2 to 4 digits bounded by non-alphanumerics, maybe a port or a year.
const STRONG = /#[0-9]+|(^|[^a-z])(work on|work the|do issue|the issues|next issue|what next|what'?s next|what'?s left|continue|resume|keep going|what now|next one|go now|lets do|let's do|finish up|task list|the queue|the batch|open items|the board)([^a-z]|$)/;
const WEAK = /(^|[^a-z0-9])[0-9]{2,4}([^a-z0-9]|$)/;

const CONTEXT = '[Issue work detected (#374): load the workkit:feature skill before working the issue.]';

/**
 * How strongly a prompt reads as issue work: `strong`, `weak`, or null for no
 * match and for a prompt Claude Code delivered itself.
 * @param {string} prompt the prompt
 * @returns {'strong'|'weak'|null}
 */
export function featureMatch(prompt) {
  if (!prompt || isSystemPrompt(prompt)) return null;
  const lines = String(prompt).replaceAll('’', "'").toLowerCase().split('\n');
  if (lines.some((line) => STRONG.test(line))) return 'strong';
  return lines.some((line) => WEAK.test(line)) ? 'weak' : null;
}

/**
 * The instruction for a prompt, or null for no match, or once a strong match
 * has set the session's marker.
 * @param {string} prompt the prompt
 * @param {boolean|undefined} marker whether a strong match fired this session
 * @returns {string|null}
 */
export function featureContext(prompt, marker) {
  if (marker) return null;
  return featureMatch(prompt) ? CONTEXT : null;
}
