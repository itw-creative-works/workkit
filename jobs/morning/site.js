/**
 * jobs/morning/site.js: the morning's site publish, the engine's own
 * publish.js in a process of its own, bounded. It runs whether or not the day
 * was handed over, since the site is this machine's to build; every reason not
 * to publish is the engine's own logged skip.
 * Usage: const { publishSite } = require('./site');
 */

const path = require('path');
const { isFile } = require('../../workflow/lib/lock');
const { bounded } = require('../lib/machine');
const { block, captured } = require('../lib/notes');

const PUBLISH = path.join(__dirname, '..', '..', 'workflow', 'publish.js');

/**
 * The publish step. A seeded runner carries the brief's closure and no
 * publish, so the question here is only whether there is one to run.
 * @param {object} run the morning's run
 * @returns {Promise<void>}
 */
const publishSite = async (run) => {
  if (run.cloud) {
    run.notes.noteSkip('publish: the site is built from the home clone on a machine; a runner has neither, skipped');
    return;
  }
  if (!isFile(PUBLISH)) return;
  const { status, output } = await bounded(process.execPath, [PUBLISH, '--quiet']);
  const said = captured(output);
  if (status !== 0) block(run.logFile, run.stamp, `[publish exit ${status}; the brief was already sent]\n${said}\n`);
  else if (said) block(run.logFile, run.stamp, `${said}\n`);
};

module.exports = { publishSite };
