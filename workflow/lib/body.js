/**
 * workflow/lib/body.js: a detached body's end, CJS: its last line is always
 * `<prefix>: exit <code>`, and a HUP, INT or TERM ends it with the code a
 * shell gives it, once its command has ended. Its traps (endTraps) serve a
 * run under a supervisor too (script-shell.js).
 * Usage: const { bodyEnd, endTraps } = require('./body');
 */

const fs = require('fs');
const { signalCode, END_SIGNALS } = require('./detach');

/**
 * A shell's traps on HUP, INT and TERM: a signal ends nothing at once and
 * aborts `stop`, and `code()` answers the first signal's code (129, 130, 143).
 * @returns {{stop: AbortSignal, code: function(): (number|null)}} `code()` null before any signal
 */
const endTraps = () => {
  const stop = new AbortController();
  let signalled = null;
  for (const signal of END_SIGNALS) {
    process.on(signal, () => {
      if (signalled === null) signalled = signalCode(signal);
      stop.abort();
    });
  }
  return { stop: stop.signal, code: () => signalled };
};

/**
 * Set a body's end. A signal ends nothing at once: the body ends as it would,
 * with the first signal's code (129, 130, 143), so it never ends before its
 * command. The body ends by its exit code, never process.exit(), so its own
 * output reaches stdout before the last line.
 * @param {string} prefix the last line's, `supervise`
 * @param {function} [cleanup] run before the last line
 * @returns {AbortSignal} aborted at the first signal, so a body starts no command after it
 */
const bodyEnd = (prefix, cleanup = () => {}) => {
  const traps = endTraps();
  process.on('exit', (code) => {
    if (traps.code() !== null) process.exitCode = traps.code();
    try {
      cleanup();
    } finally {
      fs.writeSync(1, `${prefix}: exit ${process.exitCode ?? code}\n`);
    }
  });
  return traps.stop;
};

module.exports = { bodyEnd, endTraps };
