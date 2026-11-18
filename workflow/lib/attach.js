/**
 * workflow/lib/attach.js: a call attached to a detached run, CJS: the log
 * tailed from an offset to the run's done file, painted for a terminal by the
 * runner's painter (packages/core/test/lib/paint.js, required in process), the
 * look the supervisor asks for, and the run under a supervisor already, its
 * command in the foreground on stdout and in the log; the view, the log reads
 * and the path compare `workkit watch` shares.
 * Usage: const { attachRun, runForeground } = require('./attach');
 */

const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { setTimeout: sleep } = require('timers/promises');
const { spawn } = require('./run');
const { readOrNull } = require('./read');
const { writeWhole, exitOf, END_SIGNALS } = require('./detach');
const {
  takeRunLock, writePid, leaveRecord, recordedCode, dropRunLock, doneCode, pidAlive,
} = require('./run-lock');

const PAINT = path.join(__dirname, '..', '..', 'packages', 'core', 'test', 'lib', 'paint.js');

// The Node home of `wk_color_on`'s rule, the tower's logger.
const GATE = path.join(__dirname, '..', '..', 'tower', 'api', 'lib', 'log.js');

// The one home of the kit's node floor, `WK_NODE_FLOOR=<x.y>`.
const FLOOR_HOME = path.join(__dirname, 'platform.sh');

/**
 * Whether this process's Node reaches the kit's floor, read part by part as
 * numbers from platform.sh's WK_NODE_FLOOR: the `require()` of an ES module
 * needs it. A platform.sh that names no floor throws.
 * @returns {boolean}
 */
const atFloor = () => {
  const floor = /^WK_NODE_FLOOR=([\d.]+)\s*$/m.exec(fs.readFileSync(FLOOR_HOME, 'utf8'));
  if (!floor) throw new Error(`attach: ${FLOOR_HOME} names no WK_NODE_FLOOR`);
  const want = floor[1].split('.').map(Number);
  const have = process.versions.node.split('.').map(Number);
  for (let i = 0; i < want.length; i += 1) {
    if ((have[i] ?? 0) !== want[i]) return (have[i] ?? 0) > want[i];
  }
  return true;
};

// How often the tail reads the run, and every how many reads it asks after a
// supervisor whose lock still stands.
const POLL_MS = 200;
const LIFE_EVERY = 25;

/**
 * The painter's `paint` when the view is painted: the kit's color gate on
 * stdout says yes (`colorOn` in GATE), the painter is here, and this Node is at
 * the kit's floor; else the plain view. A painter that is there and fails to
 * load throws. The gate judged stdout already, so color is forced.
 * @returns {function|null}
 */
const painter = () => {
  if (!fs.existsSync(GATE) || !fs.existsSync(PAINT)) return null;
  const { colorOn } = require(GATE);
  if (!colorOn(process.stdout) || !atFloor()) return null;
  const { paint } = require(PAINT);
  process.env.FORCE_COLOR = '1';
  return paint;
};

/**
 * The attached call's view on stdout: the log's bytes as they are, or each
 * whole line painted, a line split across reads held for its end. `gone` is a
 * painted view whose reader went away; a plain one passes a lost reader over.
 * @returns {{write: function, flush: function, gone: function}}
 */
const viewOf = () => {
  let lost = false;
  process.stdout.on('error', () => { lost = true; });
  const paint = painter();
  if (paint === null) return { write: (bytes) => process.stdout.write(bytes), flush: () => {}, gone: () => false };
  const decoder = new StringDecoder('utf8');
  let rest = '';
  return {
    write: (bytes) => {
      const text = rest + decoder.write(Buffer.from(bytes));
      const end = text.lastIndexOf('\n') + 1;
      rest = text.slice(end);
      if (end > 0) process.stdout.write(paint(text.slice(0, end), process.stdout));
    },
    flush: () => {
      const last = rest + decoder.end();
      rest = '';
      if (last !== '') process.stdout.write(paint(last, process.stdout));
    },
    gone: () => lost,
  };
};

/** <log>'s size, 0 while it is not there. */
const sizeOf = (log) => {
  try {
    return fs.statSync(log).size;
  } catch {
    return 0;
  }
};

/**
 * <bytes> from the start of their last <count> lines, `tail -n`'s rule: a
 * final newline closes the last line, it opens none.
 * @param {Buffer} bytes
 * @param {number} count
 * @returns {Buffer}
 */
const lastLines = (bytes, count) => {
  let at = bytes.length - (bytes[bytes.length - 1] === 0x0a ? 1 : 0);
  for (let n = 0; n < count; n += 1) {
    if (at <= 0) return bytes;
    at = bytes.lastIndexOf(0x0a, at - 1);
    if (at < 0) return bytes;
  }
  return bytes.subarray(at + 1);
};

/** <log>'s bytes from <from> to <to>. */
const bytesOf = (log, from, to) => {
  const fd = fs.openSync(log, 'r');
  try {
    const buffer = Buffer.alloc(to - from);
    const read = fs.readSync(fd, buffer, 0, buffer.length, from);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
};

/** The look line, naming `workkit watch` with WK_WATCH_NAME when the caller set it. */
const lookLine = (log) => {
  const name = process.env.WK_WATCH_NAME ? ` ${process.env.WK_WATCH_NAME}` : '';
  return `detach: the run goes on; read ${log}, then run workkit watch${name} to keep waiting or workkit watch --end${name} to end it (exit 125)\n`;
};

/** The tail itself: attachRun's answer, or `stopped` once <signal> aborts it. */
const follow = async (log, lock, pid, from, view, signal) => {
  const lookFile = path.join(lock, 'look');
  let off = from;
  let code = '';
  for (let polls = 1; ; polls += 1) {
    // Done is read once, before the log, so the log read that follows is the
    // last; an empty read is a done file not written yet.
    code = doneCode(lock);
    const look = code === '' && fs.existsSync(lookFile);
    const size = sizeOf(log);
    if (size > off) {
      view.write(bytesOf(log, off, size));
      off = size;
    }
    if (code !== '') break;
    if (look) {
      const evidence = readOrNull(lookFile);
      if (evidence !== null) {
        view.write(evidence);
        fs.rmSync(lookFile, { force: true });
      }
      view.write(lookLine(log));
      return { rc: 125, code: null, look: true };
    }
    if ((!fs.existsSync(lock) || polls % LIFE_EVERY === 0) && !pidAlive(pid) && !fs.existsSync(path.join(lock, 'done'))) {
      await dropRunLock(lock, pid);
      const recorded = recordedCode(lock, pid);
      if (recorded !== null) return { rc: recorded, code: recorded, look: false };
      console.error(`detach: the run of supervisor ${pid} ended without recording an exit code; its output is in ${log}`);
      return { rc: 1, code: null, look: false };
    }
    await sleep(POLL_MS);
    // A painted view that is gone ends the tail, the lock kept for a watch.
    if (view.gone()) {
      console.error('detach: the painted view of the run ended, so this call stops; the run goes on, and workkit watch follows it');
      return { rc: 1, code: null, look: false };
    }
    if (signal?.aborted) return { rc: null, code: null, look: false, stopped: true };
  }
  if (!/^\d+$/.test(code)) {
    await dropRunLock(lock, pid);
    console.error(`detach: the done file held no exit code (${code})`);
    return { rc: 1, code: null, look: false };
  }
  leaveRecord(lock, pid, code);
  await dropRunLock(lock, pid);
  return { rc: Number(code), code: Number(code), look: false };
};

/**
 * Tail <log> to stdout from byte <offset> until <pid>'s done file (or the
 * record <lock>.done), drop <lock> and answer the code. A look prints and
 * consumes the look file, keeps the lock and answers 125.
 * @param {string} log
 * @param {string} lock
 * @param {number|string} pid the supervisor's
 * @param {number} [offset]
 * @param {{signal?: AbortSignal, view?: object}} [options] an abort ends the tail, nothing dropped; a view given goes on from the caller's writes
 * @returns {Promise<{rc: (number|null), code: (number|null), look: boolean, stopped?: boolean}>} the
 *   exit code, the code the command recorded (null: the runner failed), a look
 */
const attachRun = async (log, lock, pid, offset = 0, { signal, view = viewOf() } = {}) => {
  try {
    return await follow(log, lock, pid, Number(offset) || 0, view, signal);
  } finally {
    view.flush();
  }
};

/**
 * <cmd> started. A file the system will not start as a program (ENOEXEC, a
 * script with no `#!` line) is started again by `sh -c`, which finds it as a
 * shell does, on PATH for a bare name, and runs it as a script, as bash does.
 */
const startOf = (cmd, args, options) => {
  try {
    return spawn(cmd, args, options);
  } catch (err) {
    if (err.code !== 'ENOEXEC') throw err;
    return spawn('sh', ['-c', '"$0" "$@"', cmd, ...args], options);
  }
};

/**
 * A shell's answer for a command that cannot start: 127 and its line for one
 * not found, 126 for one found that cannot run (not executable, a folder). A
 * refusal of lib/run.js's own (no `syscall`) keeps its message.
 */
const unstartedOf = (cmd, err) => {
  const code = err.code === 'ENOENT' ? 127 : 126;
  const why = err.syscall === undefined ? err.message : code === 127 ? 'command not found' : `cannot be run (${err.code})`;
  return { code, line: `detach: ${cmd}: ${why}\n` };
};

/**
 * <argv> run here, its code once every holder of its output is gone: its
 * output on stdout and in <log> when <teed>, else on this process's own stdio.
 * A start that fails, thrown or as an `error`, is one line and a shell's code.
 */
const runHere = ([cmd, ...args], log, teed) => new Promise((resolve) => {
  const out = teed ? fs.openSync(log, 'w') : null;
  // A stdout whose reader went away leaves the log, and the command, going.
  if (teed) process.stdout.on('error', () => {});
  const both = (bytes) => {
    process.stdout.write(bytes);
    fs.writeSync(out, bytes);
  };
  let settled = false;
  const settle = (code) => {
    if (settled) return;
    settled = true;
    if (out !== null) fs.closeSync(out);
    resolve(code);
  };
  const unstarted = (err) => {
    const { code, line } = unstartedOf(cmd, err);
    if (teed) both(line);
    else process.stderr.write(line);
    settle(code);
  };
  let child;
  try {
    child = startOf(cmd, args, { stdio: teed ? ['inherit', 'pipe', 'pipe'] : 'inherit', windowsHide: true });
  } catch (err) {
    unstarted(err);
    return;
  }
  if (teed) {
    child.stdout?.on('data', both);
    child.stderr?.on('data', both);
  }
  child.on('error', unstarted);
  child.on('close', (code, sig) => settle(exitOf(code, sig)));
});

/** Whether two spellings of a path name one: resolved, and on Windows without regard to case. */
const samePath = (a, b) => {
  if (!a || !b) return false;
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

/**
 * <argv> under a supervisor already, on stdout and in <log>, <lock> held and
 * marked `foreground` (WK_RUN_LOCK) and ended as a detached run ends; under
 * WK_RUN_LOCK itself it runs bare. A HUP, INT or TERM is the command's: this
 * process never ends before it, and always writes the done file and the record.
 * @param {string} log
 * @param {string} lock
 * @param {string[]} argv
 * @returns {Promise<{rc: number, code: (number|null), held?: number}>} the command's
 *   code, or 3 with a live holder's pid, or 1 when the lock cannot be made
 */
const runForeground = async (log, lock, argv) => {
  const enclosing = process.env.WK_RUN_LOCK || '';
  for (const signal of END_SIGNALS) process.on(signal, () => {});
  if (samePath(lock, enclosing)) {
    const rc = await runHere(argv, log, false);
    return { rc, code: rc };
  }
  const taken = await takeRunLock(lock);
  if (taken.code !== 0) return { rc: taken.code, code: null, held: taken.held };
  // Before the pid, so no watch reads this lock unmarked: no supervisor reads its end file.
  fs.writeFileSync(path.join(lock, 'foreground'), `${enclosing}\n`);
  writePid(lock, process.pid);
  try {
    fs.mkdirSync(path.dirname(log), { recursive: true });
  } catch { /* the open below says why */ }
  const rc = await runHere(argv, log, true);
  writeWhole(path.join(lock, 'done'), `${rc}\n`);
  leaveRecord(lock, process.pid, rc);
  await dropRunLock(lock, process.pid);
  return { rc, code: rc };
};

module.exports = {
  attachRun, runForeground, runHere, viewOf, samePath, sizeOf, bytesOf, lastLines,
};
