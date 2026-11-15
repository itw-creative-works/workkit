// Which suites one run of the runner (test/run.js) runs: every suite a bare run
// finds, or the suites the paths after `--` name, less what the repo's
// `test/lib/skip.js` leaves out; the serial tail's order from
// `test/lib/serial.js`; and whether the mod half runs. The door does not re-export it.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { findSuites, findModSuites, modDir } from './suites.js';
import {
  fromStart, isWithin, suitesOf, namedSuites, unmatchedLine,
} from './suite-path.js';

// A repo's list files are CommonJS, loaded by absolute path.
const require = createRequire(import.meta.url);

// The lists' homes, and how a start failure names each.
export const SERIAL_FILE = 'test/lib/serial.js';
export const SKIP_FILE = 'test/lib/skip.js';

// One list file's exports; null without the file.
const listFile = (root, rel) => {
  const file = path.join(root, rel);
  return fs.existsSync(file) ? require(file) : null;
};

// Whether a list's value is the one shape a list takes, an array of paths.
const isPathList = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string');

// The line a list of the wrong shape stops the run with.
const shapeLine = (file, name) => `${file}: ${name} must be an array of paths`;

/**
 * The repo's lists, entries as written: the serial tail, the suites a run
 * leaves out, and those it leaves out as well when `CI` is set.
 * A serial.js must export `SERIAL`; each skip list is optional. A list of
 * another shape than an array of paths comes back as the line that stops the run.
 * @param {string} root the folder the runner starts in
 * @returns {{error: string} | {serial: string[], skip: string[], ciSkip: string[]}}
 */
export const listsOf = (root) => {
  const serialFile = listFile(root, SERIAL_FILE);
  if (serialFile !== null && !isPathList(serialFile.SERIAL)) return { error: shapeLine(SERIAL_FILE, 'SERIAL') };
  const skipFile = listFile(root, SKIP_FILE) ?? {};
  const bad = ['SKIP', 'CI_SKIP'].find((name) => skipFile[name] !== undefined && !isPathList(skipFile[name]));
  if (bad !== undefined) return { error: shapeLine(SKIP_FILE, bad) };
  return { serial: serialFile?.SERIAL ?? [], skip: skipFile.SKIP ?? [], ciSkip: skipFile.CI_SKIP ?? [] };
};

// Whether a named suite runs: one no active skip entry lists always does; a
// listed one only when a path that names it is its entry or sits inside it,
// so a wider path (a folder holding the entry) leaves it out.
const keptByPaths = (root, all, suite, active, paths) => {
  const entries = active.filter((entry) => suitesOf(root, all, entry).includes(suite));
  if (entries.length === 0) return true;
  return paths.some((arg) => suitesOf(root, all, arg).includes(suite)
    && entries.some((entry) => isWithin(fromStart(root, entry), fromStart(root, arg))));
};

/**
 * The run's suites: a bare run's less the skip lists', or those the paths
 * name less the listed suites no path names narrowly enough (keptByPaths);
 * a path naming a mod suite, or a folder holding one, picks the mod half.
 * A list of the wrong shape, a list entry naming no suite (a skip entry may
 * name a member's folder) and a path naming nothing come back as the line
 * that stops the run.
 * @param {{root: string, paths: string[], ci: boolean, isMember: (dir: string) => boolean}} run
 * @returns {{error: string} | {suites: string[], serial: string[], withMods: boolean, leftOut: number, skipped: string[]}}
 *   or the suites (sorted), the serial tail in the list's order, how many a
 *   skip list left out, and the absolute folders the active skip entries name
 */
export const pickSuites = ({ root, paths, ci, isMember }) => {
  const lists = listsOf(root);
  if (lists.error !== undefined) return lists;
  const all = findSuites(root);
  const mods = findModSuites(modDir(root));
  const serialMiss = unmatchedLine(root, all, lists.serial);
  if (serialMiss !== null) return { error: `${serialMiss} (${SERIAL_FILE})` };
  const skipMiss = [...lists.skip, ...lists.ciSkip]
    .find((entry) => suitesOf(root, all, entry).length === 0 && !isMember(fromStart(root, entry)));
  if (skipMiss !== undefined) return { error: `No suite matches ${skipMiss} (${SKIP_FILE})` };
  const serial = [...new Set(lists.serial.flatMap((entry) => suitesOf(root, all, entry)))];
  const active = ci ? [...lists.skip, ...lists.ciSkip] : lists.skip;
  if (paths.length === 0) {
    const out = new Set(active.flatMap((entry) => suitesOf(root, all, entry)));
    return {
      suites: all.filter((suite) => !out.has(suite)),
      serial,
      withMods: mods.length > 0,
      leftOut: out.size,
      skipped: active.map((entry) => fromStart(root, entry)),
    };
  }
  const namesMods = (arg) => {
    const at = fromStart(root, arg);
    return isWithin(root, at) && mods.some((mod) => isWithin(at, mod));
  };
  const miss = unmatchedLine(root, all, paths.filter((arg) => !namesMods(arg)));
  if (miss !== null) return { error: miss };
  const named = namedSuites(root, all, paths);
  const kept = named.filter((suite) => keptByPaths(root, all, suite, active, paths));
  return {
    suites: kept, serial, withMods: paths.some(namesMods), leftOut: named.length - kept.length, skipped: [],
  };
};
