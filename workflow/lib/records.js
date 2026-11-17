#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/lib/records.js: the proved-tree records' rules (hooks/mods/suite.js)
// bound to the disk: the suite record and the package record, where each is
// kept, their writes and their reads. lib/suite.sh's names run it as a command.
// Usage: node records.js <verb> ...   (main's verbs; a yes or no is the exit code)

const fs = require('fs');
const path = require('path');
const { readOrNull } = require('./read');
const { pkgMarkerPath, shellEnvOf, suiteMarkerPath } = require('../../hooks/mods/markers.js');
const { userDirOf } = require('../../hooks/mods/log.js');
const {
  pkgProved, pkgRecordText, suiteProved, suiteRecordText,
} = require('../../hooks/mods/suite.js');

// The days a marker outlives its last write: MARKER_KEEP_DAYS in platform.sh.
const MARKER_KEEP_DAYS = 7;

// The lock's wait, as wk_take_lock's: 50 tries 100ms apart.
const LOCK_TRIES = 50;
const LOCK_PAUSE_MS = 100;

const USAGE = 'usage: records.js suite-write <root> <tree> <ms> | pkg-write <root> <tree> <pkg> | suite-proved <root> <tree> | pkg-proved <root> <tree> <pkg>';

/** The machine folder as the hooks read it, the shell's spelling of its paths translated. */
const home = () => userDirOf(shellEnvOf(process.env, process.platform));

/** The suite record's file for a repo root. */
const suiteRecordPath = (root) => suiteMarkerPath(root, home());

/** The package record's file for a repo root, never the suite's. */
const pkgRecordPath = (root) => pkgMarkerPath(root, home());

/**
 * Remove each regular file one folder under the markers folder, the one
 * `record` sits two levels under, whose mtime is older than MARKER_KEEP_DAYS;
 * a folder there (a lock) is never entered. It never fails a writer:
 * wk_sweep_markers's rule.
 */
const sweepMarkers = (record) => {
  const dir = path.dirname(path.dirname(record));
  const oldest = Date.now() - MARKER_KEEP_DAYS * 86400000;
  let folders = [];
  try { folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { return; }
  for (const folder of folders) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, folder.name), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const file = path.join(dir, folder.name, entry.name);
      try {
        if (fs.statSync(file).mtimeMs < oldest) fs.rmSync(file, { force: true });
      } catch { /* gone already, or another writer's */ }
    }
  }
};

/**
 * Take the lock folder `lock`, so overlapping package-record writers exclude
 * each other: the folder made, then its `claim` made create-only, the steps
 * wk_take_lock takes in shell.
 * @returns {Promise<boolean>} whether it is held, false after the wait
 */
const takeLock = async (lock) => {
  for (let i = 0; i < LOCK_TRIES; i += 1) {
    try {
      fs.mkdirSync(lock);
      fs.writeFileSync(path.join(lock, 'claim'), '', { flag: 'wx' });
      return true;
    } catch { /* another taker holds it */ }
    await new Promise((resolve) => { setTimeout(resolve, LOCK_PAUSE_MS); });
  }
  return false;
};

/** The claim goes first, then the folder: a taker between the two keeps it (wk_drop_lock). */
const dropLock = (lock) => {
  fs.rmSync(path.join(lock, 'claim'), { force: true });
  try { fs.rmdirSync(lock); } catch { /* a new taker holds it */ }
};

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
  sweepMarkers(file);
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
  sweepMarkers(file);
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
  suiteRecordPath, pkgRecordPath, writeSuiteRecord, writePkgRecord, suiteHolds, pkgHolds,
};
