/**
 * workflow/lib/bounded.js: one program run to its end under a bound, stdin
 * closed, both streams read: past the bound its whole tree is ended and it
 * answers 124, as `timeout` exits. The jobs' children and the command's
 * reads that must answer in time (a captive portal never does) share it, and
 * the rules a bound's or a wait's variable is read by.
 * Usage: const { bounded, secondsOf, nonNegativeOf } = require('../lib/bounded');
 */

const { spawn } = require('./run');
const { exitOf, startFailed } = require('./detach');
const { endTreeOf } = require('./tree');

// The code a run past its bound answers, as `timeout` exits.
const TIMED_OUT = 124;

/**
 * A positive number of seconds from the environment, else the default: a
 * bound a person set wrongly (0, negative, junk, empty) is the default's.
 * @param {string|undefined} value the variable's value
 * @param {number} fallback the seconds when it is unset or not a positive number
 * @returns {number}
 */
const secondsOf = (value, fallback) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
};

/**
 * A finite number of 0 or more from the environment, else the default: unset,
 * blank or junk is the default's, and 0 stays 0.
 * @param {string|undefined} value the variable's value
 * @param {number} fallback the number when it is unset or not one of 0 or more
 * @returns {number}
 */
const nonNegativeOf = (value, fallback) => {
  const number = value?.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

/** bounded's run, once its bound is checked: spawn's options, stdio among them. */
const runBound = (command, args, bound, { stdio, ...options }) => new Promise((resolve) => {
  const chunks = [];
  const outChunks = [];
  const errChunks = [];
  let timedOut = false;
  let done = false;
  const child = spawn(command, args, { windowsHide: true, ...options, stdio });
  const finish = (status) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    // A grandchild that outlived the end may hold a pipe: the answer waits on no one.
    child.stdout?.destroy();
    child.stderr?.destroy();
    resolve({
      status: timedOut ? TIMED_OUT : status,
      output: Buffer.concat(chunks).toString('utf8'),
      stdout: Buffer.concat(outChunks).toString('utf8'),
      stderr: Buffer.concat(errChunks).toString('utf8'),
      timedOut,
    });
  };
  // A tree that cannot be read or ended still loses its head, and the output says why.
  const timer = setTimeout(() => {
    timedOut = true;
    endTreeOf(child.pid)
      .catch((err) => {
        chunks.push(Buffer.from(`${err.message}\n`));
        child.kill('SIGKILL');
      })
      .then(() => finish(TIMED_OUT));
  }, bound);
  child.stdout?.on('data', (chunk) => {
    chunks.push(chunk);
    outChunks.push(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    chunks.push(chunk);
    errChunks.push(chunk);
  });
  child.on('error', (err) => {
    const line = Buffer.from(`${command}: ${err.message}\n`);
    chunks.push(line);
    errChunks.push(line);
    finish(startFailed);
  });
  child.on('close', (code, signal) => finish(exitOf(code, signal)));
});

/**
 * Runs one child to its end. Past the bound its whole tree is ended and it
 * answers 124, as a hang is a failure with no code of its own. A failed start
 * answers startFailed with `<command>: <message>` in `output` and `stderr`.
 * @param {string} command
 * @param {string[]} args
 * @param {object} options spawn's, plus `bound`: the bound in ms;
 *   `stdio` is spawn's, stdin closed and both streams read by default
 * @returns {Promise<{status: number, output: string, stdout: string, stderr: string, timedOut: boolean}>}
 *   output: stdout and stderr in the order they came, and the bound's own line; stdout and stderr: each alone
 * @throws {TypeError} a bound that is not a positive number, before anything starts
 */
const bounded = (command, args, { bound, stdio = ['ignore', 'pipe', 'pipe'], ...options }) => {
  if (!Number.isFinite(bound) || bound <= 0) throw new TypeError(`bounded: bound must be a positive number of milliseconds, got ${String(bound)}`);
  return runBound(command, args, bound, { ...options, stdio });
};

module.exports = { bounded, secondsOf, nonNegativeOf };
