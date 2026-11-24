#!/usr/bin/env node
/**
 * tower/start.js: the one door to the tower (`workkit tower`, `npm run tower`):
 * restarts the JSON API and the dashboard together, filtered quiet through
 * startup, and ends both when either ends. WORKKIT_TOWER_API / _APP / _PORTS let
 * the suite run it without real servers or ports. The behavior: tower/README.md § Run.
 * Usage: node tower/start.js [-v|--verbose]
 */

const path = require('path');
const { setTimeout: delay } = require('timers/promises');
const { holdSignals } = require('../workflow/lib/interrupt');
const { portPids, endPid } = require('../workflow/lib/ports');
const { spawn } = require('../workflow/lib/run');
const { writeOut } = require('../workflow/lib/say');
const { endTreeOf } = require('../workflow/lib/tree');
const {
  ok, info, warn, error, ESCAPE,
} = require('../workflow/lib/voice');

const ROOT = path.dirname(__dirname);

const DEFAULT_PORTS = '8693 4300';

// How long a port gets to free itself after the terminate signal, then after
// the forced one, and how often it is asked meanwhile.
const TERM_WAIT_MS = 5000;
const KILL_WAIT_MS = 3000;
const PORT_POLL_MS = 200;

// How long a half's output is still read after it exits, while a child it left holds it open.
const DRAIN_MS = 250;

// What survives the quiet phase: problem words, plus omega's own `omega: `
// prefix, which carries its boot refusals (tower/README.md § Run).
const KEEP = /error|warn|fail|fatal|exception|EADDR|ENOENT|EACCES|not found|cannot find module|missing binding|segmentation fault|killed:|npm ERR!|taken|bumped|^omega: |^\s+at \S/i;

// Benign lines the keep net would catch. The non-digit before the zero keeps
// `10 failed` printing; the loose middle is chalk's escapes.
const NOISE = /^objc\[[0-9]+\]: Class .* is implemented in both|Results:.*[^0-9]0 failed/is;

// Any port: omega bumps to the next free one when its own is taken.
const URL_AT = /(https?:\/\/\S*:[0-9]+)/i;

// omega pads the tag to its widest target name (`[web    ]`); `[webhook]` fails.
const WEB_TAG = /^\[web\s*\]\s/i;

/**
 * Print what one half says that is worth reading; the phases, the announce and
 * the drop list: tower/README.md § Run. A trigger line is judged in the phase it opens.
 * @param {{port: string, announced: boolean, flowing: boolean}} half
 * @param {string} line
 */
const judge = (half, line) => {
  // Patterns judge a copy with its color escapes stripped, and the original prints.
  const plain = line.replace(ESCAPE, '');
  if (half.port && WEB_TAG.test(plain)) half.flowing = true;
  const url = half.port && !half.announced ? URL_AT.exec(plain) : null;
  if (url) {
    half.announced = true;
    half.flowing = true;
    ok(`dashboard at ${url[1]}`);
  }
  if (NOISE.test(plain)) return;
  if (half.flowing || KEEP.test(plain)) writeOut(`${line}\n`);
};

/**
 * Each line of <stream> handed to <onLine> as it lands, a last one with no newline included.
 * @returns {() => void} hands on the last line now, for a stream that never ends
 */
const readLines = (stream, onLine) => {
  let rest = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = `${rest}${chunk}`.split('\n');
    rest = lines.pop();
    for (const line of lines) onLine(line);
  });
  const flush = () => {
    if (rest) onLine(rest);
    rest = '';
  };
  stream.on('end', flush);
  return flush;
};

/** Settles once <stream> has ended or closed. */
const endOf = (stream) => new Promise((resolve) => {
  if (stream.readableEnded || stream.destroyed) resolve();
  else {
    stream.once('end', resolve);
    stream.once('close', resolve);
  }
});

/** Settles once every one of <streams> has ended, or after DRAIN_MS, whichever comes first. */
const drained = (streams) => {
  let bound;
  return Promise.race([
    Promise.all(streams.map(endOf)),
    new Promise((resolve) => { bound = setTimeout(resolve, DRAIN_MS); }),
  ]).finally(() => clearTimeout(bound));
};

/**
 * Start one half: in a verbose run on the terminal, else read line by line
 * through judge. Its `ended` settles once it has exited and its output is read.
 * @param {{name: string, port: string, command: string, args: string[], cwd?: string}} spec
 * @param {boolean} verbose
 * @returns {object} the half
 */
const startHalf = ({
  name, port, command, args, cwd,
}, verbose) => {
  const output = verbose ? 'inherit' : 'pipe';
  const child = spawn(command, args, { cwd, stdio: ['ignore', output, output] });
  const half = {
    name, port, child, announced: false, flowing: false, done: false,
  };
  // A launch run.js refused has no streams: it only emits its error.
  const streams = verbose ? [] : [child.stdout, child.stderr].filter(Boolean);
  const flushes = streams.map((stream) => readLines(stream, (line) => judge(half, line)));
  // Its exit, then its output read to the end, within DRAIN_MS: a child it left
  // behind holds those streams open past its exit.
  half.ended = new Promise((resolve) => {
    const end = async () => {
      half.done = true;
      await drained(streams);
      for (const flush of flushes) flush();
      resolve();
    };
    child.once('exit', end);
    child.once('error', end);
  });
  return half;
};

/** The two halves' commands: a seam's line through `bash -c`, else the real server. */
const halvesOf = (appPort) => {
  const seam = (line) => ({ command: 'bash', args: ['-c', line] });
  const api = process.env.WORKKIT_TOWER_API
    ? seam(process.env.WORKKIT_TOWER_API)
    : { command: process.execPath, args: [path.join(ROOT, 'tower', 'api', 'server.js')] };
  const app = process.env.WORKKIT_TOWER_APP
    ? seam(process.env.WORKKIT_TOWER_APP)
    : { command: 'npm', args: ['run', 'dev'], cwd: path.join(ROOT, 'tower', 'app') };
  return [{ name: 'API', port: '', ...api }, { name: 'app', port: appPort, ...app }];
};

/** Ends one listener; a refusal is passed over, since the port's own check names a survivor. */
const endListener = async (pid, signal) => {
  try {
    await endPid(pid, signal);
  } catch (err) {
    if (!err.code) throw err;
  }
};

/** Waits up to <ms> for <port> to read free, cut short by an end signal. */
const freeWithin = async (port, ms, run) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && (await portPids(port)).length > 0) {
    await Promise.race([delay(PORT_POLL_MS), run.woken]);
    if (await run.hold.interrupted()) return;
  }
};

/**
 * Take a port back, escalating. Free means the lookup answers no process.
 * @returns {Promise<boolean>} whether the port reads free, or an end signal came
 */
const reclaim = async (port, run) => {
  for (const pid of await portPids(port)) {
    info(`replacing what was listening on port ${port} (pid ${pid})`);
    await endListener(pid, 'SIGTERM');
  }
  await freeWithin(port, TERM_WAIT_MS, run);
  if (await run.hold.interrupted()) return true;
  for (const pid of await portPids(port)) await endListener(pid, 'SIGKILL');
  await freeWithin(port, KILL_WAIT_MS, run);
  if (await run.hold.interrupted()) return true;
  return (await portPids(port)).length === 0;
};

/** Ends each half still running, its whole tree, and lets go of what it prints. */
const endHalves = async (halves) => {
  const ends = halves.map(async ({ child }) => {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) await endTreeOf(child.pid);
  });
  for (const end of await Promise.allSettled(ends)) {
    if (end.status === 'rejected') warn(`tower: ${end.reason.message}`);
  }
  for (const { child } of halves) {
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
};

/**
 * The call.
 * @param {string[]} args
 * @returns {Promise<number>} 0 when a half ends or a signal ends it; 1 when a port cannot be freed
 */
const main = async (args) => {
  // The engine's voice, as lib.sh sets it.
  process.env.WK_LOG_INDENT = '';
  const ports = (process.env.WORKKIT_TOWER_PORTS ?? DEFAULT_PORTS).split(/\s+/).filter(Boolean);
  const verbose = Boolean(process.env.WORKKIT_TOWER_VERBOSE) || args.some((arg) => arg === '-v' || arg === '--verbose');
  // A half writing to a pipe sees a non-tty and drops its colors; force them back
  // only when our own stdout is a terminal and the caller set no FORCE_COLOR.
  if (process.stdout.isTTY && !('FORCE_COLOR' in process.env)) process.env.FORCE_COLOR = '1';

  // An end signal ends the run, never the starter before its halves. The
  // hold's signalled() wakes the waits below; its end is never called, since it
  // would end the starter by the signal, not 0.
  const hold = holdSignals();
  const woken = hold.signalled();
  const run = { hold, woken };

  // Printed first, so a quiet startup never shows an empty terminal.
  ok('starting the dashboard');
  for (const port of ports) {
    if (await hold.interrupted()) return 0;
    if (!(await reclaim(port, run))) {
      error(`could not free port ${port}; its listener survived both signals, so nothing is started onto an occupied port`);
      return 1;
    }
  }
  // A signal that landed before here ends the run with no half started.
  if (await hold.interrupted()) return 0;

  const halves = halvesOf(ports[1] ?? '').map((spec) => startHalf(spec, verbose));
  await Promise.race([...halves.map((half) => half.ended), woken]);

  // A half that ended before any announce never came up: name it. Only in a
  // filtered run (verbose already showed everything); a shutdown never gets here.
  if (!(await hold.interrupted()) && !verbose && !halves.some((half) => half.announced)) {
    error(`the ${halves[0].done ? 'API' : 'app'} half ended before the dashboard came up; run \`npm run tower -- --verbose\` to see everything it printed`);
  }
  await endHalves(halves);
  return 0;
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { main };
