/* eslint-disable no-console */
// workflow/lib/runs.js: a detached run, one Node process from the lock to the
// answer, CJS: `run` takes the lock (lib/run-lock.js), launches the supervisor
// (lib/detach.js) and attaches (lib/attach.js), its answers handed back in process.
// Usage: const { run } = require('./runs');

const fs = require('fs');
const path = require('path');
const { spawn } = require('./run');
const {
  signalCode, exitOf, isSupervised, END_SIGNALS, INT_CODE,
} = require('./detach');
const { attachRun, runForeground } = require('./attach');
const { retireLock } = require('./lock');
const runLock = require('./run-lock');

const {
  takeRunLock, writePid, leaveRecord, dropRunLock, askEnd, doneCode,
} = runLock;

const DETACH = path.join(__dirname, 'detach.js');

/**
 * The launcher in a process of its own, `node detach.js`, gone once it printed
 * the supervisor's pid: so the supervisor has no live parent, and no end of a
 * process tree by parent links reaches the run through this call.
 * @param {string[]} argv `<log> <done> [--root <root>] -- <cmd> [args...]`
 * @param {object} env the launcher's environment, which the supervisor inherits
 * @returns {Promise<{code: number, pid?: number}>}
 */
const launchApart = (argv, env) => new Promise((resolve) => {
  let out = '';
  const launcher = spawn(process.execPath, [DETACH, ...argv], { env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  launcher.stdout.on('data', (chunk) => { out += chunk; });
  launcher.on('error', (err) => {
    console.error(`detach: ${err.message}`);
    resolve({ code: 1 });
  });
  launcher.on('close', (code, signal) => {
    const pid = Number(out.trim());
    if (code === 0 && Number.isInteger(pid) && pid > 0) resolve({ code: 0, pid });
    else resolve({ code: exitOf(code, signal) || 1 });
  });
});

/**
 * An interrupt of an attached call: the supervisor asked to end the run, its
 * code left as a record for another attached call; a run still going when the
 * wait runs out loses its process group, and keeps its lock when that end
 * fails, since it still runs.
 * @param {string} lock
 * @param {number} pid the supervisor's
 * @param {{endRun?: function(number): Promise<boolean>}} [seams] the end of a run's processes, run-lock.js's by default
 * @returns {Promise<boolean>} false only when that end failed, the lock kept
 */
const endOnInt = async (lock, pid, { endRun = runLock.endRun } = {}) => {
  if (await askEnd(lock, pid) === 0) {
    const code = doneCode(lock);
    if (/^\d+$/.test(code)) await leaveRecord(lock, pid, code);
  } else if (!(await endRun(pid))) {
    return false;
  }
  await dropRunLock(lock, pid);
  return true;
};

/** A run's answers: its exit code, then the rest, each empty unless given. */
const answered = (rc, answers = {}) => ({
  rc, held: null, code: null, look: false, int: false, ...answers,
});

/**
 * `run`: the lock taken, the supervisor launched and attached to from the log's first byte.
 * Until the pid is written a HUP, INT or TERM retires the pidless lock and ends the process
 * with its code, an INT once run has handed its caller `int`; after it, INT ends the whole
 * run, HUP and TERM the process alone. Under a supervisor already the command runs here.
 * @param {{log: string, lock: string, root: (string|null), argv: string[]}} job
 * @param {{launch?: function(string[], object): ({code: number, pid?: number}|Promise<object>), endRun?: function}} [seams]
 *   the launcher, `node detach.js` apart by default (one that answers a promise holds the run
 *   between the take and the pid write), and the interrupt's endRun (endOnInt's)
 * @returns {Promise<{rc: number, held: (number|null), code: (number|null), look: boolean, int: boolean}>}
 *   the exit code; a live holder's pid with 3; the code the command recorded; a look; an interrupt
 */
const run = async ({
  log, lock, root, argv,
}, { launch = launchApart, endRun = runLock.endRun } = {}) => {
  if (isSupervised(process.env)) {
    const done = await runForeground(log, lock, argv);
    return answered(done.rc, { held: done.held ?? null, code: done.code });
  }
  const state = { mark: null, pid: null, ending: null };
  const stop = new AbortController();
  let interrupt;
  const interrupted = new Promise((resolve) => { interrupt = resolve; });
  const onSignal = (signal) => {
    if (state.pid === null) {
      if (state.mark !== null) retireLock(lock, state.mark);
      if (signal !== 'SIGINT') process.exit(signalCode(signal));
      // The caller's answer first, then the process ends at the loop's next check phase; a
      // take or launch in flight may still finish a step before then, and nothing waits for it.
      setImmediate(() => process.exit(INT_CODE));
      interrupt(answered(INT_CODE, { int: true }));
      return;
    }
    if (signal !== 'SIGINT') process.exit(signalCode(signal));
    if (state.ending !== null) return;
    state.ending = endOnInt(lock, state.pid, { endRun });
    stop.abort();
  };
  for (const signal of END_SIGNALS) process.on(signal, onSignal);
  const attached = async () => {
    const taken = await takeRunLock(lock);
    if (taken.code !== 0) return answered(taken.code, { held: taken.held ?? null });
    state.mark = taken.mark;
    let started = { code: 1 };
    try {
      fs.mkdirSync(path.dirname(log), { recursive: true });
      // The run's own lock, so a call inside it under the same lock runs in its stead.
      started = await launch([log, path.join(lock, 'done'), ...(root === null ? [] : ['--root', root]), '--', ...argv],
        { ...process.env, WK_RUN_LOCK: lock });
    } catch (err) {
      console.error(`detach: ${err.message}`);
    }
    if (started.code !== 0) {
      retireLock(lock, state.mark);
      console.error(`detach: could not start ${argv[0]} (log ${log})`);
      return answered(started.code);
    }
    writePid(lock, started.pid);
    state.pid = started.pid;
    const done = await attachRun(log, lock, started.pid, 0, { signal: stop.signal });
    if (state.ending !== null) {
      await state.ending;
      return answered(INT_CODE, { int: true });
    }
    return answered(done.rc, { code: done.code, look: done.look });
  };
  return Promise.race([attached(), interrupted]);
};

module.exports = { run, endOnInt };
