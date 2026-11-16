// The one home of a parent that never collects its child: the child ends at
// once and waits uncollected while the parent lives, the state a liveness check
// must read as gone.

const { expect, until, start, SPAWN_DEADLINE } = require('./harness');
const { BASH, NO_RC } = require('./platform');

// Starts a short child, prints its pid and becomes `tail`, a parent that never
// collects it; `set -m` as <prefix> makes the child lead its own group.
const NEVER_COLLECTS = (prefix) => `${prefix}sleep 0.1 & echo $!; exec tail -f /dev/null`;

/**
 * Start the parent, its watchdog past the wait's bound, so only the child's own end turns it gone.
 * @param {string} [prefix] - shell run before the child starts
 * @returns {object} start()'s handle on the parent
 */
const startNeverCollects = (prefix = '') => start(BASH, [...NO_RC, '-c', NEVER_COLLECTS(prefix)], { deadline: 2 * SPAWN_DEADLINE });

/**
 * The child's pid the parent printed, once it is whole.
 * @param {object} parent - startNeverCollects()'s handle
 * @returns {Promise<number>}
 */
const childOf = async (parent) => {
  expect(await until(() => /^\d+\n$/.test(parent.stdout())), `the parent printed its child's pid, got: ${parent.output()}`).toBe(true);
  return Number(parent.stdout().trim());
};

module.exports = { startNeverCollects, childOf };
