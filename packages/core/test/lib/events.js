/**
 * The event line a case that runs inside another program (a page, a service
 * worker, an Electron process) reports its result by: EVENT_PREFIX, then one
 * JSON object `{ id, name, status, durationMs, reason?, error? }`, on one line.
 * `eventLine` is the app side, `parseEventLine` the host's.
 */

// The text every event line starts with.
export const EVENT_PREFIX = '__WORKKIT_TEST__';

const STATUSES = ['passed', 'failed', 'skipped'];

/**
 * The line for <event>, with no line break in it whatever its text holds:
 * JSON escapes `\n` and `\r`, and the line and paragraph separators (U+2028,
 * U+2029) a JavaScript reader may break on are escaped too. It reads nothing
 * outside its own body, so a host sends `eventLine.toString()` into any realm
 * and calls it there; the prefix is spelled here again for that, and the
 * round trip through `parseEventLine` keeps the two equal.
 * @param {{id: string, name: string, status: string, durationMs: number, reason?: string, error?: {message: string, stack?: string}}} event
 * @returns {string}
 */
export const eventLine = (event) => `__WORKKIT_TEST__${JSON.stringify(event).replace(
  // A tool that turns the escape of U+2028 into the raw character makes a regex
  // literal a syntax error, so the two characters are built from their codes.
  new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g'),
  (char) => `\\u${char.charCodeAt(0).toString(16)}`,
)}`;

// Whether <value> is an event the host can settle a case by: an id, a known
// status, and with `failed` an error carrying its message.
const isEvent = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && typeof value.id === 'string'
  && value.id !== ''
  && STATUSES.includes(value.status)
  && (value.status !== 'failed' || (value.error !== null && typeof value.error === 'object' && typeof value.error.message === 'string'));

/**
 * The event <line> carries, or null for a line without the prefix (the
 * program's ordinary output). A line with the prefix that is no valid event
 * throws `not a valid event line: <line>`.
 * @param {string} line
 * @returns {object|null}
 */
export const parseEventLine = (line) => {
  if (!line.startsWith(EVENT_PREFIX)) return null;
  let event;
  try {
    event = JSON.parse(line.slice(EVENT_PREFIX.length));
  } catch {
    event = null;
  }
  if (!isEvent(event)) throw new Error(`not a valid event line: ${line}`);
  return event;
};
