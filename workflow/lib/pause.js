// workflow/lib/pause.js: the one blocking wait the kit's synchronous Node
// commands share, so a poll loop sleeps without a child process.
// Usage: const { pause } = require('../lib/pause');

/**
 * Block the process for `seconds`.
 * @param {number} seconds - a fraction allowed
 */
const pause = (seconds) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
};

module.exports = { pause };
