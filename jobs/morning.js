#!/usr/bin/env node
/**
 * jobs/morning.js: the morning, started by node from the 9am LaunchAgent and
 * the brief.yml workflow on the home repo, and by workflow/morning-task.js from
 * the 9am Windows task. A Node below the kit's floor gets one line and stops.
 * Six steps in one order, each gated on what the environment it woke up in
 * can do: jobs/README.md tells which runs where.
 * Usage: node morning.js [--now | message]. None is the scheduled morning;
 *        --now is the rehearsal, sent here and publishing nothing; a message
 *        is the generic headless runner. Log: ~/Library/Logs/claude-daily.log,
 *        or the Actions log.
 */

// Ahead of every other require, so no newer file loads below the floor; in
// syntax an older Node still reads, so the line prints there.
if (require.main === module) {
  const floor = require('../workflow/lib/floor');
  const below = floor.floorLine(process.version, floor.floorOf());
  if (below) {
    require('fs').writeSync(2, `${below}\n`);
    process.exit(1);
  }
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { holdSignals, Interrupted } = require('../workflow/lib/interrupt');
const { unreadPathStop } = require('../workflow/lib/platform');
const { withScratch } = require('../workflow/lib/scratch');
const { homeUserDir } = require('../workflow/user-dir');
const { enterMachine, machineHome } = require('./lib/machine');
const { logStamp, fileNotes, plainNotes } = require('./lib/notes');
const { summaries } = require('./morning/summaries');
const { reconcileRunner } = require('./morning/runner');
const { cloudBrief } = require('./morning/cloud-machine');
const { localSend, dispatch } = require('./morning/brief');
const { publishSite } = require('./morning/site');
const { recordBriefStatus } = require('./morning/marker');
const { runMorningD } = require('./morning/morning-d');

/**
 * The run every step is handed, from the arguments and the one clock read.
 * On a runner the machine folder is pinned for both halves of the run; on a
 * machine the folders a scheduler's PATH lacks go on PATH and the cwd is the
 * job's own work folder under ~/Library/Caches, since Claude Code's startup
 * scan from / trips macOS privacy prompts.
 * @param {string[]} args
 * @param {Date} now
 * @param {string} scratch the run's scratch folder
 * @returns {object}
 */
const newRun = (args, now, scratch) => {
  const manual = args[0] === '--now';
  const home = machineHome();
  // brief-payload.js writes the upstream-version line here; nothing in the
  // scratch folder outlives the run, since the cursor is the Discussion.
  const markFile = path.join(scratch, 'cc-version');
  process.env.WORKKIT_BRIEF_MARK_FILE = markFile;
  const run = {
    cloud: process.env.GITHUB_ACTIONS === 'true',
    manual,
    prompt: manual ? args.slice(1) : args,
    now,
    stamp: logStamp(now, manual),
    home,
    scratch,
    markFile,
  };
  if (run.cloud) {
    run.wkDir = homeUserDir(home);
    // The composers resolve ~/.workkit through os.homedir() and honor no
    // override: pinning WORKFLOW_HOME there keeps the run reading one home.
    process.env.WORKFLOW_HOME = run.wkDir;
    return { ...run, notes: plainNotes() };
  }
  enterMachine();
  run.workDir = path.join(home, 'Library', 'Caches', 'claude-daily');
  fs.mkdirSync(run.workDir, { recursive: true });
  process.chdir(run.workDir);
  run.logFile = path.join(home, 'Library', 'Logs', 'claude-daily.log');
  fs.mkdirSync(path.dirname(run.logFile), { recursive: true });
  return { ...run, notes: fileNotes(run.logFile, run.stamp) };
};

/**
 * The morning's steps. The scheduled morning and the rehearsal run every step;
 * a prompt is not a morning, so it is sent and nothing else runs.
 * @param {object} run
 * @returns {Promise<number>} main's code
 */
const morning = async (run) => {
  const day = run.prompt.length === 0;
  if (day) {
    await summaries(run);
    await reconcileRunner(run);
  }
  let sent = null;
  if (run.cloud) {
    const code = await cloudBrief(run);
    if (code !== undefined) return code;
  } else if (day && !run.manual) {
    await dispatch(run);
  } else {
    sent = await localSend(run);
    if (sent.stop !== undefined) return sent.stop;
  }
  if (day) {
    await publishSite(run);
    await recordBriefStatus(run);
    await runMorningD(run);
  }
  return sent === null ? 0 : sent.status;
};

/**
 * The morning in its scratch folder, removed however the run ends. An end
 * signal stops the morning at the next turn of the event loop (a sync child
 * runs to its end first); the folder still goes, then the signal ends the process.
 * @param {string[]} args
 * @returns {Promise<number>} 0; on a runner the stopping step's code; where the
 *   brief was sent here, the composer's code on a crash, else the send's
 */
const main = async (args) => {
  const now = new Date();
  const hold = holdSignals();
  let code = 0;
  try {
    code = await withScratch((scratch) => Promise.race([
      morning(newRun(args, now, scratch)),
      hold.signalled().then((signal) => { throw new Interrupted(signal); }),
    ]), 'morning-');
    if (code === null) throw new Error(`morning: no scratch folder could be made in ${os.tmpdir()}`);
  } catch (err) {
    if (!(err instanceof Interrupted)) throw err;
  } finally {
    await hold.end();
  }
  return code;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered
  // for a pipe. A code the hold's end set for a signal (Windows) stays.
  main(process.argv.slice(2)).then((code) => { process.exitCode ??= code; }, (err) => { process.exitCode = unreadPathStop(err); });
}

module.exports = { main };
