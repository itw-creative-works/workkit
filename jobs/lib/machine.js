/**
 * jobs/lib/machine.js: what a job needs from the machine it wakes up on under
 * launchd: its home and the transcripts root under it, the folders its programs
 * live in, the quiet Claude, the bound on a child, and the notifier.
 * Usage: const { homeOf, projectsRoot, enterMachine, secondsOf, jobTimeout, bounded, notify } = require('../lib/machine');
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exitOf, startFailed } = require('../../workflow/lib/detach');
const { spawn } = require('../../workflow/lib/run');
const { endTreeOf } = require('../../workflow/lib/tree');
const { nativePath } = require('../../workflow/lib/platform');

// The bound on a child when WORKKIT_JOB_TIMEOUT names none: 15 minutes.
const DEFAULT_TIMEOUT_S = 900;

// The code a bounded child that ran past its bound answers, as `timeout` exits.
const TIMED_OUT = 124;

// The longest a notification's message runs, in characters.
const NOTE_CHARS = 180;

/** The home the shell reads: HOME, else the account's. */
const homeOf = (env) => env.HOME || os.homedir();

/** Claude Code's session transcripts root under <home>. */
const projectsRoot = (home) => path.join(home, '.claude', 'projects');

/**
 * Puts `~/.local/bin`, `~/.nvm/default-bin`, `/opt/homebrew/bin` and
 * `/usr/local/bin` at the front of `env.PATH`, in that order, and turns off
 * Claude Code's nonessential traffic: launchd's PATH holds none of them.
 * @param {object} [env]
 */
const enterMachine = (env = process.env) => {
  const home = homeOf(env);
  const front = [path.join(home, '.local', 'bin'), path.join(home, '.nvm', 'default-bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  env.PATH = [...front, env.PATH ?? ''].join(path.delimiter);
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
};

/**
 * A positive number of seconds from the environment, else the default.
 * @param {string|undefined} value the variable's value
 * @param {number} fallback the seconds when it is unset or not a positive number
 * @returns {number}
 */
const secondsOf = (value, fallback) => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : fallback;
};

/**
 * The bound on a job's child, in milliseconds: WORKKIT_JOB_TIMEOUT seconds,
 * 900 when it is unset or not a positive number.
 * @param {object} [env]
 * @returns {number}
 */
const jobTimeout = (env = process.env) => secondsOf(env.WORKKIT_JOB_TIMEOUT, DEFAULT_TIMEOUT_S) * 1000;

/**
 * Runs one child to its end, stdin closed. Past the bound its whole tree is
 * ended and it answers 124, as a hang is a failure with no code of its own.
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options] spawn's, plus `bound`: the bound in ms, jobTimeout() of the env by default;
 *   `stdio` is spawn's, stdin closed and both streams read by default
 * @returns {Promise<{status: number, output: string, stdout: string, timedOut: boolean}>} output: stdout
 *   and stderr in the order they came, and the bound's own line; stdout: stdout alone
 */
const bounded = (command, args, { bound, stdio = ['ignore', 'pipe', 'pipe'], ...options } = {}) => new Promise((resolve) => {
  const chunks = [];
  const outChunks = [];
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
  }, bound ?? jobTimeout(options.env));
  child.stdout?.on('data', (chunk) => {
    chunks.push(chunk);
    outChunks.push(chunk);
  });
  child.stderr?.on('data', (chunk) => chunks.push(chunk));
  child.on('error', (err) => {
    chunks.push(Buffer.from(`${command}: ${err.message}\n`));
    finish(startFailed);
  });
  child.on('close', (code, signal) => finish(exitOf(code, signal)));
});

/** Notifly's binary: NOTIFLY first, then a per-user install, then a machine-wide one; null when none. */
const notifierPath = (home) => {
  if (process.env.NOTIFLY) return process.env.NOTIFLY;
  for (const dir of [path.join(home, 'Applications'), '/Applications']) {
    const app = path.join(dir, 'Notifly.app', 'Contents', 'MacOS', 'Notifly');
    try {
      fs.accessSync(app, fs.constants.X_OK);
      return app;
    } catch {
      // Not installed here: the next folder.
    }
  }
  return null;
};

/**
 * A desktop notification, started detached and never waited on: Notifly
 * returns only when the notification is dismissed. A missing app is one skip.
 * @param {string} message cut to its first 180 characters
 * @param {{noteSkip: function}} notes the job's note levels
 */
const notify = (message, notes) => {
  const home = homeOf(process.env);
  const app = notifierPath(home);
  if (app === null) {
    notes.noteSkip(`notify: Notifly is in neither ${nativePath(home)}/Applications nor /Applications; the notification was skipped`);
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const args = [
    '--title', 'Claude Daily',
    '--message', Array.from(message).slice(0, NOTE_CHARS).join(''),
    '--appIcon', path.join(home, '.claude', 'icon.png'),
    '--timeout', '10',
    '--sound', 'default',
  ];
  const child = spawn(app, args, {
    env, stdio: 'ignore', detached: true, windowsHide: true,
  });
  // A notifier that cannot start is as silent as one that started.
  child.on('error', () => {});
  child.unref();
};

module.exports = {
  homeOf, projectsRoot, enterMachine, secondsOf, jobTimeout, bounded, notify,
};
