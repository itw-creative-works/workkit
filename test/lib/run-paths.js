/**
 * The kit's run paths (`runPaths` of workflow/lib/run-paths.js) asked in a node
 * of their own under a world's env, so the machine folder and git's ignore rules
 * are the world's, never this process's.
 * Consumers: test/scripts/watch.test.js and script-shell-detached.test.js.
 */

const { kitUnder } = require('./kit-under');

/**
 * `runPaths(root, which, slot)` for each of <asks>, one node under <env>.
 * @param {object} env the node's whole environment
 * @param {Array<[string, string, number?]>} asks `[root, which]` or `[root, which, slot]`
 * @returns {{log: string, lock: string}[]} one answer per ask, in order
 */
const runPathsUnder = (env, asks) => kitUnder(env, 'run-paths.js', 'runPaths', asks);

module.exports = { runPathsUnder };
