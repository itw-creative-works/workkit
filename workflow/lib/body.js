/**
 * workflow/lib/body.js: a detached body's end, CJS: its last line is always
 * `<prefix>: exit <code>`, and a HUP, INT or TERM ends it with the code a
 * shell gives it, once its command has ended. The shell bodies' twin is
 * wk_body_traps in lib/detach.sh.
 * Usage: const { bodyEnd } = require('./body');
 */

const fs = require('fs');
const { signalCode, END_SIGNALS } = require('./detach');

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
  const stop = new AbortController();
  let signalled = null;
  for (const signal of END_SIGNALS) {
    process.on(signal, () => {
      if (signalled === null) signalled = signalCode(signal);
      stop.abort();
    });
  }
  process.on('exit', (code) => {
    if (signalled !== null) process.exitCode = signalled;
    try {
      cleanup();
    } finally {
      fs.writeSync(1, `${prefix}: exit ${process.exitCode ?? code}\n`);
    }
  });
  return stop.signal;
};

module.exports = { bodyEnd };
