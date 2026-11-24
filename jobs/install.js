#!/usr/bin/env node
/**
 * jobs/install.js: install this kit's LaunchAgent, the 9am daily job: renders
 * jobs/<label>.plist into ~/Library/LaunchAgents/ and (re)loads it, only when
 * something changed. Copied, never symlinked: launchd expands nothing, and
 * `launchctl bootstrap` is unreliable with symlinked plists. launchd is
 * machine-global, so it is asked only when HOME is this account's real home
 * (jobs/README.md § The pieces).
 * Usage: node jobs/install.js [--check]
 * Called by: workflow/workkit/schedule.sh (`workkit setup`, `update`, `doctor`).
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

const USAGE = 'usage: install.js [--check]\n';

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
 * May this run talk to launchd? WORKKIT_LAUNCHD_OK=1 says yes outright.
 * @param {string} home
 * @returns {boolean}
 */
const launchdAllowed = (home) => {
  if (process.env.WORKKIT_LAUNCHD_OK === '1') return true;
  const here = physicalDir(home);
  const record = accountHome();
  if (here === null || !record) return false;
  return here === physicalDir(record);
};

/** `<label> → would <what> (skipped ...)`: what a run kept from launchd would have done. */
const skipLaunchd = (label, what) => {
  ok(`${label} → would ${what} (skipped: HOME is not this account's home; set WORKKIT_LAUNCHD_OK=1 to force)`);
};

/**
 * The plist reaches the job through ~/.claude/workkit, so a link that is missing
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

/** Whether <file> holds exactly <text>; a file that cannot be read does not. */
const holds = (file, text) => {
  try {
    return fs.readFileSync(file).equals(Buffer.from(text));
  } catch (err) {
    if (!err.code) throw err;
    return false;
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
  const loaded = loadedPath(printed.stdout.replace(/\n+$/, ''));
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
 * @param {{mode: string, home: string, launchdOk: boolean}} run
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
    if (!run.launchdOk) {
      skipLaunchd(label, 'bootstrap it (plist unchanged)');
      return 0;
    }
    return confirmLoaded(label, target, process.getuid());
  }

  // Written through, as `cp` writes: a new file at the scratch copy's mode.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, rendered, { mode: 0o600 });

  if (!run.launchdOk) {
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

/**
 * The call.
 * @param {string[]} args
 * @returns {number} 0; 1 for an unknown flag, a missing template or a plist plutil refuses; a failed bootstrap's own code
 */
const main = (args) => {
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
  // The engine's voice, as lib.sh sets it: `workkit update` relays these lines
  // under its own glyph, stripping this one, so a line never wears two.
  process.env.WK_LOG_INDENT = '';
  const home = process.env.HOME;
  // `--check` never asks launchd anything, so it never asks this question either.
  const run = { mode, home, launchdOk: mode === 'install' && launchdAllowed(home) };
  return installAgent(run, 'com.workkit.claude-daily', '9:00 AM daily');
};

if (require.main === module) {
  // Set the code, never process.exit(): exiting discards output still buffered for a pipe.
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { main };
