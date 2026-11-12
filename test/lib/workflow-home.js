// A scratch workflow home, where every marker and record lives, the proof run
// folders under a HOME's cache, and a file or run folder aged by its mtime for
// the sweeps. Consumers: the test/hooks/lib, lib-record, commit-gate/marker,
// prove and red-proof suites.

const fs = require('fs');
const path = require('path');
const { shellPath } = require('./platform');
const { mkTmp } = require('./harness');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A scratch HOME whose `.workkit` is the workflow home.
 * @param {string} prefix - the scratch folder's name prefix
 * @returns {{workflowHome: string, env: {HOME: string, WORKFLOW_HOME: string}}}
 *   the workflow home, native; the env naming both in the shell's spelling
 */
const scratchWorkflowHome = (prefix) => {
  const home = mkTmp(prefix);
  const workflowHome = path.join(home, '.workkit');
  return { workflowHome, env: { HOME: shellPath(home), WORKFLOW_HOME: shellPath(workflowHome) } };
};

/**
 * The moment <days> days before now.
 * @param {number} days
 * @returns {Date}
 */
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

/**
 * Write <file> empty, its folder made, with its mtime <days> days back.
 * @param {string} file - native
 * @param {number} days
 * @returns {string} the file
 */
const agedFile = (file, days) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  const at = daysAgo(days);
  fs.utimesSync(file, at, at);
  return file;
};

/**
 * The HOME of a world whose workflow home is its `.workkit`.
 * @param {{workflowHome: string}} w
 * @returns {string} native
 */
const homeOf = (w) => path.dirname(w.workflowHome);

/**
 * The folder every proof run folder lives under, `<home>/.cache/workkit/proof`.
 * @param {string} home - the HOME, native
 * @returns {string}
 */
const proofBase = (home) => path.join(home, '.cache', 'workkit', 'proof');

/**
 * The run folders under proofBase(home), sorted, none when it is not there.
 * @param {string} home - the HOME, native
 * @returns {string[]}
 */
const runFolders = (home) => {
  const dir = proofBase(home);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
};

/**
 * A run folder `name` under proofBase(home) holding the empty file `rel`,
 * it and every folder from it up to the run folder last changed <days> days back.
 * @param {string} home - the HOME, native
 * @param {string} name
 * @param {number} days
 * @param {string} [rel] - the file, relative to the run folder
 */
const plantRun = (home, name, days, rel = 'copy/left.js') => {
  const run = path.join(proofBase(home), name);
  const file = agedFile(path.join(run, rel), days);
  const at = daysAgo(days);
  for (let dir = path.dirname(file); dir !== path.dirname(run); dir = path.dirname(dir)) fs.utimesSync(dir, at, at);
};

module.exports = { scratchWorkflowHome, daysAgo, agedFile, homeOf, proofBase, runFolders, plantRun };
