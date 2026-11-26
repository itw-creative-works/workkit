// workflow/lib/say.js: the one-line stderr writer the kit's Node commands share,
// its stdout twin, and how a child process ended or why it failed, phrased for such a line.
// Usage: const { sayAs, writeErr, writeOut, endOf, errLine, lastErrLine } = require('../lib/say');

const fs = require('fs');
const { pause } = require('./pause');

// How long a write that found stderr's pipe full waits before it tries again.
const FULL_PIPE_WAIT_S = 0.01;

/**
 * Write text to a descriptor whole, straight to the fd so it lands before a
 * child's output that follows it. A full pipe that is not blocking (EAGAIN) is
 * waited on and the write goes on from the byte it reached; any other error throws.
 * @param {number} fd - the descriptor
 * @param {string|Buffer} text - what to write, as it is
 */
const writeFd = (fd, text) => {
  const bytes = Buffer.from(text);
  let at = 0;
  while (at < bytes.length) {
    try {
      at += fs.writeSync(fd, bytes, at);
    } catch (err) {
      if (err.code !== 'EAGAIN') throw err;
      pause(FULL_PIPE_WAIT_S);
    }
  }
};

/**
 * Write text to stderr whole (`writeFd` on 2).
 * @param {string|Buffer} text - what to write, as it is
 */
const writeErr = (text) => writeFd(2, text);

/**
 * Write text to stdout whole (`writeFd` on 1), stderr's twin.
 * @param {string|Buffer} text - what to write, as it is
 */
const writeOut = (text) => writeFd(1, text);

/**
 * A writer of `<prefix>: <text>` lines on stderr through `writeErr`; stdout stays
 * the command's own.
 * @param {string} prefix - the line prefix, without its colon
 * @returns {(text: string) => void}
 */
const sayAs = (prefix) => (text) => writeErr(`${prefix}: ${text}\n`);

/**
 * How a `spawnSync` child ended: `exited <code>`, `did not finish (<signal>)`,
 * or `could not be run, <error code>` when it never started.
 * @param {object} res - the `spawnSync` result
 * @returns {string}
 */
const endOf = (res) => {
  if (res.status !== null) return `exited ${res.status}`;
  if (res.signal) return `did not finish (${res.signal})`;
  return `could not be run, ${res.error.code || res.error.message}`;
};

/**
 * A failed `spawnSync` child's first stderr line, for a line naming why it failed.
 * @param {object} res - the `spawnSync` result, its stderr read as text
 * @param {string} [fallback] - the answer when stderr says nothing, `endOf` by default
 * @returns {string}
 */
const errLine = (res, fallback = endOf(res)) => (res.stderr || '').trim().split('\n')[0].trim() || fallback;

/**
 * A child's last stderr line that is not empty, trimmed, for a reason a refusal
 * ends on; the empty string when stderr says nothing.
 * @param {object} res - the `spawnSync` result, its stderr read as text
 * @returns {string}
 */
const lastErrLine = (res) => (res.stderr || '').trim().split('\n').pop().trim();

module.exports = {
  sayAs, writeErr, writeOut, endOf, errLine, lastErrLine,
};
