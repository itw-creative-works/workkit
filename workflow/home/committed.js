/**
 * workflow/home/committed.js: the reads of a folder's committed copy, with git
 * alone: whether a repo tracks it, its HEAD exported into a scratch folder,
 * and one file's committed text. The seed, the runner, the doctor, the heal,
 * the stamp and the build all read through it.
 * Usage: const { tracked, exportOf, source, file } = require('./committed');
 */

const fs = require('fs');
const path = require('path');
const { gitIn, textAt } = require('../lib/git');
const { isFile } = require('../lib/lock');
const { filesUnder } = require('../lib/read');
const { nativePath } = require('../lib/platform');
const { warn } = require('../lib/voice');

// A tree entry's git mode, as the export makes it again.
const MODE_EXEC = '100755';
const MODE_LINK = '120000';
const MODE_COMMIT = '160000';

/** A git call of the export that failed: the one failure exportOf reads as no export. */
class GitFailed extends Error {}

/**
 * Does a git repo track the folder? The one test the copies agree on: a
 * folder sitting untracked inside some other repo is not tracked.
 * @param {string} folder
 * @returns {boolean}
 */
const tracked = (folder) => gitIn(folder, ['ls-files', '--error-unmatch', '.'], { stdio: 'ignore' }).status === 0;

/** HEAD's entries under `folder`: mode, object and path from the folder; throws GitFailed when git cannot list them. */
const headEntries = (folder) => {
  const res = gitIn(folder, ['ls-tree', '-r', '-z', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (res.status !== 0) throw new GitFailed('git ls-tree failed');
  return res.stdout.toString('utf8').split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, , object] = line.slice(0, tab).split(' ');
    return { mode, object, rel: line.slice(tab + 1) };
  });
};

/** Each object's raw bytes, by object name, from one `git cat-file --batch`: no filter, so no line ending changes. */
const blobsOf = (folder, objects) => {
  const res = gitIn(folder, ['cat-file', '--batch'], { input: objects.map((o) => `${o}\n`).join(''), stdio: ['pipe', 'pipe', 'ignore'] });
  if (res.status !== 0) throw new GitFailed('git cat-file --batch failed');
  const blobs = new Map();
  let at = 0;
  while (at < res.stdout.length) {
    const end = res.stdout.indexOf(10, at);
    const [object, type, size] = res.stdout.subarray(at, end).toString('utf8').split(' ');
    if (type === 'missing') throw new GitFailed(`git cat-file: ${object} is missing`);
    const start = end + 1;
    blobs.set(object, res.stdout.subarray(start, start + Number(size)));
    at = start + Number(size) + 1;
  }
  return blobs;
};

/** HEAD's files under `folder` written into `dest`, each its bytes and its run bit. */
const exportHead = (folder, dest) => {
  const entries = headEntries(folder);
  const blobs = blobsOf(folder, [...new Set(entries.filter((e) => e.mode !== MODE_COMMIT).map((e) => e.object))]);
  for (const { mode, object, rel } of entries) {
    const at = path.join(dest, rel);
    if (mode === MODE_COMMIT) {
      fs.mkdirSync(at, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(at), { recursive: true });
    if (mode === MODE_LINK) fs.symlinkSync(blobs.get(object).toString('utf8'), at);
    else fs.writeFileSync(at, blobs.get(object), { mode: mode === MODE_EXEC ? 0o755 : 0o644 });
  }
};

/**
 * The folder a copy reads from. A folder a repo TRACKS gives HEAD's copy of
 * it, exported into `<scratch>/src`, so an uncommitted edit never travels; a
 * folder no repo tracks (even one inside some other repo) is itself. A failed
 * git, or an export holding no file, is no export; any other error is thrown.
 * @param {string} scratch a scratch folder the caller removes
 * @param {string} folder
 * @returns {string} the folder to read, or '' when the export failed
 */
const exportOf = (scratch, folder) => {
  if (!tracked(folder)) return folder;
  const dest = path.join(scratch, 'src');
  fs.mkdirSync(dest, { recursive: true });
  try {
    exportHead(folder, dest);
  } catch (err) {
    if (err instanceof GitFailed) return '';
    throw err;
  }
  return filesUnder(dest).length > 0 ? dest : '';
};

/**
 * exportOf, a failed export named in the seed's voice.
 * @param {string} scratch a scratch folder the caller removes
 * @param {string} folder
 * @returns {string} the folder to read, or '' when the export failed (warned)
 */
const source = (scratch, folder) => {
  const from = exportOf(scratch, folder);
  if (!from) warn(`home: could not export the committed files from ${nativePath(folder)} (HEAD holds none of it, or the extract failed); nothing was copied from it`);
  return from;
};

/**
 * One file's text by the same rule: HEAD's copy when a repo tracks the
 * folder, else the disk's.
 * @param {string} folder
 * @param {string} rel the path from the folder
 * @returns {string|null} null when that side lacks it
 */
const file = (folder, rel) => {
  if (tracked(folder)) return textAt(folder, 'HEAD', `./${rel}`);
  const at = path.join(folder, rel);
  if (!isFile(at)) return null;
  try {
    return fs.readFileSync(at, 'utf8');
  } catch {
    return null;
  }
};

module.exports = {
  tracked, exportOf, source, file,
};
