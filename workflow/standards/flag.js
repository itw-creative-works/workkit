/**
 * workflow/standards/flag.js: the heal's one "warn and flag the run": a step
 * prints its warning and marks the run unfinished, so the heal exits 1 and the
 * next session retries.
 * Usage: const { flag } = require('./flag');
 */

const { warn } = require('../lib/voice');

/**
 * Warns `line` and flags the run.
 * @param {{needsAttention: boolean}} run - the heal's run object
 * @param {string} line - the warning, as `warn` prints it
 */
const flag = (run, line) => {
  warn(line);
  run.needsAttention = true;
};

module.exports = { flag };
