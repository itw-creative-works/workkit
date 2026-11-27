/**
 * jobs/lib/machine.js: what a job needs from the machine it wakes up on under
 * launchd or Task Scheduler: its home and the transcripts root under it, the
 * folders its programs live in, the quiet Claude, the bound on a child, and the
 * notifier.
 * Usage: const { machineHome, projectsRoot, enterMachine, jobTimeout, bounded, notify } = require('../lib/machine');
 */

const fs = require('fs');
const path = require('path');
const { spawn, keyOf } = require('../../workflow/lib/run');
const { bounded: runBounded, secondsOf } = require('../../workflow/lib/bounded');
const { nativePath } = require('../../workflow/lib/platform');
// A job's home is the command's reading of it, handed on to the jobs.
const { machineHome } = require('../../workflow/lib/machine-home');

// Read once at load, as lib/run.js reads it: enterMachine's `platform` is the seam.
const PLATFORM = process.platform;

// The bound on a child when WORKKIT_JOB_TIMEOUT names none: 15 minutes.
const DEFAULT_TIMEOUT_S = 900;

// The longest a notification's message runs, in characters.
const NOTE_CHARS = 180;

/** Claude Code's session transcripts root under <home>. */
const projectsRoot = (home) => path.join(home, '.claude', 'projects');

/**
 * Puts `~/.local/bin`, `~/.nvm/default-bin`, `/opt/homebrew/bin` and
 * `/usr/local/bin` at the front of `env.PATH`, in that order, and turns off
 * Claude Code's nonessential traffic: launchd's PATH holds none of them. On
 * Windows the front is the first two and `node`'s own folder, in the PATH key
 * `env` already spells (`Path`), else `PATH`.
 * @param {object} [env]
 * @param {{ platform?: string, node?: string }} [context] - the platform the PATH is for, and the running node
 */
const enterMachine = (env = process.env, { platform = PLATFORM, node = process.execPath } = {}) => {
  const home = machineHome(env, { platform });
  if (platform === 'win32') {
    const key = keyOf(env, 'PATH') ?? 'PATH';
    const front = [path.win32.join(home, '.local', 'bin'), path.win32.join(home, '.nvm', 'default-bin'), path.win32.dirname(node)];
    env[key] = [...front, env[key] ?? ''].join(path.win32.delimiter);
  } else {
    const front = [path.posix.join(home, '.local', 'bin'), path.posix.join(home, '.nvm', 'default-bin'), '/opt/homebrew/bin', '/usr/local/bin'];
    env.PATH = [...front, env.PATH ?? ''].join(path.posix.delimiter);
  }
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
};

/**
 * The bound on a job's child, in milliseconds: WORKKIT_JOB_TIMEOUT seconds,
 * 900 when it is unset or not a positive number.
 * @param {object} [env]
 * @returns {number}
 */
const jobTimeout = (env = process.env) => secondsOf(env.WORKKIT_JOB_TIMEOUT, DEFAULT_TIMEOUT_S) * 1000;

/**
 * A job's child run to its end under `bounded` of workflow/lib/bounded.js,
 * the bound jobTimeout() of the env unless one is given.
 * @param {string} command
 * @param {string[]} args
 * @param {object} [options] as workflow/lib/bounded.js takes them, `bound` optional here
 * @returns {Promise<{status: number, output: string, stdout: string, stderr: string, timedOut: boolean}>}
 */
const bounded = (command, args, { bound, ...options } = {}) => runBounded(command, args, { bound: bound ?? jobTimeout(options.env), ...options });

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
  const home = machineHome();
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
  machineHome, projectsRoot, enterMachine, jobTimeout, bounded, notify,
};
