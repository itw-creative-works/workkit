// A scratch workflow home, where every marker and record lives, and a file aged
// by its mtime for the sweep that clears them. Consumers: the test/hooks/lib,
// lib-record and commit-gate/marker suites.

const fs = require('fs');
const path = require('path');
const { shellPath } = require('./platform');
const { mkTmp } = require('./scratch');

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

module.exports = { scratchWorkflowHome, daysAgo, agedFile };
