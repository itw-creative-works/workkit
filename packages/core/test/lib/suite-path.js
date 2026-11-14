// How a suite path someone wrote (a command-line argument, a serial entry) is
// read, for the runner (test/run.js) and `workkit convert` (test/convert.js).
// The door does not re-export it.

import path from 'node:path';

/**
 * The absolute path a written suite path names from the start folder, a `\`
 * in it read as `/` on every platform.
 * @param {string} root the folder the runner starts in
 * @param {string} written the path as typed
 * @returns {string}
 */
export const fromStart = (root, written) => path.resolve(root, written.replaceAll('\\', '/'));

/**
 * The suite paths an argument list writes: every argument but `--`.
 * @param {string[]} args the arguments as passed
 * @returns {string[]}
 */
export const writtenPaths = (args) => args.filter((arg) => arg !== '--');

/**
 * The suites written paths name from the start folder: absolute, each once, sorted.
 * @param {string} root the folder the runner starts in
 * @param {string[]} written the paths as typed
 * @returns {string[]}
 */
export const namedSuites = (root, written) => [...new Set(written.map((each) => fromStart(root, each)))].sort();

/**
 * The error line for the first written path that names none of <suites>, the
 * path as typed; null when each names one.
 * @param {string} root the folder the runner starts in
 * @param {string[]} suites the suites found, absolute paths
 * @param {string[]} written the paths as typed
 * @returns {string|null}
 */
export const unmatchedLine = (root, suites, written) => {
  const missing = written.find((each) => !suites.includes(fromStart(root, each)));
  return missing === undefined ? null : `No suite matches ${missing}`;
};
