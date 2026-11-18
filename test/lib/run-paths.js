/**
 * The kit's run paths (`runPaths` of workflow/lib/run-paths.js) asked in a node
 * of their own under a world's env, so the machine folder and git's ignore rules
 * are the world's, never this process's.
 * Consumers: test/hooks/twins.test.js and test/scripts/watch.test.js.
 */

const path = require('path');
const { run, expect } = require('./harness');
const { jsPath } = require('./platform');

const RUN_PATHS = path.join(__dirname, '..', '..', 'workflow', 'lib', 'run-paths.js');

/**
 * `runPaths(root, which, slot)` for each of <asks>, one node under <env>.
 * @param {object} env the node's whole environment
 * @param {Array<[string, string, number?]>} asks `[root, which]` or `[root, which, slot]`
 * @returns {{log: string, lock: string}[]} one answer per ask, in order
 */
const runPathsUnder = (env, asks) => {
  const script = [
    `const { runPaths } = require(${jsPath(RUN_PATHS)});`,
    'const asks = JSON.parse(process.argv[1]);',
    'Promise.all(asks.map(([root, which, slot]) => runPaths(root, which, slot)))',
    '  .then((answers) => process.stdout.write(JSON.stringify(answers)));',
  ].join('\n');
  const res = run(process.execPath, ['-e', script, JSON.stringify(asks)], { env });
  expect(res.status, `runPaths answered under the world's env, stderr: ${res.stderr}`).toBe(0);
  return JSON.parse(res.stdout);
};

module.exports = { runPathsUnder };
