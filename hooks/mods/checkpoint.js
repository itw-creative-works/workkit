/**
 * hooks/mods/checkpoint.js: docs:checkpoint's instruction, fired by a line
 * about compacting, clearing or restarting the chat, a delta after the first
 * fire in a session (docs/hooks.md § docs:checkpoint).
 */

import { isSystemPrompt } from './frame.js';

// `compact` is a substring on purpose (`compaction`, `/compact`); `context`
// fires only beside a follower on the same line, each bounded by a non-letter.
const PATTERN = /compact|clear the chat|clear this chat|new chat|fresh session|start over|context.*(^|[^a-z])(full|low|running out|window)([^a-z]|$)|(running out of|out of|low on) context/;

const FIRST = '[Compaction line detected (#238): run the workkit:checkpoint skill before anything else in this turn, then answer the line. It files every verdict, decision and question from this chat onto its issue and trims session.md, so nothing is lost when the context is compacted.]';

const pad = (n) => String(n).padStart(2, '0');

/**
 * The instruction for a prompt, or null when it is no compaction line or
 * Claude Code delivered it itself.
 * @param {string} prompt the prompt
 * @param {number|string|Date|null|undefined} marker when the instruction was
 *   last issued this session, absent before the first fire
 * @returns {string|null}
 */
export function checkpointContext(prompt, marker) {
  if (!prompt || isSystemPrompt(prompt)) return null;
  // Line by line, as grep reads it, so `context` and its follower share a line.
  if (!String(prompt).toLowerCase().split('\n').some((line) => PATTERN.test(line))) return null;
  if (marker === undefined || marker === null) return FIRST;
  const at = new Date(marker);
  const stamp = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return `[Compaction line detected (#238): the workkit:checkpoint instruction was already issued this session at ${stamp}. Run the skill again only for verdicts, decisions and questions spoken since then, as a delta, then answer the line.]`;
}
