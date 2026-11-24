/**
 * workflow/lib/interrupt.js: an end signal held off for a run that must clean
 * up first, as a shell's EXIT trap lets a script: the signal is noted, the run
 * stops, cleans up, and then ends by that same signal (on Windows, by its
 * code). A sync child holds the thread, so a note lands only at a turn of the
 * event loop; a child the hold runs leaves the loop free, and the signal is
 * handed on to it.
 * Usage: const { holdSignals, Interrupted } = require('../lib/interrupt');
 */

const { spawn } = require('./run');
const { END_SIGNALS, signalCode } = require('./detach');

/** One turn of the event loop: where a signal caught during a sync call is delivered. */
const turn = () => new Promise((resolve) => { setImmediate(resolve); });

/** What a run the hold stopped rejects with, naming the signal. */
class Interrupted extends Error {
  constructor(signal) {
    super(`interrupted by ${signal}`);
    this.name = 'Interrupted';
    this.signal = signal;
  }
}

/**
 * Hold END_SIGNALS for this process.
 * - `run(cmd, args, options)`: a program run in the background, answered as
 *   spawnSync answers (`status`, `signal`, `stdout`, `stderr`, `error`); a
 *   caught signal is handed on to it, and the run rejects with Interrupted.
 * - `interrupted()`: a turn, then the signal caught so far, or null.
 * - `end()`: a last turn, the signals given back, and the caught one raised
 *   again, so the process ends by it; on Windows, which has no signal to end
 *   by, its code (signalCode) becomes the exit code, and a caller keeps it.
 * @returns {{run: Function, interrupted: () => Promise<string|null>, end: () => Promise<void>}}
 */
const holdSignals = () => {
  let caught = null;
  const children = new Set();
  const note = (signal) => {
    if (caught === null) caught = signal;
    for (const child of children) child.kill(signal);
  };
  for (const signal of END_SIGNALS) process.on(signal, note);

  const run = (cmd, args, options = {}) => new Promise((resolve, reject) => {
    if (caught !== null) {
      reject(new Interrupted(caught));
      return;
    }
    const out = { stdout: '', stderr: '' };
    let settled = false;
    const settle = (res) => {
      if (settled) return;
      settled = true;
      children.delete(child);
      if (caught !== null) reject(new Interrupted(caught));
      else resolve({ ...out, ...res });
    };
    const child = spawn(cmd, args, options);
    children.add(child);
    for (const name of ['stdout', 'stderr']) {
      child[name]?.setEncoding('utf8');
      child[name]?.on('data', (chunk) => { out[name] += chunk; });
    }
    child.on('error', (error) => settle({ status: null, signal: null, error }));
    child.on('close', (status, signal) => settle({ status, signal }));
  });

  return {
    run,
    interrupted: async () => {
      await turn();
      return caught;
    },
    end: async () => {
      await turn();
      for (const signal of END_SIGNALS) process.removeListener(signal, note);
      if (caught === null) return;
      if (process.platform === 'win32') process.exitCode = signalCode(caught);
      else process.kill(process.pid, caught);
    },
  };
};

module.exports = { holdSignals, Interrupted };
