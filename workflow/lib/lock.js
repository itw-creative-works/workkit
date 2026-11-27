/**
 * workflow/lib/lock.js: the lock folder's rules bound to the disk, CJS: the
 * create-only claim, a run lock's mark (`id.<tag>`, `gone.<tag>`, `id.orphan`),
 * its retire and its adopt, the judged retire every remover shares, the plain
 * mutex and the state mutex's path, the marker write and the 7-day sweep of
 * the marker folders. The sweep has a shell twin in lib/platform.sh
 * (`wk_sweep_markers`), which the gh shim uses.
 * Usage: const { takeLock, dropLock, stateLockPath } = require('./lock');
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');
const { spawnSync } = require('./run');
const { readOrNull } = require('./read');
const { ended } = require('./proc-state');

// The days a marker outlives its last write: MARKER_KEEP_DAYS in platform.sh.
const MARKER_KEEP_DAYS = 7;

// The mutex's wait: 50 tries 100ms apart.
const LOCK_TRIES = 50;
const LOCK_PAUSE_MS = 100;

// A run lock's mark: the taker's, or a removal's under way.
const MARK = /^(id|gone)\..+$/;

const DAY_MS = 86400000;

// The tags this process made, so two takes in one process never share one.
let tagCount = 0;

/** Whether <file> is a regular file. */
const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

/** Whether <dir> is a folder. */
const isDir = (dir) => {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** <file> created holding <text>, never over one there: whether this call made it. */
const created = (file, text) => {
  try {
    fs.writeFileSync(file, text, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
};

/** <file> written empty: whether it was. */
const touched = (file) => {
  try {
    fs.writeFileSync(file, '');
    return true;
  } catch {
    return false;
  }
};

/** <file> removed as `rm -f` removes it: a failure passed over. */
const removed = (file) => {
  try {
    fs.rmSync(file, { force: true });
  } catch { /* a folder, or no longer ours to remove */ }
};

/** The names in <dir>, sorted, so two reads of one folder compare; none when it cannot be read. */
const lockFiles = (dir) => {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
};

/**
 * Whether <pid> still runs: it answers a zero signal, and off Windows its state
 * is no zombie's (`ended` in lib/proc-state.js). Any refusal reads as gone, as
 * the shell's `kill -0` does.
 * @param {number|string} pid
 * @returns {boolean}
 */
const pidAlive = (pid) => {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
  } catch {
    return false;
  }
  return !ended(n, spawnSync);
};

/**
 * A tag no other take on this machine holds: this process's pid, a count of
 * the tags it made, and a random part against a pid used again later.
 * @returns {string}
 */
const lockTag = () => {
  tagCount += 1;
  return `${process.pid}.${tagCount}.${crypto.randomInt(32768)}`;
};

/**
 * The pid that is a tag's first field; null for a tag with none (`orphan`, `x`).
 * @param {string} tag
 * @returns {number|null}
 */
const tagPid = (tag) => {
  const [pid] = String(tag).split('.');
  return /^\d+$/.test(pid) ? Number(pid) : null;
};

/** Whether the removal that made a `gone.<tag>` mark still runs; a tag with no pid is gone. */
const removerLives = (mark) => {
  const pid = tagPid(mark.slice('gone.'.length));
  return pid !== null && pidAlive(pid);
};

/**
 * Claim <dir>: only the caller that makes the folder and then creates its
 * `claim` create-only holds it, since a `mkdir` may answer 0 to two racing
 * callers. With a tag (a run lock): only into an empty folder, `id.<tag>`
 * before the claim that holds <tag> and once more after; a lost claim takes its
 * `id.<tag>` back.
 * @param {string} dir
 * @param {string} [tag]
 * @returns {boolean} whether this call holds it
 */
const claimDir = (dir, tag) => {
  try {
    fs.mkdirSync(dir);
  } catch {
    return false;
  }
  const claim = path.join(dir, 'claim');
  if (!tag) return created(claim, '');
  if (lockFiles(dir).length > 0) return false;
  const mark = path.join(dir, `id.${tag}`);
  if (!touched(mark)) return false;
  if (!created(claim, `${tag}\n`)) {
    removed(mark);
    return false;
  }
  // A removal still running in this folder may have deleted the mark.
  touched(mark);
  return true;
};

/**
 * A run lock's mark: the `id.<tag>` its `claim` names when that file is there,
 * else its `gone.<tag>`, else `id.orphan`; null for none. Any other `id.*` is a
 * taker's leftover from a lost claim.
 * @param {string} dir
 * @returns {string|null}
 */
const lockMark = (dir) => {
  const tag = (readOrNull(path.join(dir, 'claim')) ?? '').split('\n')[0];
  if (tag !== '' && isFile(path.join(dir, `id.${tag}`))) return `id.${tag}`;
  const gone = lockFiles(dir).find((name) => name.startsWith('gone.') && isFile(path.join(dir, name)));
  if (gone) return gone;
  return isFile(path.join(dir, 'id.orphan')) ? 'id.orphan' : null;
};

/**
 * The one removal of a run lock: that exact mark renamed to `gone.<own tag>`,
 * one caller alone, then the other files, `claim`, the gone file and the
 * folder, so a removal cut off mid-way leaves its gone mark or nothing.
 * @param {string} dir
 * @param {string} mark an `id.*` or `gone.*` file in <dir>
 * @returns {boolean} whether the folder went; false, the folder as it was, without
 *   <mark> or on a live remover's gone mark
 */
const retireLock = (dir, mark) => {
  if (!MARK.test(mark ?? '') || !isFile(path.join(dir, mark))) return false;
  if (mark.startsWith('gone.') && removerLives(mark)) return false;
  const gone = `gone.${lockTag()}`;
  try {
    fs.renameSync(path.join(dir, mark), path.join(dir, gone));
  } catch {
    return false;
  }
  for (const name of lockFiles(dir)) {
    if (name !== 'claim' && name !== gone) removed(path.join(dir, name));
  }
  removed(path.join(dir, 'claim'));
  removed(path.join(dir, gone));
  try {
    fs.rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
};

/**
 * A folder with no mark, once its run is over. Empty: removed. Else `id.orphan`
 * created create-only, then a look: no mark but `id.orphan` and exactly <seen>
 * besides is retired by `id.orphan`; anything else is false, its own
 * `id.orphan` taken back. A folder made in its place differs: a new taker's
 * first file is its `id.<tag>`.
 * @param {string} dir
 * @param {string[]} [seen] its file names as read with the absent mark, before
 *   the judge (retireJudged passes them); read here, at the call, when absent
 * @returns {boolean} whether the folder went
 */
const adoptLock = (dir, seen = lockFiles(dir)) => {
  try {
    fs.rmdirSync(dir);
    return true;
  } catch { /* it holds files, or it is gone */ }
  if (!isDir(dir)) return false;
  const orphan = path.join(dir, 'id.orphan');
  const made = created(orphan, '');
  const others = lockFiles(dir).filter((name) => name !== 'id.orphan');
  if (lockMark(dir) !== 'id.orphan' || others.join(' ') !== [...seen].sort().join(' ')) {
    if (made) removed(orphan);
    return false;
  }
  return retireLock(dir, 'id.orphan');
};

/**
 * The steps every remover shares: the mark is read first (with none, the file
 * names), then <judge> judges; on its true the lock is over, retired by that
 * mark or adopted against those names. Any other answer of the judge means not
 * over: nothing is removed and that answer comes back. A live remover's gone
 * mark is null, the judge never asked.
 * @param {string} dir
 * @param {function(string): *} judge true for a lock that is over; it may answer a promise
 * @returns {Promise<*>} true removed, false over but not removed (another caller
 *   was first), null a live remover's, or the judge's own other answer
 */
const retireJudged = async (dir, judge) => {
  const mark = lockMark(dir);
  if (mark?.startsWith('gone.') && removerLives(mark)) return null;
  const seen = mark ? [] : lockFiles(dir);
  const verdict = await judge(dir);
  if (verdict !== true) return verdict;
  return mark ? retireLock(dir, mark) : adoptLock(dir, seen);
};

/**
 * The state mutex's path in the machine folder <userDir>: the lock every
 * writer of the machine's own files takes.
 * @param {string} userDir
 * @returns {string}
 */
const stateLockPath = (userDir) => `${userDir}/.state.lock`;

/**
 * Take the mutex <dir>: its parent made, then claimDir tried 50 times 100ms
 * apart. Only a caller that took it drops it.
 * @param {string} dir
 * @returns {Promise<boolean>} whether it is held, false after the wait
 */
const takeLock = async (dir) => {
  try {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
  } catch {
    return false;
  }
  for (let tries = 0; tries < LOCK_TRIES; tries += 1) {
    if (claimDir(dir)) return true;
    await sleep(LOCK_PAUSE_MS);
  }
  return false;
};

/**
 * Drop the mutex <dir>: the claim goes first, then the folder, never both at
 * once, so a taker that claims it between the two keeps it.
 * @param {string} dir
 */
const dropLock = (dir) => {
  removed(path.join(dir, 'claim'));
  try {
    fs.rmdirSync(dir);
  } catch { /* a new taker holds it */ }
};

/**
 * Remove each regular file one folder under the markers folder (`markersDir`
 * of hooks/mods/markers.js, loaded here alone: a run with no root needs no
 * module of the hooks) whose mtime is older than MARKER_KEEP_DAYS; a folder
 * there (a lock) is never entered. It never fails a writer.
 * @param {string} home the machine folder
 */
const sweepMarkers = (home) => {
  const dir = require('../../hooks/mods/markers.js').markersDir(home);
  const oldest = Date.now() - MARKER_KEEP_DAYS * DAY_MS;
  let folders = [];
  try {
    folders = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return;
  }
  for (const folder of folders) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(dir, folder.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.filter((each) => each.isFile())) {
      const file = path.join(dir, folder.name, entry.name);
      try {
        if (fs.statSync(file).mtimeMs < oldest) fs.rmSync(file, { force: true });
      } catch { /* gone already, or another writer's */ }
    }
  }
};

/**
 * Write the marker <file> holding <text>, its folder made first, then sweep the
 * old markers: the one writer the marker verbs and the suite record share, so
 * each marker is made alike.
 * @param {string} file the marker's path (markerPath of hooks/mods/markers.js)
 * @param {string} home the machine folder
 * @param {string} [text] the marker's content, empty by default
 */
const writeMarker = (file, home, text = '') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  sweepMarkers(home);
};

module.exports = {
  claimDir, lockMark, retireLock, adoptLock, retireJudged, takeLock, dropLock, stateLockPath, sweepMarkers, writeMarker,
  lockTag, tagPid, pidAlive, isFile, isDir, DAY_MS,
};
