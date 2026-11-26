/**
 * workflow/morning-task.js: the program the 9am Task Scheduler task starts. It
 * starts jobs/morning.js of the real kit as a hidden process of its own, its
 * output appended to the job's log, and ends at once. It lives in workflow/
 * because the engine address names this folder (jobs/README.md).
 * Usage: node ~/.claude/workkit/morning-task.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('./lib/run');
const { isFile } = require('./lib/lock');
const { machineHome } = require('../jobs/lib/machine');

/** The morning of the kit this file is in: Node loads a file by its real path, so a linked folder still reaches the real kit. */
const jobFile = () => path.join(__dirname, '..', 'jobs', 'morning.js');

/** The log the starter's child writes to under `home`, the one the launchd agent writes to. */
const logFile = (home) => path.join(home, 'Library', 'Logs', 'com.workkit.claude-daily.log');

/**
 * Starts `node job` detached and hidden, stdin closed, stdout and stderr
 * appended to `log`, and answers once it has started, never waiting for it.
 * A job that cannot start is one `morning-task: could not start` line in the log.
 * @param {{ job: string, log: string, node?: string }} task
 * @returns {Promise<number>} 0 started; 1 not started
 */
const morningTask = ({ job, log, node = process.execPath }) => {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'a');
  const failed = (reason) => {
    fs.writeSync(fd, `morning-task: could not start ${job}: ${reason}\n`);
    fs.closeSync(fd);
    return 1;
  };
  if (!isFile(job)) return Promise.resolve(failed('no such file'));
  return new Promise((resolve) => {
    const child = spawn(node, [job], {
      detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
    });
    child.once('spawn', () => {
      fs.closeSync(fd);
      child.unref();
      resolve(0);
    });
    child.once('error', (err) => resolve(failed(err.message)));
  });
};

/** The program: the morning of this kit, logged under this account's home. */
const main = () => morningTask({ job: jobFile(), log: logFile(machineHome()) });

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main().then((code) => { process.exitCode = code; });
}

module.exports = { jobFile, logFile, morningTask };
