#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/lib/records.js: the proved-tree records' rules (hooks/mods/suite.js)
// bound to the disk: the suite record and the package record, where each is
// kept, their writes and their reads. lib/suite.sh's names run it as a command.
// Usage: node records.js <verb> ...   (main's verbs; a yes or no is the exit code)

const fs = require('fs');
const path = require('path');
const { readOrNull } = require('./read');
const { takeLock, dropLock, sweepMarkers } = require('./lock');
const { pkgMarkerPath, shellEnvOf, suiteMarkerPath } = require('../../hooks/mods/markers.js');
const { userDirOf } = require('../../hooks/mods/log.js');
const {
  pkgProved, pkgRecordText, suiteProved, suiteRecordText,
} = require('../../hooks/mods/suite.js');

const USAGE = 'usage: records.js suite-write <root> <tree> <ms> | pkg-write <root> <tree> <pkg> | suite-proved <root> <tree> | pkg-proved <root> <tree> <pkg>';

/** The machine folder as the hooks read it, the shell's spelling of its paths translated. */
const home = () => userDirOf(shellEnvOf(process.env, process.platform));

/** The suite record's file for a repo root. */
const suiteRecordPath = (root) => suiteMarkerPath(root, home());

/** The package record's file for a repo root, never the suite's. */
const pkgRecordPath = (root) => pkgMarkerPath(root, home());

/**
 * Write the suite record afresh: <tree>, hashed BEFORE the green run, and the
 * run's wall time. The old markers are swept first.
 * @param {string} root the repo root
 * @param {string} tree the tree id; empty is refused, nothing written
 * @param {number|string} ms the run's milliseconds
 * @returns {Promise<boolean>} whether it was written
 */
const writeSuiteRecord = async (root, tree, ms) => {
  if (!tree) return false;
  const file = await suiteRecordPath(root);
  sweepMarkers(home());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, suiteRecordText(tree, ms));
  return true;
};

/**
 * Write `<tree> <pkg>` to the package record, the other packages' lines kept,
 * under `<record>.lock` and through a temp file moved onto the record, so
 * overlapping writers each keep their line. The old markers are swept first.
 * @param {string} root the repo root
 * @param {string} tree the package's own tree id, hashed before its green run
 * @param {string} pkg the package folder relative to the root, `.` the root
 * @returns {Promise<boolean>} true once written; false for empty arguments, nothing written
 * @throws {Error} a failed write or move, the temp file removed
 */
const writePkgRecord = async (root, tree, pkg) => {
  if (!tree || !pkg) return false;
  const file = await pkgRecordPath(root);
  sweepMarkers(home());
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  // A lock not taken in time writes anyway, as wk_take_lock's callers do.
  const locked = await takeLock(lock);
  const temp = `${file}.tmp.${process.pid}`;
  try {
    fs.writeFileSync(temp, pkgRecordText(readOrNull(file), tree, pkg));
    fs.renameSync(temp, file);
    return true;
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  } finally {
    if (locked) dropLock(lock);
  }
};

/**
 * Whether the suite record's first line is <tree>.
 * @param {string} root the repo root
 * @param {string} tree the tree id
 * @returns {Promise<boolean>}
 */
const suiteHolds = async (root, tree) => suiteProved(readOrNull(await suiteRecordPath(root)), tree);

/**
 * Whether a line of the package record is `<tree> <pkg>`.
 * @param {string} root the repo root
 * @param {string} tree the package's own tree id
 * @param {string} pkg the package folder relative to the root, `.` the root
 * @returns {Promise<boolean>}
 */
const pkgHolds = async (root, tree, pkg) => pkgProved(readOrNull(await pkgRecordPath(root)), tree, pkg);

// Each verb: its arity and its answer, a yes or no.
const VERBS = {
  'suite-write': [3, ([root, tree, ms]) => writeSuiteRecord(root, tree, ms)],
  'pkg-write': [3, ([root, tree, pkg]) => writePkgRecord(root, tree, pkg)],
  'suite-proved': [2, ([root, tree]) => suiteHolds(root, tree)],
  'pkg-proved': [3, ([root, tree, pkg]) => pkgHolds(root, tree, pkg)],
};

/**
 * The CLI: a yes or no as 0 or 1. A failed write prints `records: <reason>`
 * and exits 1; a record that cannot be read reads as no record (a no). 2 for a
 * call it does not take.
 * @param {string[]} argv `<verb> <args...>`
 * @returns {Promise<number>} the exit code
 */
const main = async ([verb, ...args]) => {
  const known = VERBS[verb];
  if (!known || !args[0] || args.length < known[0]) {
    console.error(USAGE);
    return 2;
  }
  try {
    return (await known[1](args)) ? 0 : 1;
  } catch (err) {
    console.error(`records: ${err.message}`);
    return 1;
  }
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = {
  home, suiteRecordPath, pkgRecordPath, writeSuiteRecord, writePkgRecord, suiteHolds, pkgHolds,
};
