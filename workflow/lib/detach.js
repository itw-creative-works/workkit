/**
 * workflow/lib/detach.js: the detached runner, a command that outlives the
 * shell that started it. Two stages: the launcher truncates the log, starts a
 * supervisor copy of itself in its own session and exits; the supervisor runs
 * the command into the log and writes its exit code to the done file. With a
 * root it reads the run every tests.check minutes (lib/pulse.js); an `end`
 * file beside the done file ends the run.
 * Usage: node detach.js <log> <done> [--root <root>] -- <cmd> [args...]   (detach.sh calls it)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('./run');
const { judge, FROZEN_CHECKS, LOOK_CHECKS, WORK_FLOOR, FROZEN_CODE } = require('./pulse');
const { treeOf, endTreeOf } = require('./tree');

const SUPERVISE = '--supervise';
const ROOT = '--root';
const CHECK = '--check';
const USAGE = 'usage: detach.js <log> <done> [--root <root>] -- <cmd> [args...]';

// How often the supervisor looks for an `end` file beside the done file.
const END_POLL_MS = 1000;

// The longest gap between two reads of the run's processes, and the fewest
// reads in one check: a short-lived child is caught while it runs.
const SAMPLE_MS = 5000;
const MIN_SAMPLES = 4;

// The code a requested end records: the one a shell gives a terminated command.
const ENDED_CODE = 128 + os.constants.signals.SIGTERM;

/**
 * The argument list, or null when it is not
 * `<log> <done> [<flag> <value>] -- <cmd> [args...]`.
 * @param {string[]} argv
 * @param {string} flag the one optional flag, `--root` or `--check`
 * @returns {{log: string, done: string, value: (string|null), cmd: string, args: string[]}|null}
 */
const parse = (argv, flag) => {
  const [log, done] = argv;
  const flagged = argv[2] === flag;
  const value = flagged ? argv[3] : null;
  const [sep, cmd, ...args] = argv.slice(flagged ? 4 : 2);
  if (!log || !done || (flagged && !value) || sep !== '--' || !cmd) return null;
  return { log, done, value, cmd, args };
};

/**
 * The command that holds the machine awake while `pid` lives: `caffeinate`
 * on macOS, null on every other platform.
 * @param {number} pid
 * @param {string} platform a `process.platform` value
 * @returns {string[]|null}
 */
const awakeCommand = (pid, platform) => (platform === 'darwin' ? ['caffeinate', '-i', '-w', String(pid)] : null);

/**
 * The launcher: with a root, reads its tests.check first, a bad value exit 2
 * with nothing run; then truncates the log, drops a stale done file, starts
 * the supervisor detached (a new session on POSIX, the parent's death changes
 * nothing) and prints its pid.
 * @param {string[]} argv
 * @returns {number} the exit code
 */
const launch = (argv) => {
  const job = parse(argv, ROOT);
  if (!job) {
    console.error(USAGE);
    return 2;
  }
  let check = [];
  if (job.value !== null) {
    // Loaded only with a root: a run without one needs nothing outside workflow/lib.
    const { settingsAt } = require('./settings');
    const { checkMinutes } = require('../../hooks/mods/settings.js');
    const settings = settingsAt(job.value);
    try {
      check = [CHECK, String(checkMinutes(settings))];
    } catch (err) {
      console.error(`detach: ${err.message}`);
      return 2;
    }
  }
  fs.writeFileSync(job.log, '');
  fs.rmSync(job.done, { force: true });
  const supervisor = spawn(process.execPath, [__filename, SUPERVISE, job.log, job.done, ...check, '--', job.cmd, ...job.args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  supervisor.unref();
  process.stdout.write(`${supervisor.pid}\n`);
  return 0;
};

/**
 * Writes `text` to `file` through a temp file and a rename, so a reader never
 * sees it half-written.
 * @param {string} file
 * @param {string} text
 */
const writeWhole = (file, text) => {
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
};

/** A span of checks in minutes, rounded clear of float noise. */
const minutesOf = (minutes, checks) => Math.round(minutes * checks * 1e6) / 1e6;

/** One evidence line per process: its pid, the processor seconds it used in the last check, its command. */
const evidenceOf = (gains) => gains.map(({ pid, gain, command }) => `detach:   ${pid} ${gain.toFixed(2)}s ${command}\n`).join('');

/**
 * The reads in one check of `checkMs` and the gap between them: one at least
 * every SAMPLE_MS, and never fewer than MIN_SAMPLES.
 * @param {number} checkMs
 * @returns {{samples: number, every: number}}
 */
const samplingOf = (checkMs) => {
  const samples = Math.max(MIN_SAMPLES, Math.ceil(checkMs / SAMPLE_MS));
  return { samples, every: checkMs / samples };
};

/**
 * The supervisor's reads of the tree under `pid`: `start` takes the first,
 * then `sample` reads it again and, at every `samples`th read, judges the
 * check and hands each verdict but alive to `on` with the evidence. Output is
 * the log's growth; work is the processor seconds gained across the check's
 * reads reaching the floor, or a process new since the read before. A read
 * that throws calls `on.fail` with the error; a tree that cannot be read
 * (Windows) calls `on.off`.
 * @param {{out: number, pid: number, minutes: number, samples: number}} run the log's handle, the command's pid, the check's length, the reads in one check
 * @param {{frozen: function, look: function, off: function, fail: function}} on
 * @returns {{start: function, sample: function}}
 */
const pulseOf = ({ out, pid, minutes, samples }, on) => {
  let state;
  let size = 0;
  let taken = 0;
  let born = false;
  let used = new Map();
  let gained = new Map();
  // The tree, or null when it cannot be read; a throw is on.fail's.
  const read = () => {
    try {
      const tree = treeOf(pid);
      if (tree === null) on.off();
      return tree;
    } catch (err) {
      on.fail(err);
      return null;
    }
  };
  const start = () => {
    const tree = read();
    if (tree !== null) used = new Map(tree.map((proc) => [proc.pid, proc.cpu]));
  };
  const sample = () => {
    const tree = read();
    if (tree === null) return;
    for (const proc of tree) {
      const before = used.get(proc.pid);
      if (before === undefined) born = true;
      const gain = (gained.get(proc.pid)?.gain ?? 0) + Math.max(0, proc.cpu - (before ?? 0));
      gained.set(proc.pid, { pid: proc.pid, command: proc.command, gain });
    }
    used = new Map(tree.map((proc) => [proc.pid, proc.cpu]));
    taken += 1;
    if (taken < samples) return;
    const now = fs.fstatSync(out).size;
    const gains = [...gained.values()];
    const work = born || gains.reduce((sum, { gain }) => sum + gain, 0) >= WORK_FLOOR * minutes * 60;
    const judged = judge(state, { output: now !== size, work });
    state = judged.state;
    size = now;
    taken = 0;
    born = false;
    gained = new Map();
    if (judged.verdict !== 'alive') on[judged.verdict](evidenceOf(gains));
  };
  return { start, sample };
};

/**
 * Starts the command that holds the machine awake while this process lives,
 * where the platform has one; a failed start is one line in the log.
 * @param {function} say writes one line to the log
 */
const holdAwake = (say) => {
  const awake = awakeCommand(process.pid, process.platform);
  if (awake === null) return;
  const [cmd, ...args] = awake;
  const holder = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
  holder.on('error', (err) => say(`detach: ${cmd}: ${err.message}, so the machine may sleep during the run`));
  holder.unref();
};

/**
 * The supervisor: runs the command with stdout and stderr written to the log,
 * then records its exit code. A command killed by a signal records 128 plus
 * the signal's number, the way a shell reports it. With a check it ends a
 * frozen run (FROZEN_CODE) and writes a look for an unclear one; an `end` file
 * ends the run (ENDED_CODE). An ended run records its own code, never the
 * command's, once its whole tree is gone; an end that fails with the command
 * alive records nothing, and the run goes on.
 * @param {string[]} argv
 * @returns {number|undefined} a usage code, or nothing while the command runs
 */
const supervise = (argv) => {
  const job = parse(argv, CHECK);
  if (!job) {
    console.error(USAGE);
    return 2;
  }
  // Opened for writing, never 'a': a Git Bash child cannot write to the
  // append-only handle Node makes on Windows, and its output would be lost.
  // The supervisor's own lines go through it too, at the command's offset.
  const out = fs.openSync(job.log, 'w');
  const say = (line) => fs.writeSync(out, `${line}\n`);
  const beside = (name) => path.join(path.dirname(job.done), name);
  const timers = [];
  let finished = false;
  let ending = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    timers.forEach(clearInterval);
    writeWhole(job.done, `${code}\n`);
  };
  holdAwake(say);
  const child = spawn(job.cmd, job.args, { stdio: ['ignore', out, out], windowsHide: true });
  child.on('error', (err) => {
    say(`detach: ${job.cmd}: ${err.message}`);
    finish(127);
  });
  child.on('exit', (code, signal) => {
    if (!ending) finish(code === null ? 128 + os.constants.signals[signal] : code);
  });
  // The timers run on through an end, so a failed one leaves the end poll and
  // the checks as they were; finish() clears them.
  const end = (code, line) => {
    if (ending || finished) return;
    ending = true;
    endTreeOf(child.pid)
      .catch((err) => {
        if (child.exitCode === null && child.signalCode === null) throw err;
        say(`detach: ${err.message}`);
      })
      .then(() => {
        say(line);
        finish(code);
      }, (err) => {
        say(`detach: the run could not be ended (${err.message}), so it goes on`);
        fs.rmSync(beside('end'), { force: true });
        ending = false;
      });
  };
  timers.push(setInterval(() => {
    if (fs.existsSync(beside('end'))) end(ENDED_CODE, `detach: the run was ended on request (exit ${ENDED_CODE})`);
  }, END_POLL_MS));
  if (job.value === null || child.pid === undefined) return undefined;
  const minutes = Number(job.value);
  const { samples, every } = samplingOf(minutes * 60000);
  // The timer's first call comes `every` ms on, after pulse is set below.
  const check = setInterval(() => {
    if (!ending) pulse.sample();
  }, every);
  timers.push(check);
  const pulse = pulseOf({ out, pid: child.pid, minutes, samples }, {
    frozen: (evidence) => {
      fs.writeSync(out, evidence);
      end(FROZEN_CODE, `detach: no output and no processor use for ${minutesOf(minutes, FROZEN_CHECKS)} minutes, so the run was ended (exit ${FROZEN_CODE})`);
    },
    look: (evidence) => {
      writeWhole(beside('look'), `detach: no output for ${minutesOf(minutes, LOOK_CHECKS)} minutes, but the run still uses the processor:\n${evidence}`);
    },
    off: () => clearInterval(check),
    fail: (err) => {
      clearInterval(check);
      say(`detach: could not read the run's processes (${err.message}), so the checks are off`);
    },
  });
  pulse.start();
  return undefined;
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const code = argv[0] === SUPERVISE ? supervise(argv.slice(1)) : launch(argv);
  if (code !== undefined) process.exitCode = code;
}

module.exports = { awakeCommand };
