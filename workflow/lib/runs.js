#!/usr/bin/env node
/* eslint-disable no-console */
// workflow/lib/runs.js: the command over a detached run, one Node process from
// the lock to the answer: `run` takes the lock (lib/run-lock.js), launches the
// supervisor (lib/detach.js) and attaches (lib/attach.js). lib/detach.sh's
// names run it, and read its answers from the answer file, a line each.
// Usage: node runs.js <verb> ...   (USAGE below; a yes or no is the exit code)

const fs = require('fs');
const path = require('path');
const { spawn } = require('./run');
const { signalCode } = require('./detach');
const { attachRun, runForeground } = require('./attach');
const { retireLock } = require('./lock');
const runLock = require('./run-lock');

const {
  takeRunLock, runLive, runHeld, writePid, leaveRecord, dropRunLock, askEnd, sweepSlots, doneCode,
} = runLock;

const DETACH = path.join(__dirname, 'detach.js');

const USAGE = [
  'usage: runs.js run <log> <lock> [--root <root>] --answer <file> -- <cmd> [args...]',
  '     | runs.js attach <log> <lock> <pid> [<offset>] --answer <file>',
  '     | runs.js ask-end <lock> <pid> | runs.js live <lock> | runs.js held <lock> | runs.js sweep-slots <base>',
].join('\n');

// The code an interrupted call exits with: a shell's for a command INT ended.
const INT_CODE = signalCode('SIGINT');

/**
 * The answer file written: one `<name>=<digits>` line per answer that applies,
 * true written as 1. The shell sources it, so any other value throws.
 */
const answerTo = (file, answers) => {
  const lines = Object.entries(answers)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([name, value]) => [name, value === true ? 1 : value]);
  const bad = lines.find(([, value]) => !Number.isInteger(value) || value < 0);
  if (bad) throw new Error(`runs: the answer ${bad[0]} must be a whole number, got ${bad[1]}`);
  fs.writeFileSync(file, lines.map(([name, value]) => `${name}=${value}\n`).join(''));
};

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
    else resolve({ code: code === null ? signalCode(signal) : code || 1 });
  });
});

/** `run`'s arguments, or null when they are not its shape. */
const runArgs = ([log, lock, ...rest]) => {
  let at = 0;
  let root = null;
  if (rest[at] === '--root') {
    root = rest[at + 1];
    at += 2;
  }
  const answer = rest[at] === '--answer' ? rest[at + 1] : null;
  const argv = rest.slice(at + 3);
  if (!log || !lock || root === '' || root === undefined || !answer || rest[at + 2] !== '--' || argv.length === 0) return null;
  return {
    log, lock, root, answer, argv,
  };
};

/** `attach`'s arguments, or null when they are not its shape. */
const attachArgs = (args) => {
  const at = args.indexOf('--answer');
  if (at < 3 || at > 4 || args.length !== at + 2) return null;
  const [log, lock, pid, offset = '0'] = args.slice(0, at);
  if (!log || !lock || !/^\d+$/.test(pid) || !/^\d+$/.test(offset)) return null;
  return {
    log, lock, pid: Number(pid), offset: Number(offset), answer: args[at + 1],
  };
};

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
    if (/^\d+$/.test(code)) leaveRecord(lock, pid, code);
  } else if (!(await endRun(pid))) {
    return false;
  }
  await dropRunLock(lock, pid);
  return true;
};

/**
 * `run`: the lock taken, the supervisor launched and attached to from the
 * log's first byte. Until the pid is written a HUP, INT or TERM retires the
 * pidless lock by its mark and exits; after it, INT ends the whole run, HUP and
 * TERM end this call alone. Under a supervisor already the command runs here.
 * @param {{log: string, lock: string, root: (string|null), answer: string, argv: string[]}} job
 * @param {{launch?: function(string[], object): ({code: number, pid?: number}|Promise<object>), endRun?: function}} [seams]
 *   the launcher, `node detach.js` apart by default (one that answers a promise holds the run
 *   between the take and the pid write), and the interrupt's endRun (endOnInt's)
 * @returns {Promise<number>} the exit code, the answers in the answer file
 */
const run = async ({
  log, lock, root, answer, argv,
}, { launch = launchApart, endRun = runLock.endRun } = {}) => {
  if (process.env.WORKKIT_SUPERVISED === '1') {
    const done = await runForeground(log, lock, argv);
    answerTo(answer, { held: done.held, code: done.code });
    return done.rc;
  }
  const state = { mark: null, pid: null, ending: null };
  const stop = new AbortController();
  const onSignal = (signal) => {
    if (state.pid === null) {
      if (state.mark !== null) retireLock(lock, state.mark);
      answerTo(answer, { int: signal === 'SIGINT' });
      process.exit(signalCode(signal));
    }
    if (signal !== 'SIGINT') process.exit(signalCode(signal));
    if (state.ending !== null) return;
    state.ending = endOnInt(lock, state.pid, { endRun });
    stop.abort();
  };
  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) process.on(signal, onSignal);
  const taken = await takeRunLock(lock);
  if (taken.code !== 0) {
    answerTo(answer, { held: taken.held });
    return taken.code;
  }
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
    return started.code;
  }
  writePid(lock, started.pid);
  state.pid = started.pid;
  const done = await attachRun(log, lock, started.pid, 0, { signal: stop.signal });
  if (state.ending !== null) {
    await state.ending;
    answerTo(answer, { int: true });
    return INT_CODE;
  }
  answerTo(answer, { code: done.code, look: done.look });
  return done.rc;
};

/**
 * `attach`: a call attached again to a run going, or one that ended with no
 * call attached. An INT ends this call alone, the run and its lock as they are.
 */
const attach = async ({
  log, lock, pid, offset, answer,
}) => {
  const stop = new AbortController();
  process.on('SIGINT', () => stop.abort());
  const done = await attachRun(log, lock, pid, offset, { signal: stop.signal });
  answerTo(answer, { code: done.code, look: done.look });
  return done.stopped ? INT_CODE : done.rc;
};

/** A read's answer: the pid printed and 0, or 1. */
const printed = (pid) => {
  if (pid === null) return 1;
  console.log(pid);
  return 0;
};

// Each verb: its argument check and its call.
const VERBS = {
  run: [runArgs, run],
  attach: [attachArgs, attach],
  'ask-end': [(args) => (args.length === 2 && args[0] && args[1] ? args : null), ([lock, pid]) => askEnd(lock, pid)],
  live: [(args) => (args.length === 1 && args[0] ? args : null), ([lock]) => printed(runLive(lock))],
  held: [(args) => (args.length === 1 && args[0] ? args : null), ([lock]) => printed(runHeld(lock))],
  'sweep-slots': [(args) => (args.length === 1 && args[0] ? args : null), async ([base]) => {
    for (const slot of await sweepSlots(base)) console.log(slot);
    return 0;
  }],
};

/**
 * The CLI. Exit codes: `run` and `attach` the run's own code, 125 on a look,
 * 130 on an interrupt, 3 for a live holder, 1 when the lock or the run cannot
 * be made; `ask-end` 0, 1 or 2 (askEnd); `live` and `held` 0 with the pid
 * printed, else 1; 2 for a call it does not take.
 * @param {string[]} argv `<verb> <args...>`
 * @returns {Promise<number>} the exit code
 */
const main = async ([verb, ...args]) => {
  const known = VERBS[verb];
  const parsed = known ? known[0](args) : null;
  if (!parsed) {
    console.error(USAGE);
    return 2;
  }
  return known[1](parsed);
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { main, run, endOnInt };
