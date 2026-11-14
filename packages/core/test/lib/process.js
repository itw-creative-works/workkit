/**
 * Watching a process a suite started without waiting for it: whether a pid is
 * alive, a bounded poll for a condition, a pid read from the file a script
 * left (at once, or as none until it is whole), and the deadlines: the spawn
 * deadline, the case deadline, the suite deadline and the pipe grace.
 */

import fs from 'node:fs';

/**
 * The cap every spawn a suite makes carries (`timeout:` on spawnSync, the
 * `until` bound a case leaves unset): wide enough for a loaded pool, since a
 * case asserts order and never a duration.
 */
export const SPAWN_DEADLINE = 60000;

// The `timeout` the door's `test` and `it` give a case that states none.
export const CASE_DEADLINE = 120000;

// How long the runner waits for one suite file's worker to close before it
// ends the worker's process group; `TEST_DEADLINE=<seconds>` sets it for a run.
export const SUITE_DEADLINE = 600000;

// How long a child's pipes stay open past its exit, for a grandchild still
// holding them; the child's own output is already in the pipe by then.
export const PIPE_GRACE_MS = 1000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Whether <pid> names a live process this user may signal; false for anything
 * but a positive integer, since 0 or a negative pid reaches a whole group.
 */
export const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/**
 * Poll <predicate> every 100 ms until it holds or <ms> pass; the caller's
 * assert names what never appeared.
 * @param {Function} predicate
 * @param {number} [ms]
 * @returns {Promise<boolean>} the predicate's last answer
 */
export const until = async (predicate, ms = SPAWN_DEADLINE) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(100);
  }
  return predicate();
};

/**
 * Poll <predicate> every millisecond until it holds or <ms> pass, for a spawn
 * a case must catch on sight: until's 100 ms step is too coarse.
 * @param {Function} predicate
 * @param {number} [ms]
 * @returns {Promise<number>} the milliseconds it took, or Infinity if it never held
 */
export const elapsedUntil = async (predicate, ms = SPAWN_DEADLINE) => {
  const begin = Date.now();
  while (Date.now() - begin < ms) {
    if (predicate()) return Date.now() - begin;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  return predicate() ? Date.now() - begin : Infinity;
};

/** The pid a script wrote to <file>, as a number. */
export const readPid = (file) => Number(fs.readFileSync(file, 'utf8').trim());

/**
 * The pid <file> holds, or 0 while it is absent, empty or not yet a whole
 * number: a shell's `echo $$ >` leaves the file empty between opening and
 * writing it. 0, never a pid, since a signal to 0 reaches the caller's group.
 * @param {string} file
 * @returns {number}
 */
export const pidIn = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return 0;
    throw e;
  }
  return /^\d+\s*$/.test(text) ? Number(text.trim()) : 0;
};
