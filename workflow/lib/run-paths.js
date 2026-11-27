/**
 * workflow/lib/run-paths.js: where a detached run logs and locks, CJS: the
 * suite's, the supervised run's, the CI watch's and a narrowed run's slot, keyed
 * by the root as `git rev-parse --show-toplevel` prints it; the slots a repo
 * holds, and a slot cleared.
 * Usage: const { runPaths, testSlots, clearSlot } = require('./run-paths');
 *        const { logPathOf } = require('./run-paths');   (a log of any name, the command log's)
 */

const fs = require('fs');
const { spawnSync } = require('./run');
const { settingsAt } = require('./settings');
const { home } = require('./records');
const { slotsAt } = require('./run-lock');
const { markerPath } = require('../../hooks/mods/markers.js');
const { logPlaceOf } = require('../../hooks/mods/commit-gate.js');

// Each run's lock, a marker folder, and its log's name.
const RUNS = {
  suite: { lock: 'claude-suite-lock', log: 'suite.log' },
  run: { lock: 'claude-run-lock', log: 'run.log' },
  ci: { lock: 'claude-ci-watch-lock', log: 'ci.log' },
  test: { lock: 'claude-test-lock', log: 'test.log' },
};

/** A `logs.dir` that names no folder inside the repo; its message is the line that says so. */
class LogsDirError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LogsDirError';
  }
}

/**
 * Where a log goes (logPlaceOf): <name> in the log folder only when git
 * ignores it there, else the marker path `claude-<name>`, so a log never
 * changes the tree hash. An <id> ends the name in both places.
 */
const logPathOf = async (root, name, id) => {
  const place = logPlaceOf(settingsAt(root), name, id);
  if ('error' in place) throw new LogsDirError(place.error);
  const ignored = spawnSync('git', ['-C', root, 'check-ignore', '-q', place.rel], { stdio: 'ignore', windowsHide: true }).status === 0;
  return ignored ? `${root}/${place.rel}` : `${await markerPath(place.marker, root, home())}${place.suffix}`;
};

/**
 * A run's lock folder: the marker path of its lock, a narrowed run's ended
 * with `.<slot>` (an empty slot answers the slots' common base).
 * @param {string} root
 * @param {string} which `suite`, `run`, `ci` or `test`
 * @param {number|string} [slot] the pid of a narrowed run's script-shell.js
 * @returns {Promise<string>}
 */
const lockPathOf = async (root, which, slot = '') => {
  const lock = await markerPath(RUNS[which].lock, root, home());
  return which === 'test' ? `${lock}.${slot}` : lock;
};

/**
 * A run's log and lock.
 * @param {string} root
 * @param {string} which `suite`, `run`, `ci` or `test`
 * @param {number|string} [slot] the pid of a `test` run's script-shell.js
 * @returns {Promise<{log: string, lock: string}>}
 * @throws {LogsDirError} a `logs.dir` outside the repo
 */
const runPaths = async (root, which, slot = '') => ({
  log: await logPathOf(root, RUNS[which].log, which === 'test' ? String(slot) : ''),
  lock: await lockPathOf(root, which, slot),
});

/**
 * The pid of each narrowed run whose lock folder stands, live or not.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
const testSlots = async (root) => slotsAt(await lockPathOf(root, 'test'));

/**
 * A narrowed run's log and its lock's record removed at its paths, at once, so
 * a process about to end still finishes it.
 * @param {{log: string, lock: string}} paths runPaths' answer for the slot
 */
const removeSlot = ({ log, lock }) => {
  fs.rmSync(log, { force: true });
  fs.rmSync(`${lock}.done`, { force: true });
};

/**
 * A narrowed run's log and its lock's record removed, once a call has read its
 * end (the lock is dropped already).
 * @param {string} root
 * @param {number|string} pid the slot's
 * @returns {Promise<void>}
 */
const clearSlot = async (root, pid) => removeSlot(await runPaths(root, 'test', pid));

module.exports = {
  runPaths, lockPathOf, testSlots, clearSlot, removeSlot, LogsDirError, logPathOf,
};
