/**
 * jobs/lib/schedule.js: what both halves of jobs/install.js share, the launchd
 * agent's and the Task Scheduler task's: whether the kept file is current, and
 * the line a run kept from the scheduler says.
 * Usage: const { holds, skippedLine } = require('./lib/schedule');
 */

const fs = require('fs');

/** Whether <file> holds exactly <text>; a file that cannot be read does not. */
const holds = (file, text) => {
  try {
    return fs.readFileSync(file).equals(Buffer.from(text));
  } catch (err) {
    if (!err.code) throw err;
    return false;
  }
};

/** `<label> → would <what> (skipped ...)`: what a run kept from the scheduler would have done. */
const skippedLine = (label, what) => `${label} → would ${what} (skipped: HOME is not this account's home; set WORKKIT_SCHEDULE_OK=1 to force)`;

module.exports = { holds, skippedLine };
