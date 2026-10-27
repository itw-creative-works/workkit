/**
 * hooks/mods/turn.js: the turn that just ended, read off the session's
 * transcript: every entry after the last owner prompt. The Stop hooks share
 * it (manager:close-guard, docs:change-tracker).
 */

import { isSystemPrompt } from './frame.js';

// An owner prompt: a user entry with text, carrying no tool results, that
// Claude Code did not deliver itself.
const isOwnerPrompt = (message, isSystem) => message.role === 'user'
  && Boolean(message.text)
  && !(message.toolResults?.length > 0)
  && !isSystem(message.text);

/**
 * The turn's entries: every one after the last owner prompt; none in view is
 * an empty turn.
 * @param {object[]} messages the transcript, the session's SessionMessage rows
 * @param {(text: string) => boolean} [isSystem] the frame test, mods/frame.js's by default
 * @returns {object[]}
 */
export function turnMessages(messages, isSystem = isSystemPrompt) {
  const start = messages.findLastIndex((message) => isOwnerPrompt(message, isSystem));
  return start === -1 ? [] : messages.slice(start + 1);
}
