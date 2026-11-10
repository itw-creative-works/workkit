// workflow/lib/say.js: the one-line stderr writer the kit's Node commands share,
// and how a child process ended or why it failed, phrased for such a line.
// Usage: const { sayAs, endOf, errLine } = require('../lib/say');

const fs = require('fs');

/**
 * A writer of `<prefix>: <text>` lines on stderr, written straight to the fd so
 * each lands before a child's output that follows it; stdout stays the command's own.
 * @param {string} prefix - the line prefix, without its colon
 * @returns {(text: string) => void}
 */
const sayAs = (prefix) => (text) => {
  fs.writeSync(2, `${prefix}: ${text}\n`);
};

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

module.exports = { sayAs, endOf, errLine };
