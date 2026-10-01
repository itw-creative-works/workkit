/**
 * Watching a process a suite started without waiting for it: whether a pid is
 * alive, a bounded poll for a condition, a pid read from the file a script left,
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
  alive, until, readPid, collect,
};
