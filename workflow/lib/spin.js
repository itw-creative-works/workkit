/**
 * workflow/lib/spin.js: the moving wait line: a worker thread draws the
 * frames while the caller's thread runs its call, so a sync call animates too,
 * and the line is cleared before the answer reaches the caller. The poll's
 * countdown (lib/flows.js) draws through the same frames.
 * Usage: const { spin } = require('../lib/spin');
 */

const fs = require('fs');
const tty = require('tty');
const { Worker, isMainThread, workerData } = require('worker_threads');
const {
  PALETTE, colorOn, paint, wait, indent,
} = require('./voice');

// The frames, one each FRAME_MS.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 100;

// The clear spin writes once the frames stop.
const CLEAR = `\r${' '.repeat(72)}\r`;

// The two slots of the stop handshake: the caller's stop, the drawer's answer.
const STOP = 0;
const DONE = 1;

// The longest the stop waits for the drawer's answer before it clears the line itself.
const STOP_BOUND_MS = 2000;

// The workerData key that marks this file's own drawing thread.
const DRAWER = 'workkitSpinDrawer';

/** The clock in whole seconds, as `date +%s` reads it. */
const nowSeconds = () => Math.floor(Date.now() / 1000);

// The descriptor the frames draw on when no terminal device is named.
const STDERR = 2;

/**
 * A descriptor opened for append on the terminal device a logged command
 * names; a device that does not open counts as none named.
 * @param {string|undefined} device the device's name, WK_COMMAND_TERMINAL's value
 * @returns {number|null} null for none
 */
const openDevice = (device) => {
  if (!device) return null;
  try {
    return fs.openSync(device, 'a');
  } catch {
    return null;
  }
};

/**
 * The descriptor the frames draw on: openDevice's on WK_COMMAND_TERMINAL,
 * else 2. Its caller closes an opened one, as startSpinner does.
 * @returns {number}
 */
const spinFd = () => openDevice(process.env.WK_COMMAND_TERMINAL) ?? STDERR;

/** <fd> closed when spinFd opened it; stderr is left open. */
const releaseFd = (fd) => {
  if (fd !== STDERR) fs.closeSync(fd);
};

/**
 * Whether frames are drawn on <fd>: WORKKIT_SPIN=1 always, WORKKIT_SPIN=0
 * never, otherwise on the device spinFd opened, the terminal the logger named,
 * and on stderr only when it is a terminal.
 * @param {number} fd
 * @returns {boolean}
 */
const framesOn = (fd) => {
  if (process.env.WORKKIT_SPIN === '1') return true;
  if (process.env.WORKKIT_SPIN === '0') return false;
  return fd !== STDERR || tty.isatty(fd);
};

/**
 * One frame, a poll's countdown when there is a deadline: the
 * indent, the frame in cyan, the message, the seconds in dim.
 * @param {object} data the drawer's workerData
 * @param {number} i the frame's count
 * @returns {string}
 */
const frameText = ({
  indent, on, message, start, deadline,
}, i) => {
  const frame = paint(FRAMES[i % FRAMES.length], PALETTE.CYAN, on);
  const tail = deadline === undefined
    ? `${message} ${paint(`(${nowSeconds() - start}s)`, PALETTE.DIM, on)}`
    : `${message}... ${paint(`(${Math.max(0, deadline - nowSeconds())}s)`, PALETTE.DIM, on)}`;
  return `\r${indent}${frame} ${tail}`;
};

/**
 * The drawing thread's loop: a frame, then a wait of FRAME_MS that the stop
 * cuts short, until the stop; then the clear, and only then the answer. A
 * descriptor that refuses a write ends the drawing, never the handshake.
 * @param {object} data the drawer's workerData
 */
const draw = (data) => {
  const flag = new Int32Array(data.state);
  let drawing = true;
  const put = (text) => {
    if (!drawing) return;
    try {
      fs.writeSync(data.fd, text);
    } catch {
      drawing = false;
    }
  };
  try {
    for (let i = 0; Atomics.load(flag, STOP) === 0; i += 1) {
      put(frameText(data, i));
      Atomics.wait(flag, STOP, 0, FRAME_MS);
    }
    put(CLEAR);
  } finally {
    Atomics.store(flag, DONE, 1);
    Atomics.notify(flag, DONE);
  }
};

/**
 * Start the frames on <fd>, drawn by a thread of their own that holds the
 * process open for nothing; the answer stops them, clears the line and returns
 * once the drawer has answered, so no frame lands after the clear.
 * @param {number} fd the descriptor spinFd picked
 * @param {string} message
 * @param {number} [deadline] a countdown's end in whole seconds (a poll's), else the elapsed seconds
 * @returns {() => void} the stop
 */
const startFrames = (fd, message, deadline) => {
  const state = new SharedArrayBuffer(8);
  const worker = new Worker(__filename, {
    execArgv: [],
    stdout: false,
    workerData: {
      [DRAWER]: true,
      state,
      fd,
      message,
      deadline,
      start: nowSeconds(),
      indent: indent(),
      on: colorOn(process.stdout),
    },
  });
  worker.unref();
  const flag = new Int32Array(state);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    Atomics.store(flag, STOP, 1);
    Atomics.notify(flag, STOP);
    // A healthy drawer answers within one frame of the stop, its `finally`
    // answering even after a throw; the bound is for a thread that died before
    // it ran. A drawer that starts after it sees the stop and draws no frame.
    if (Atomics.wait(flag, DONE, 0, STOP_BOUND_MS) === 'timed-out') {
      try {
        fs.writeSync(fd, CLEAR);
      } catch { /* a descriptor that refuses the clear refused the frames too */ }
    }
  };
};

/**
 * The frames on spinFd's descriptor where framesOn says so: their stop, which
 * also closes a descriptor spinFd opened, or null where none draw (the
 * descriptor closed already).
 * @param {string} message
 * @param {number} [deadline] as startFrames takes it
 * @returns {(() => void)|null}
 */
const startSpinner = (message, deadline) => {
  const fd = spinFd();
  if (!framesOn(fd)) {
    releaseFd(fd);
    return null;
  }
  let stopFrames;
  try {
    stopFrames = startFrames(fd, message, deadline);
  } catch (err) {
    releaseFd(fd);
    throw err;
  }
  let released = false;
  return () => {
    stopFrames();
    if (released) return;
    released = true;
    releaseFd(fd);
  };
};

/**
 * run(), with the frames moving while it runs where framesOn says
 * so, else `wait(message)`'s one line first. What run answers comes back, a
 * promise as a promise of the same value; what it throws or rejects goes on.
 * The frames stop and the line is cleared before either reaches the caller.
 * @template T
 * @param {string} message
 * @param {() => T} run the caller's call; it starts and reads its own program
 * @param {{line?: boolean}} [opts] line: false prints no one line, for a call
 *   whose wait stays silent off a terminal; the frames still draw
 * @returns {T}
 */
const spin = (message, run, { line = true } = {}) => {
  const stop = startSpinner(message);
  if (stop === null) {
    if (line) wait(message);
    return run();
  }
  let answer;
  try {
    answer = run();
  } catch (err) {
    stop();
    throw err;
  }
  if (typeof answer?.then === 'function') return Promise.resolve(answer).finally(stop);
  stop();
  return answer;
};

if (!isMainThread && workerData?.[DRAWER]) draw(workerData);

module.exports = {
  spin, spinFd, openDevice, framesOn, startFrames, startSpinner,
};
