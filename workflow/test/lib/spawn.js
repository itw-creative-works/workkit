/**
 * Process management for a suite: a child run to its end under the spawn
 * deadline, a child started and watched (its streams, its exit, a watchdog at
 * the deadline), and the end of the process group a child leads.
 */

const { spawn, spawnSync } = require('child_process');
const { inspect } = require('util');
const { SPAWN_DEADLINE, PIPE_GRACE_MS, until } = require('./process');

const IS_WINDOWS = process.platform === 'win32';

// The rungs `end()` climbs, INT first so the child can log its own end, then
// TERM, then KILL, END_GRACE apart: the shell's `wk_end_run` ladder.
const LADDER = ['SIGINT', 'SIGTERM', 'SIGKILL'];
const END_GRACE = 1500;

/**
 * Send <signal> to <target> (a pid, or a group as -pid); a process gone or not
 * ours is no error.
 * @returns {boolean} whether the target was gone (ESRCH)
 */
const trySignal = (target, signal) => {
  try {
    process.kill(target, signal);
    return false;
  } catch (err) {
    if (err.code !== 'ESRCH' && err.code !== 'EPERM') throw err;
    return err.code === 'ESRCH';
  }
};

/**
 * End the tree a raw <pid> heads: the group it leads, else the pid; on Windows
 * `taskkill /T /F` ends its whole tree. A pid that is not a positive integer
 * throws, since 0 or a negative one signals the caller's own group or another.
 * @param {number} pid
 * @param {string} [signal]
 */
const endTree = (pid, signal = 'SIGTERM') => {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`endTree: pid must be a positive integer, got ${inspect(pid)}`);
  if (IS_WINDOWS) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', timeout: SPAWN_DEADLINE });
    return;
  }
  if (trySignal(-pid, signal)) trySignal(pid, signal);
};

/**
 * Run <cmd> to its end under <deadline>, every stream piped; the deadline KILLs,
 * so a child that traps TERM cannot outlast it.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?: string, env?: object, input?: string, deadline?: number}} [opts]
 * @returns {{status: ?number, signal: ?string, stdout: string, stderr: string, output: string, timedOut: boolean}}
 */
const run = (cmd, args, { cwd, env, input, deadline = SPAWN_DEADLINE } = {}) => {
  const result = spawnSync(cmd, args, {
    cwd, env, input, timeout: deadline, killSignal: 'SIGKILL', encoding: 'utf8', stdio: 'pipe',
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  if (result.error && !timedOut) throw result.error;
  // spawnSync hands the streams back apart, so the order kept is stdout's then stderr's.
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.stdout + result.stderr,
    timedOut,
  };
};

/**
 * Start <cmd> without waiting, stdout and stderr piped. `done` resolves once the
 * child has exited and its streams closed, PIPE_GRACE_MS after the exit at most.
 * A watchdog at <deadline> marks `timedOut` and calls `end()`. `end(signal)` climbs
 * the ladder from that rung while the target lives: a detached child's group, else
 * the child alone; on Windows one `taskkill` tree end. A signal off the ladder
 * rejects; a child that never spawned ends at once, `done` rejecting with the error.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd?: string, env?: object, deadline?: number, detached?: boolean}} [opts]
 * @returns {{child: object, pid: number, output: Function, stdout: Function, stderr: Function, done: Promise, end: Function}}
 */
const start = (cmd, args, { cwd, env, deadline = SPAWN_DEADLINE, detached = false } = {}) => {
  const child = spawn(cmd, args, { cwd, env, detached, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  let all = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { out += chunk; all += chunk; });
  child.stderr.on('data', (chunk) => { err += chunk; all += chunk; });

  let timedOut = false;
  let exit = {};
  const gone = () => child.exitCode !== null || child.signalCode !== null;
  const closePipes = () => {
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const exited = new Promise((resolve) => {
    child.once('exit', (status, signal) => {
      exit = { status, signal };
      setTimeout(closePipes, PIPE_GRACE_MS).unref();
      resolve();
    });
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve({ ...exit, timedOut }));
  });
  // `done` still rejects for whoever awaits it; a caller that only awaits
  // `end()` must not die of the unhandled rejection.
  done.catch(() => {});

  // A detached group outlives its leader, so its life is the group's, not the child's.
  // Windows has no process group: its one end is taskkill's tree end.
  const group = detached && !IS_WINDOWS;
  const lives = () => (group ? !trySignal(-child.pid, 0) : !gone());
  // Wait until the target is gone or END_GRACE has passed, polled as the shell's
  // `_wk_group_gone` does, since a group has no exit event.
  const settle = () => until(() => !lives(), END_GRACE);

  const end = async (signal = 'SIGINT') => {
    if (!LADDER.includes(signal)) throw new Error(`end: signal must be one of ${LADDER.join(', ')}, got ${inspect(signal)}`);
    clearTimeout(watchdog);
    if (child.pid === undefined) return;
    if (IS_WINDOWS) {
      if (lives()) endTree(child.pid);
    } else {
      for (const rung of LADDER.slice(LADDER.indexOf(signal))) {
        if (!lives()) break;
        if (group) endTree(child.pid, rung);
        else trySignal(child.pid, rung);
        await settle();
      }
    }
    await exited;
    // The exit's own grace closes the streams, so output written while ending is read.
    await done;
  };

  const watchdog = setTimeout(() => {
    if (gone()) return;
    timedOut = true;
    end();
  }, deadline);
  watchdog.unref();

  return {
    child, pid: child.pid, output: () => all, stdout: () => out, stderr: () => err, done, end,
  };
};

module.exports = { run, start, endTree };
