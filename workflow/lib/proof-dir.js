/**
 * workflow/lib/proof-dir.js: a proof run's folder, CJS: `proof/` in the kit's
 * cache folder (cacheDirOf in hooks/mods/log.js), where `workkit prove` and
 * `workkit proof red` each make theirs, and the sweep of the old ones.
 * Usage: const { proofBase, proofDir } = require('./proof-dir');
 */

const fs = require('fs');
const path = require('path');
const { DAY_MS } = require('./lock');
const { cacheDirOf } = require('../../hooks/mods/log.js');
const { shellEnvOf } = require('../../hooks/mods/markers.js');

// The days a run folder outlives its last change; proofDir removes older.
const PROOF_KEEP_DAYS = 1;

/**
 * The folder every proof run folder lives under, `~/.cache/workkit/proof`:
 * HOME moves it, TMPDIR and WORKFLOW_HOME do not.
 * @returns {string}
 */
const proofBase = () => `${cacheDirOf(shellEnvOf(process.env, process.platform))}/proof`;

/** Each run folder under `base` last changed over PROOF_KEEP_DAYS ago removed, save one holding `live` or one that will not go. */
const sweep = (base, now) => {
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const run = path.join(base, entry.name);
    try {
      if (now - fs.lstatSync(run).mtimeMs <= PROOF_KEEP_DAYS * DAY_MS || fs.existsSync(path.join(run, 'live'))) continue;
      fs.rmSync(run, { recursive: true, force: true });
    } catch {
      // A folder the sweep cannot remove waits for a later run.
    }
  }
};

/**
 * A new run folder, `<proofBase>/<six characters>`, made after the sweep, since
 * no system cleaner reaches the cache folder. A `--live` run that could not
 * restore the live tree keeps its only copy of the live files in `live`.
 * @returns {string|null} the folder, null when none can be made
 */
const proofDir = () => {
  const base = proofBase();
  try {
    fs.mkdirSync(base, { recursive: true });
    sweep(base, Date.now());
    return fs.mkdtempSync(`${base}/`);
  } catch {
    return null;
  }
};

module.exports = { proofBase, proofDir };
