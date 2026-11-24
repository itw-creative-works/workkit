/**
 * jobs/morning/morning-d.js: the morning's last step, the owner's own scripts
 * in `<user dir>/morning.d`, in name order, each in its own log block under the
 * job's bound. A failure or a hang is a warning naming it, and the next one
 * still runs (jobs/README.md § The morning on this machine).
 * Usage: const { runMorningD } = require('./morning-d');
 */

const fs = require('fs');
const path = require('path');
const { isDir, isFile } = require('../../workflow/lib/lock');
const { executable } = require('../../workflow/lib/participation');
const { userDir } = require('../../workflow/user-dir');
const { bounded } = require('../lib/machine');
const { heading } = require('../lib/notes');

/** The folder's scripts as the shell's `*.sh` glob lists them: no dot files, in name order. */
const scriptsIn = (dir) => fs.readdirSync(dir)
  .filter((name) => name.endsWith('.sh') && !name.startsWith('.'))
  .sort()
  .map((name) => path.join(dir, name));

/**
 * One script, run as the shell runs it, its block in the log: the heading
 * first, so a script that writes the log itself lands under it. Its streams
 * are the log itself, never pipes, so its lines land in the order they
 * happened and a child it leaves behind holds nothing open on the morning.
 * @param {object} run the morning's run
 * @param {string} script
 */
const runScript = async (run, script) => {
  const name = path.basename(script);
  fs.appendFileSync(run.logFile, heading(`${run.stamp} morning.d/${name}`));
  const env = {
    ...process.env, LOG_FILE: run.logFile, MANUAL: run.manual ? '1' : '0', WORK_DIR: run.workDir,
  };
  const fd = fs.openSync(run.logFile, 'a');
  let ended;
  try {
    ended = await bounded('bash', ['-c', '"$0"', script], { env, stdio: ['ignore', fd, fd] });
  } finally {
    fs.closeSync(fd);
  }
  const { status, output, timedOut } = ended;
  // The output holds only bounded's own lines: a start that failed, a tree it could not end.
  fs.appendFileSync(run.logFile, `${output}\n`);
  if (timedOut) run.notes.noteWarn(`morning.d: ${name} ran past the job's bound and was ended; the next script still runs`);
  else if (status !== 0) run.notes.noteWarn(`morning.d: ${name} exit ${status}; the next script still runs`);
};

/**
 * The morning.d step.
 * @param {object} run the morning's run
 * @returns {Promise<void>}
 */
const runMorningD = async (run) => {
  if (run.cloud) {
    run.notes.noteSkip('morning.d: a runner owns no scripts folder; skipped');
    return;
  }
  const dir = path.join(userDir(), 'morning.d');
  if (!isDir(dir)) return;
  for (const script of scriptsIn(dir)) {
    if (isFile(script) && executable(script)) await runScript(run, script);
  }
};

module.exports = { runMorningD };
