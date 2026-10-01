// workflow/lib/detach.js: the detached runner, a command that outlives the
// shell that started it. Two stages: the launcher truncates the log, starts a
// supervisor copy of itself in its own session and exits; the supervisor runs
// the command into the log and writes its exit code to the done file.
// Usage: node detach.js <log> <done> -- <cmd> [args...]   (detach.sh calls it)

const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const SUPERVISE = '--supervise';
const USAGE = 'usage: detach.js <log> <done> -- <cmd> [args...]';

/**
 * The argument list, or null when it is not `<log> <done> -- <cmd> [args...]`.
 * @param {string[]} argv
 * @returns {{log: string, done: string, cmd: string, args: string[]}|null}
 */
const parse = (argv) => {
  const [log, done, sep, cmd, ...args] = argv;
  if (!log || !done || sep !== '--' || !cmd) return null;
  return { log, done, cmd, args };
};

/**
 * The launcher: truncates the log, drops a stale done file, starts the
 * supervisor detached (a new session on POSIX, the parent's death changes
 * nothing) and prints its pid.
 * @param {string[]} argv
 * @returns {number} the exit code
 */
const launch = (argv) => {
  const job = parse(argv);
  if (!job) {
    console.error(USAGE);
    return 2;
  }
  fs.writeFileSync(job.log, '');
  fs.rmSync(job.done, { force: true });
  const supervisor = spawn(process.execPath, [__filename, SUPERVISE, ...argv], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  supervisor.unref();
  process.stdout.write(`${supervisor.pid}\n`);
  return 0;
};

/**
 * Writes `<code>\n` to the done file through a temp file and a rename, so a
 * reader never sees a half-written code.
 * @param {string} done
 * @param {number} code
 */
const writeDone = (done, code) => {
  const tmp = `${done}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${code}\n`);
  fs.renameSync(tmp, done);
};

/**
 * The supervisor: runs the command with stdout and stderr written to the log,
 * then records its exit code. A command killed by a signal records 128 plus
 * the signal's number, the way a shell reports it.
 * @param {string[]} argv
 * @returns {number|undefined} a usage code, or nothing while the command runs
 */
const supervise = (argv) => {
  const job = parse(argv);
  if (!job) {
    console.error(USAGE);
    return 2;
  }
  // Opened for writing, never 'a': a Git Bash child cannot write to the
  // append-only handle Node makes on Windows, and its output would be lost.
  const out = fs.openSync(job.log, 'w');
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    writeDone(job.done, code);
  };
  const child = spawn(job.cmd, job.args, { stdio: ['ignore', out, out], windowsHide: true });
  child.on('error', (err) => {
    fs.writeSync(out, `detach: ${job.cmd}: ${err.message}\n`);
    finish(127);
  });
  child.on('exit', (code, signal) => {
    finish(code === null ? 128 + os.constants.signals[signal] : code);
  });
  return undefined;
};

if (require.main === module) {
  const argv = process.argv.slice(2);
  const code = argv[0] === SUPERVISE ? supervise(argv.slice(1)) : launch(argv);
  if (code !== undefined) process.exitCode = code;
}
