// workflow/lib/records.js: the proved-tree records' rules (hooks/mods/suite.js)
// bound to the disk, CJS: the suite record and the package record, where each is
// kept, their writes and their reads.
// Usage: const { writeSuiteRecord, suiteHolds } = require('./records');

const fs = require('fs');
const path = require('path');
const { readOrNull } = require('./read');
const { writeWhole } = require('./write');
const {
  takeLock, dropLock, sweepMarkers, writeMarker,
} = require('./lock');
const { pkgMarkerPath, shellEnvOf, suiteMarkerPath } = require('../../hooks/mods/markers.js');
const { userDirOf } = require('../../hooks/mods/log.js');
const {
  pkgProved, pkgRecordText, suiteProved, suiteRecordText,
} = require('../../hooks/mods/suite.js');

/** The machine folder as the hooks read it, the shell's spelling of its paths translated. */
const home = () => userDirOf(shellEnvOf(process.env, process.platform));

/** The suite record's file for a repo root. */
const suiteRecordPath = (root) => suiteMarkerPath(root, home());

/** The package record's file for a repo root, never the suite's. */
const pkgRecordPath = (root) => pkgMarkerPath(root, home());

/**
 * Write the suite record afresh: <tree>, hashed BEFORE the green run, and the
 * run's wall time, through writeMarker, which then sweeps the old markers.
 * @param {string} root the repo root
 * @param {string} tree the tree id; empty is refused, nothing written
 * @param {number|string} ms the run's milliseconds
 * @returns {Promise<boolean>} whether it was written
 */
const writeSuiteRecord = async (root, tree, ms) => {
  if (!tree) return false;
  writeMarker(await suiteRecordPath(root), home(), suiteRecordText(tree, ms));
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
  try {
    writeWhole(file, pkgRecordText(readOrNull(file), tree, pkg));
    return true;
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

module.exports = {
  home, suiteRecordPath, pkgRecordPath, writeSuiteRecord, writePkgRecord, suiteHolds, pkgHolds,
};
