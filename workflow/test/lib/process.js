/**
 * Watching a process a suite started without waiting for it: whether a pid is
 * alive, a bounded poll for a condition, a pid read from the file a script
 * left, both streams of a captured child, the one spawn deadline and the
 * pipe grace.
 */

const fs = require('fs');

/**
 * The cap every spawn a suite makes carries (`timeout:` on spawnSync, the
 * `until` bound a case leaves unset): wide enough for a loaded pool, since a
 * case asserts order and never a duration.
 */
const SPAWN_DEADLINE = 60000;

// How long a child's pipes stay open past its exit, for a grandchild still
// holding them; the child's own output is already in the pipe by then.
const PIPE_GRACE_MS = 1000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Whether <pid> names a live process this user may signal. */
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/**
 * Poll <predicate> every 100 ms until it holds or <ms> pass; the caller's
 * assert names what never appeared.
 * @param {Function} predicate
 * @param {number} [ms]
 * @returns {Promise<boolean>} the predicate's last answer
 */
const until = async (predicate, ms = SPAWN_DEADLINE) => {
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
const elapsedUntil = async (predicate, ms = SPAWN_DEADLINE) => {
  const begin = Date.now();
  while (Date.now() - begin < ms) {
    if (predicate()) return Date.now() - begin;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  return predicate() ? Date.now() - begin : Infinity;
};

/** The pid a script wrote to <file>, as a number. */
const readPid = (file) => Number(fs.readFileSync(file, 'utf8').trim());

/**
 * What the user actually sees: both streams of a child spawned with piped
 * stdout and stderr, in one string, read through the returned function.
 * @param {import('child_process').ChildProcess} child
 * @returns {Function}
 */
const collect = (child) => {
  let out = '';
  child.stdout.on('data', (chunk) => { out += chunk.toString(); });
  child.stderr.on('data', (chunk) => { out += chunk.toString(); });
  return () => out;
};

module.exports = {
  SPAWN_DEADLINE, PIPE_GRACE_MS, alive, until, elapsedUntil, readPid, collect,
};
