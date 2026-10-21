/**
 * hooks/mods/session-guard.js: docs:session-guard's verdict on a write that
 * leaves `.workkit/agents/session.md` past either cap, judged on the file as
 * written (docs/hooks.md § docs:session-guard).
 */

// The content-line count and its bar are docs:session's too (mods/session.js).
export const MAX_BULLET_CHARS = 350;
export const MAX_CONTENT_LINES = 40;

const BULLET = /^[ \t]*[-*][ \t]/;
const NOT_CONTENT = /^\s*$|^\s*#|^\s*>|^\s*<!--/;

/**
 * A text's rows, a final newline ending the last row rather than opening one.
 * @param {string} text the text
 * @returns {string[]}
 */
export function rowsOf(text) {
  const rows = text === '' ? [] : text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  return rows;
}

const countContent = (rows) => rows.filter((row) => !NOT_CONTENT.test(row)).length;

/**
 * The content lines of a session.md: non-blank, not a heading, a blockquote
 * or an HTML comment, so the seeded template counts zero.
 * @param {string} text the file's text
 * @returns {number}
 */
export function contentLineCount(text) {
  return countContent(rowsOf(text));
}

/**
 * The bounce for an over-cap session.md, or null for any other file and for
 * one inside both caps.
 * @param {string} path the written file's path
 * @param {string|null|undefined} text the file's text, null when it is gone
 * @returns {string|null}
 */
export function sessionGuardVerdict(path, text) {
  // One spelling: a Windows path's backslashes read as slashes, in the bounce too.
  const file = String(path ?? '').replace(/\\/g, '/');
  const parts = file.split('/');
  if (parts.at(-1) !== 'session.md' || parts.at(-2) !== 'agents' || parts.at(-3) !== '.workkit') return null;
  if (typeof text !== 'string') return null;
  const rows = rowsOf(text);
  let problems = '';
  // The first bullet over the cap is enough; the rest surface on the next write.
  const offender = rows.find((row) => BULLET.test(row) && [...row].length > MAX_BULLET_CHARS);
  if (offender) {
    problems += `\n  - a bullet is ${[...offender].length} chars (cap ${MAX_BULLET_CHARS}): ${[...offender].slice(0, 60).join('')}…`;
  }
  const lines = countContent(rows);
  if (lines > MAX_CONTENT_LINES) problems += `\n  - ${lines} content lines (cap ${MAX_CONTENT_LINES}).`;
  if (!problems) return null;
  return `session-guard: ${file} is a queue, not a journal. Prune it before any other work.${problems}\nPromote anything durable to its issue or the CHANGELOG, delete what has already shipped, and split or trim an oversized bullet.`;
}
