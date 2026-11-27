/**
 * jobs/morning/runner.js: the morning's reconcile of the cloud brief's runner
 * in the home clone, before the dispatch whose cloud run consumes what it
 * pushes. Each step is a verb of home.js in its own process; it creates,
 * clones or enables nothing (jobs/README.md § The morning on this machine).
 * Usage: const { reconcileRunner } = require('./runner');
 */

const fs = require('fs');
const path = require('path');
const { nativePath } = require('../../workflow/lib/platform');
const { spawnSync } = require('../../workflow/lib/run');
const { plain, said } = require('../../workflow/lib/voice');
const { towerDir } = require('../../workflow/user-dir');
const { chomp } = require('../../hooks/mods/text.js');

const HOME_JS = path.join(__dirname, '..', '..', 'workflow', 'home.js');

const WARNED = /^ *(⚠|✖) /m;

/**
 * The reconcile's verbs, each a home.js in its own process with the caller's
 * voice, both its streams into one record in the order they came, as the
 * command's hand-off (homeRun in workflow/workkit/kit.js) runs them.
 * @param {string} record the file the reconcile's lines are kept in
 * @returns {{verb: function, line: function}}
 */
const reconcilerOf = (record) => {
  const env = {
    ...process.env, WK_LOG_STDERR: process.env.WK_LOG_STDERR || '0', WK_LOG_INDENT: '', QUIET: process.env.QUIET || '0',
  };
  return {
    verb: (args, { answer = false } = {}) => {
      const fd = fs.openSync(record, 'a');
      try {
        return spawnSync(process.execPath, [HOME_JS, ...args], {
          env, encoding: 'utf8', stdio: ['ignore', answer ? 'pipe' : fd, fd], windowsHide: true,
        });
      } finally {
        fs.closeSync(fd);
      }
    },
    line: (level, message) => fs.appendFileSync(record, `${said(level, message, false)}\n`),
  };
};

/**
 * The reconcile itself: ready, else why not; the clone caught up; the seed;
 * and a commit only for a copy that moved.
 * @param {{verb: function, line: function}} reconciler
 */
const reconcile = ({ verb, line }) => {
  const home = nativePath(towerDir());
  if (verb(['ready']).status !== 0) {
    const state = chomp(verb(['state'], { answer: true }).stdout);
    if (state === 'unset') line('skip', 'runner: no home repo; `workkit setup` creates one; nothing to reconcile');
    else if (state === 'absent') line('skip', `runner: nothing is cloned at ${home} yet; the cloud brief runner was not reconciled; \`workkit setup\` clones it`);
    else if (state === 'other') line('warn', `runner: ${home} is not the home repo's clone; nothing is reconciled in somebody else's folder`);
    return;
  }
  // The seed judges from the working copy, so the clone is caught up first.
  if (verb(['catch-up', 'runner']).status !== 0) {
    line('skip', 'runner: the runner was not refreshed');
    return;
  }
  // 0 is a copy that moved, the only answer worth a commit; 2 is a runner
  // already current, and 1 has warned and left the clone as it was.
  if (verb(['seed-runner']).status !== 0) return;
  verb(['commit-push', 'chore(home): refresh the cloud brief runner']);
};

/**
 * The runner step: the reconcile's lines relayed as one note, its glyph
 * picked by whether any of them warned.
 * @param {object} run the morning's run
 * @returns {Promise<void>}
 */
const reconcileRunner = async (run) => {
  if (run.cloud) {
    run.notes.noteSkip('runner: a runner IS the seeded copy of the cloud brief; there is no kit here to reconcile it from, skipped');
    return;
  }
  const record = path.join(run.scratch, 'runner');
  reconcile(reconcilerOf(record));
  const text = chomp(fs.existsSync(record) ? fs.readFileSync(record, 'utf8') : '');
  const relayed = chomp(plain(text));
  if (!relayed) return;
  if (WARNED.test(text)) run.notes.noteWarn(relayed);
  else run.notes.note(relayed);
};

module.exports = { reconcileRunner };
