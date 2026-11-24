/**
 * workflow/home/runner.js: the cloud brief's runner in the clone, seeded by
 * content from the committed kit and pruned of what its list does not name.
 * The list is the exported kit's own runner-files.js, never the working copy's.
 * Usage: const { runnerList, runnerRetired, seedRunner } = require('./runner');
 */

const fs = require('fs');
const path = require('path');
const { isDir, isFile } = require('../lib/lock');
const { nativePath } = require('../lib/platform');
const { ok, skip, warn } = require('../lib/voice');
const { towerDir } = require('../user-dir');
const { kitDir } = require('./options');
const { filesUnder } = require('../lib/read');
const { withScratch } = require('../lib/scratch');
const { source } = require('./committed');
const { sameBytes } = require('./seed');
const { downgrades, stampWrite } = require('./stamp');

// Where a kit folder keeps its list.
const LIST_REL = path.join('workflow', 'home', 'runner-files.js');

/**
 * The `[source, destination]` pairs a kit folder's own runner-files.js lists;
 * none when it has no list, or one that cannot be loaded (it does not parse,
 * or it requires a file that is not there). Any other error is thrown.
 * @param {string} kit a kit folder, the exported one
 * @returns {Array<[string, string]>}
 */
const runnerList = (kit) => {
  const file = path.join(kit, LIST_REL);
  if (!isFile(file)) return [];
  let pairs;
  try {
    pairs = require(file);
  } catch (err) {
    if (err instanceof SyntaxError || err.code === 'MODULE_NOT_FOUND') return [];
    throw err;
  }
  return Array.isArray(pairs) ? pairs : [];
};

/**
 * The files under the clone's `brief/` the given pairs do not name: the seed
 * removes them and the doctor counts them. No link is followed, which keeps
 * the walk inside the clone.
 * @param {Array<[string, string]>} pairs
 * @returns {string[]} the files' paths
 */
const runnerRetired = (pairs) => {
  const home = towerDir();
  const kept = new Set(pairs.map(([, dest]) => dest));
  if (!isDir(path.join(home, 'brief'))) return [];
  return filesUnder(path.join(home, 'brief')).filter((found) => !kept.has(path.relative(home, found).split(path.sep).join('/')));
};

/** Each emptied folder under `root` removed, deepest first; a folder that is not empty stays. */
const removeEmptyDirs = (root) => {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    removeEmptyDirs(dir);
    try {
      fs.rmdirSync(dir);
    } catch {
      // Not empty: the refusal is the check.
    }
  }
};

/** Each listed file copied by content: the count written and the sources the kit lacks; written null when a write failed (warned). */
const copyListed = (from, pairs) => {
  const home = towerDir();
  let written = 0;
  const missing = [];
  for (const [src, dest] of pairs) {
    const at = path.join(from, src);
    const to = path.join(home, dest);
    if (!isFile(at)) {
      missing.push(src);
      continue;
    }
    if (sameBytes(at, to)) continue;
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      // The source's mode is kept, so a script stays runnable.
      fs.copyFileSync(at, to);
    } catch {
      warn(`home: could not write ${dest} into ${nativePath(home)}`);
      return { written: null, missing };
    }
    written += 1;
  }
  return { written, missing };
};

/**
 * The runner seeded into the clone from the committed kit, the retired files
 * pruned from `brief/`, and the stamp written.
 * @returns {Promise<number>} 0 something changed, 2 already current, 1 nothing was written
 */
const seedRunner = async () => {
  const home = towerDir();
  const kit = kitDir();
  if (!kit || !isDir(kit)) {
    warn('home: the kit could not be resolved beside this engine; the cloud brief\'s runner was not seeded');
    return 1;
  }
  // Never over a newer kit's work, so no caller commits.
  if (downgrades()) return 1;
  // The walk answers false when it wrote nothing (warned), else its counts.
  const seeded = withScratch((scratch) => {
    const from = source(scratch, kit);
    if (!from) return false;
    const pairs = runnerList(from);
    if (pairs.length === 0) {
      warn(`home: the committed kit at ${nativePath(kit)} carries no runner list; the cloud brief's runner was not seeded`);
      return false;
    }
    const copied = copyListed(from, pairs);
    if (copied.written === null) return false;
    let changed = copied.written;
    let removed = 0;
    // Only `brief/`, engine territory, is pruned. A missing source is a list
    // naming a file the commit lacks, so the prune waits: a file the list
    // dropped may still be one the committed scripts require.
    if (copied.missing.length === 0 && isDir(path.join(home, 'brief'))) {
      for (const found of runnerRetired(pairs)) {
        try {
          fs.rmSync(found, { force: true });
        } catch {
          warn(`home: could not remove the retired ${path.relative(home, found).split(path.sep).join('/')} from ${nativePath(home)}`);
          return false;
        }
        changed += 1;
        removed += 1;
      }
      removeEmptyDirs(path.join(home, 'brief'));
    }
    return { changed, removed, missing: copied.missing };
  }, 'workkit-home.');
  if (seeded === null) {
    warn('home: could not make a scratch directory; the cloud brief\'s runner was not seeded');
    return 1;
  }
  if (seeded === false) return 1;
  let { changed } = seeded;
  const { removed, missing } = seeded;
  if (missing.length > 0) {
    warn(`home: this kit is missing ${missing.join(' ')}; the cloud brief's runner is incomplete in ${nativePath(home)}, and the files its list no longer names were left in place until it is whole`);
  }
  // The stamp counts as a write of its own, so a bare version bump still
  // reaches the remote.
  if (stampWrite()) changed += 1;
  if (changed === 0) {
    skip(`home: the cloud brief's runner in ${nativePath(home)} is current`);
    return 2;
  }
  ok(`home: seeded the cloud brief's runner in ${nativePath(home)} (${changed - removed} file(s) from ${nativePath(kit)}, ${removed} retired)`);
  return 0;
};

module.exports = { runnerList, runnerRetired, seedRunner };
