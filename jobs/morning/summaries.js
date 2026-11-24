/**
 * jobs/morning/summaries.js: the morning's first step, the day written up by
 * claude-nightly.js in a process of its own, bounded. A failure there is never
 * the brief's: it is logged and the morning carries on (jobs/README.md § The
 * morning on this machine).
 * Usage: const { summaries } = require('./summaries');
 */

const path = require('path');
const { isDir } = require('../../workflow/lib/lock');
const { onPath } = require('../../workflow/lib/run');
const { bounded, projectsRoot } = require('../lib/machine');
const { block, captured } = require('../lib/notes');

const NIGHTLY = path.join(__dirname, '..', 'claude-nightly.js');

/**
 * Whether this machine has a day to write up: the session transcripts and git
 * to read the roster's log. A runner has neither, which is why this is asked
 * rather than a mode passed in.
 * @param {string} home
 * @returns {boolean}
 */
const haveHistory = (home) => isDir(process.env.WORKKIT_CLAUDE_PROJECTS || projectsRoot(home))
  && onPath('git') !== null;

/**
 * The summaries step.
 * @param {object} run the morning's run
 * @returns {Promise<void>}
 */
const summaries = async (run) => {
  if (run.cloud) {
    run.notes.noteSkip('summaries: a GitHub Actions runner has no session transcripts and no git history to write up; skipped');
    return;
  }
  if (!haveHistory(run.home)) {
    run.notes.noteSkip('summaries: this machine has no session transcripts to read; skipped');
    return;
  }
  const { status, output } = await bounded(process.execPath, [NIGHTLY]);
  if (status !== 0) block(run.logFile, run.stamp, `[summaries exit ${status}; the brief continues]\n${captured(output)}\n`);
};

module.exports = { summaries };
