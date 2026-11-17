// Which suites one run of the runner (test/run.js) runs: every suite a bare run
// finds, or the suites the paths after `--` name; and which of them wait for the
// serial tail, by their name. The door does not re-export it.

import fs from 'node:fs';
import path from 'node:path';
import { findSuites } from './suites.js';
import { namedSuites, unmatchedLine } from './suite-path.js';

// A suite that runs alone, after the parallel wave.
const SERIAL_NAME = /\.serial\.test\.[cm]?js$/;

// List files the runner never reads, each with where its rule belongs, so
// one left in a repo stops the run rather than lose that rule in silence.
const LEFTOVERS = [
  ['test/lib/serial.js', 'name a suite *.serial.test.js to run it alone'],
  ['test/lib/skip.js', 'skip a case in its own suite'],
];

/**
 * The run's suites: a bare run's, or those the paths name. A leftover list
 * file and a path naming nothing come back as the line that stops the run.
 * @param {{root: string, paths: string[]}} run
 * @returns {{error: string} | {suites: string[], serial: string[]}}
 *   or the suites (sorted), and those of them named `*.serial.test.js` (`.mjs`, `.cjs`) in the same order
 */
export const pickSuites = ({ root, paths }) => {
  const leftover = LEFTOVERS.find(([file]) => fs.existsSync(path.join(root, file)));
  if (leftover !== undefined) return { error: `${leftover[0]} is no longer read: ${leftover[1]}` };
  const all = findSuites(root);
  const miss = unmatchedLine(root, all, paths);
  if (miss !== null) return { error: miss };
  const suites = paths.length === 0 ? all : namedSuites(root, all, paths);
  return { suites, serial: suites.filter((suite) => SERIAL_NAME.test(path.basename(suite))) };
};
