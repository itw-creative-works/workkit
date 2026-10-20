/**
 * Watching a process a suite started without waiting for it: whether a pid is
 * alive, a bounded poll for a condition (or one timed to the millisecond), a pid
 * read from the file a script left,
 * and both streams of a captured child. Consumers: the tower start, ci-watch,
 * detach and script-shell suites.
 */

const fs = require('fs');

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
const until = async (predicate, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await sleep(100);
  }
  return predicate();
};

/**
 * Poll <predicate> every millisecond until it holds or <ms> pass, for a wait
 * that is itself the measurement: until's 100 ms step is too coarse to time a
 * shutdown or catch a spawn on sight.
 * @param {Function} predicate
 * @param {number} [ms]
 * @returns {Promise<number>} the milliseconds it took, or Infinity if it never held
 */
const elapsedUntil = async (predicate, ms = 8000) => {
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
  alive, until, elapsedUntil, readPid, collect,
};
