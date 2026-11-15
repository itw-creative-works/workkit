// How a suite path someone wrote (a command-line argument, a serial or skip
// entry) is read, for the runner (test/run.js) and `workkit convert`
// (test/convert.js): a suite file, or a folder naming every suite under it.
// The door does not re-export it.

import path from 'node:path';

// The runner's one flag, and the line each misuse of it stops the run with.
const FILTER_FLAG = '--filter';
const FILTER_EMPTY = `${FILTER_FLAG} needs a text`;
const FILTER_TWICE = `${FILTER_FLAG} is given once`;

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
 * The `--filter=<text>` flag read out of an argument list, so it is no path:
 * `--filter` alone or with `=` reads the text after the `=`. Any other `--`
 * argument stays in `rest`, a path as before.
 * @param {string[]} args the arguments as passed
 * @returns {{filter: string|null, rest: string[], error: string|null}}
 *   the text (null with no flag), the other arguments, and the line a misuse stops the run with
 */
export const readFilter = (args) => {
  const isFlag = (arg) => arg === FILTER_FLAG || arg.startsWith(`${FILTER_FLAG}=`);
  const given = args.filter(isFlag);
  const rest = args.filter((arg) => !isFlag(arg));
  if (given.length === 0) return { filter: null, rest, error: null };
  if (given.length > 1) return { filter: null, rest, error: FILTER_TWICE };
  const text = given[0].slice(FILTER_FLAG.length + 1);
  return { filter: text || null, rest, error: text ? null : FILTER_EMPTY };
};

/**
 * Whether an absolute path is <folder> or sits under it: the start folder, or
 * a skip list entry.
 * @param {string} folder an absolute path
 * @param {string} at an absolute path
 * @returns {boolean}
 */
export const isWithin = (folder, at) => {
  const rel = path.relative(folder, at);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};

/**
 * The suites one written path names: the suite file itself, or every suite of
 * <suites> under the folder it names. <suites> is the bare run's walk, so a
 * folder's suites follow its rule; none when the path names neither, or
 * resolves outside the start folder.
 * @param {string} root the folder the runner starts in
 * @param {string[]} suites the suites found, absolute paths
 * @param {string} written the path as typed
 * @returns {string[]} absolute paths, in <suites>' order
 */
export const suitesOf = (root, suites, written) => {
  const at = fromStart(root, written);
  if (!isWithin(root, at)) return [];
  if (suites.includes(at)) return [at];
  const inside = at.endsWith(path.sep) ? at : `${at}${path.sep}`;
  return suites.filter((suite) => suite.startsWith(inside));
};

/**
 * The suites written paths name from the start folder: absolute, each once, sorted.
 * @param {string} root the folder the runner starts in
 * @param {string[]} suites the suites found, absolute paths
 * @param {string[]} written the paths as typed
 * @returns {string[]}
 */
export const namedSuites = (root, suites, written) => [...new Set(written.flatMap((each) => suitesOf(root, suites, each)))].sort();

/**
 * The error line for the first written path that names none of <suites>, the
 * path as typed; null when each names one.
 * @param {string} root the folder the runner starts in
 * @param {string[]} suites the suites found, absolute paths
 * @param {string[]} written the paths as typed
 * @returns {string|null}
 */
export const unmatchedLine = (root, suites, written) => {
  const missing = written.find((each) => suitesOf(root, suites, each).length === 0);
  return missing === undefined ? null : `No suite matches ${missing}`;
};
