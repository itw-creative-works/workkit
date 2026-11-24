/**
 * workflow/lib/scratch.js: the scratch folder's one frame, a folder under the
 * temp folder made for one piece of work and removed whatever the work did.
 * Usage: const { withScratch } = require('../lib/scratch');
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * A scratch folder for `run`, removed whatever `run` did, a throw included;
 * an async `run`'s folder goes once its promise settles.
 * @template T
 * @param {(scratch: string) => T} run
 * @param {string} [prefix] the folder's name before mkdtemp's random tail
 * @returns {T|null} what `run` handed back; null, `run` never called, when no folder could be made
 */
const withScratch = (run, prefix = 'workkit.') => {
  let scratch;
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  } catch {
    return null;
  }
  const remove = () => fs.rmSync(scratch, { recursive: true, force: true });
  let out;
  try {
    out = run(scratch);
  } catch (err) {
    remove();
    throw err;
  }
  if (out instanceof Promise) return out.finally(remove);
  remove();
  return out;
};

module.exports = { withScratch };
