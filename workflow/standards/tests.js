/**
 * workflow/standards/tests.js: the check that a repo's `npm test` runs
 * workkit-core's runner, read off package.json and never run. A step of the
 * heal, run in the repo root.
 * Usage: const { checkTestRunner } = require('./tests');
 */

const { readJsonOrNull } = require('../lib/read');
const { hasCorePackage } = require('../lib/repo');
const { warn } = require('../lib/voice');

/**
 * Silent when devDependencies names workkit-core, whatever script wraps
 * `workkit test`, and when there is no test script; any other test script gets
 * one line naming both changes, never a flag on the run.
 * @param {{root: string}} run
 */
const checkTestRunner = (run) => {
  const script = readJsonOrNull('package.json')?.scripts?.test;
  if (typeof script !== 'string' || script === '') return;
  if (hasCorePackage(run.root)) return;
  warn('test script: npm test does not run workkit-core\'s runner; run `npm i -D workkit-core` and set `"test": "workkit test"`');
};

module.exports = { checkTestRunner };
