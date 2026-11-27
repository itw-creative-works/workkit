#!/usr/bin/env node
/**
 * jobs/install.js: install this kit's 9am daily job with the machine's own
 * scheduler, only when something changed. On a Mac: renders jobs/<label>.plist
 * into ~/Library/LaunchAgents/ and (re)loads it, copied, never symlinked:
 * launchd expands nothing, and `launchctl bootstrap` is unreliable with
 * symlinked plists. On Windows: registers jobs/<label>.xml as a Task Scheduler
 * task (lib/task-scheduler.js). A scheduler is machine-global, so it is asked
 * only when HOME is this account's real home (jobs/README.md § The pieces).
 * Usage: node jobs/install.js [--check]
 * Called by: workflow/workkit/schedule.js (`workkit setup`, `update`, `doctor`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { codeOf } = require('../workflow/lib/detach');
const { isFile } = require('../workflow/lib/lock');
const { nativePath, cloneOutranks, physicalDir } = require('../workflow/lib/platform');
const { spawnSync } = require('../workflow/lib/run');
const { writeErr, writeOut } = require('../workflow/lib/say');
const { withScratch } = require('../workflow/lib/scratch');
const { spin } = require('../workflow/lib/spin');
const { ok, warn, error } = require('../workflow/lib/voice');
const { userDir } = require('../workflow/user-dir');
const { machineHome } = require('./lib/machine');
const { holds, skippedLine } = require('./lib/schedule');
const {
  renderTask, installTask, checkTask, copyPath,
} = require('./lib/task-scheduler');
const { chomp } = require('../hooks/mods/text.js');

const USAGE = 'usage: install.js [--check]\n';

// The one job this kit schedules.
const LABEL = 'com.workkit.claude-daily';

// Its schedule as a person reads it, the same on both systems.
const WHEN = '9:00 AM daily';

// Read once at load, as lib/run.js reads it; main's `platform` is the seam.
const PLATFORM = process.platform;

// The physical folders: a symlinked HOME must not read as a different home than
// the one the account record names.
const SCRIPT_DIR = fs.realpathSync(__dirname);
const WORKKIT_DIR = path.dirname(SCRIPT_DIR);

/**
 * What the account record says this user's home is. A record that cannot be
 * read answers nothing, and an unverified home is treated as not this account's.
 * @returns {string}
 */
const accountHome = () => {
  try {
    return os.userInfo().homedir;
  } catch (err) {
    if (!err.code) throw err;
    return '';
  }
};

/**
 * May this run talk to the scheduler, on either system? WORKKIT_SCHEDULE_OK=1
 * says yes outright.
 * @param {string} home
 * @returns {boolean}
 */
const scheduleAllowed = (home) => {
  if (process.env.WORKKIT_SCHEDULE_OK === '1') return true;
  const here = physicalDir(home);
  const record = accountHome();
  if (here === null || !record) return false;
  return here === physicalDir(record);
};

/** The Mac half's skip line, said `ok`. */
const skipLaunchd = (label, what) => {
  ok(skippedLine(label, what));
};

/**
 * The plist and the task reach the job through ~/.claude/workkit, so a link that is missing
 * or names another kit runs no job or that kit's; a workkit clone outranking this
 * cached copy is the one other answer that holds. Both modes say it.
 * @param {string} home
 * @param {string} label
 */
const checkEngineLink = (home, label) => {
  const link = path.join(home, '.claude', 'workkit');
  const linked = physicalDir(link) ?? '';
  if (linked === path.join(WORKKIT_DIR, 'workflow')) return;
  if (cloneOutranks(WORKKIT_DIR, linked)) return;
  if (!linked) {
    warn(`${label} → the job runs through ${nativePath(link)}, which does not resolve, so it cannot reach this kit; run \`workkit update\``);
  } else {
    warn(`${label} → the job runs through ${nativePath(link)}, which resolves to ${nativePath(linked)}, not this kit's ${nativePath(WORKKIT_DIR)}/workflow; run \`workkit update\``);
  }
};

/**
 * Whether plutil passes the rendered plist, linted from a scratch file removed after.
 * @throws {Error} when no scratch folder can be made, as a failed mkdtemp throws
 */
const lints = (text) => {
  const passed = withScratch((scratch) => {
    const rendered = path.join(scratch, 'rendered.plist');
    fs.writeFileSync(rendered, text, { mode: 0o600 });
    return spawnSync('plutil', ['-lint', rendered], { stdio: ['inherit', 'ignore', 'ignore'] }).status === 0;
  }, 'workkit-install.');
  if (passed === null) throw new Error('install: no scratch folder could be made to lint the plist');
  return passed;
};

/** A launchctl call, its output dropped; the shell's code it ended with. */
const launchctl = (message, args) => {
  const res = spin(message, () => spawnSync('launchctl', args, { stdio: ['inherit', 'ignore', 'ignore'] }), { line: false });
  return codeOf(res);
};

/** The path the loaded agent was registered from, read off `launchctl print`; '' when none. */
const loadedPath = (printed) => {
  for (const line of printed.split('\n')) {
    const match = /^[\t\n\v\f\r ]*path = ([\s\S]*)$/.exec(line);
    if (match) return match[1];
  }
  return '';
};

/**
 * The agent that is installed and current: loaded from this plist, or loaded
 * now. Loaded is not loaded from this plist: a scratch-HOME run leaves the label
 * claimed by a deleted temp path, so any other path, unreadable output included,
 * is re-registered rather than reported current.
 * @returns {number} the code the run ends with
 */
const confirmLoaded = (label, target, uid) => {
  const printed = spin('reading the loaded agent', () => spawnSync('launchctl', ['print', `gui/${uid}/${label}`], {
    encoding: 'utf8', stdio: ['inherit', 'pipe', 'ignore'],
  }), { line: false });
  if (printed.status !== 0) {
    const code = launchctl(`loading ${label}`, ['bootstrap', `gui/${uid}`, target]);
    if (code !== 0) return code;
    ok(`${label} → loaded (plist unchanged)`);
    return 0;
  }
  const loaded = loadedPath(chomp(printed.stdout));
  if (loaded === target) {
    ok(`${label} → already installed and loaded`);
    return 0;
  }
  launchctl(`unloading ${label}`, ['bootout', `gui/${uid}/${label}`]);
  const code = launchctl(`loading ${label}`, ['bootstrap', `gui/${uid}`, target]);
  if (code !== 0) return code;
  ok(`${label} → reloaded (was registered from ${loaded || 'an unreadable path'})`);
  return 0;
};

/**
 * Render, compare, and only on change copy and reload.
 * @param {{mode: string, home: string, scheduleOk: boolean}} run
 * @param {string} label
 * @param {string} when the schedule, as a person reads it
 * @returns {number} the code the run ends with
 */
const installAgent = (run, label, when) => {
  const template = path.join(SCRIPT_DIR, `${label}.plist`);
  const target = path.join(run.home, 'Library', 'LaunchAgents', `${label}.plist`);
  if (!isFile(template)) {
    error(`template missing: ${nativePath(template)}`);
    return 1;
  }
  // The job runs through the engine link, never a baked kit path, so a moved
  // kit or a plugin update that repoints the link needs no reinstall.
  const rendered = fs.readFileSync(template, 'utf8').split('{{HOME}}').join(run.home);
  if (!lints(rendered)) {
    error(`${label} → rendered plist fails plutil -lint`);
    return 1;
  }
  checkEngineLink(run.home, label);

  const installed = isFile(target);
  if (run.mode === 'check') {
    if (!installed) ok(`${label} → not installed`);
    else if (!holds(target, rendered)) ok(`${label} → out of date for this kit`);
    return 0;
  }

  if (installed && holds(target, rendered)) {
    if (!run.scheduleOk) {
      skipLaunchd(label, 'bootstrap it (plist unchanged)');
      return 0;
    }
    return confirmLoaded(label, target, process.getuid());
  }

  // Written through, as `cp` writes: a new file at the scratch copy's mode.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, rendered, { mode: 0o600 });

  if (!run.scheduleOk) {
    ok(`${label} → installed, not loaded (${when})`);
    skipLaunchd(label, 'bootout and bootstrap it');
    return 0;
  }

  // An agent loaded from the previous plist has to go before the new one can take
  // its label; a first install has nothing to remove. Both calls are silenced: the
  // step says only the line under it, since `workkit update` relays every line.
  const uid = process.getuid();
  launchctl(`unloading ${label}`, ['bootout', `gui/${uid}/${label}`]);
  const code = launchctl(`loading ${label}`, ['bootstrap', `gui/${uid}`, target]);
  if (code !== 0) return code;
  ok(`${label} → installed and loaded (${when})`);
  return 0;
};

/** `bytes` as UTF-8 text, or null when they are not valid UTF-8. */
const textOf = (bytes) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    return null;
  }
};

/**
 * Render the task for this Node, home and account, then the `--check` or the
 * registration of lib/task-scheduler.js.
 * @param {{mode: string, home: string, scheduleOk: boolean}} run
 * @param {string} label
 * @param {string} when the schedule, as a person reads it
 * @returns {number} the code the run ends with
 */
const installTaskFile = (run, label, when) => {
  const template = path.join(SCRIPT_DIR, `${label}.xml`);
  if (!isFile(template)) {
    error(`template missing: ${nativePath(template)}`);
    return 1;
  }
  const source = textOf(fs.readFileSync(template));
  if (source === null) {
    error(`${label} → the task template is not valid UTF-8 text`);
    return 1;
  }
  // The real Node, so a version manager's moving link never names another one.
  const text = renderTask(source, {
    node: fs.realpathSync(process.execPath),
    home: path.win32.normalize(run.home),
    user: os.userInfo().username,
  });
  checkEngineLink(run.home, label);
  const copy = copyPath(label, userDir(run.home));
  if (run.mode === 'check') {
    const { line } = checkTask({ label, text, copy });
    if (line) ok(line);
    return 0;
  }
  const { code, line } = installTask({
    label, text, copy, when, scheduleOk: run.scheduleOk,
  });
  if (code === 0) ok(line);
  else error(line);
  return code;
};

/**
 * The call.
 * @param {string[]} args
 * @param {{platform?: string}} [context] the system the run is for
 * @returns {number} 0; 1 for an unknown flag, another system, a missing template or a task file that is not valid text; a failed bootstrap's or `schtasks /create`'s own code
 */
const main = (args, { platform = PLATFORM } = {}) => {
  let mode = 'install';
  const first = args[0] ?? '';
  if (first === '--check') {
    mode = 'check';
  } else if (first === '-h' || first === '--help') {
    writeOut(USAGE);
    return 0;
  } else if (first.startsWith('--')) {
    writeErr(USAGE);
    return 1;
  }
  // The engine's voice with no indent: `workkit update` relays these lines
  // under its own glyph, stripping this one, so a line never wears two.
  process.env.WK_LOG_INDENT = '';
  if (platform !== 'darwin' && platform !== 'win32') {
    error(`install: the 9am job runs on macOS and Windows; ${platform} has no scheduler it knows`);
    return 1;
  }
  const home = machineHome();
  // `--check` never asks a scheduler anything, so it never asks this question either.
  const run = { mode, home, scheduleOk: mode === 'install' && scheduleAllowed(home) };
  if (platform === 'win32') return installTaskFile(run, LABEL, WHEN);
  return installAgent(run, LABEL, WHEN);
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main };
