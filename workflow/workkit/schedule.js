/**
 * workflow/workkit/schedule.js: the 9am schedule: its drift against the kit's
 * job template, the installer run, the update that keeps an installed schedule
 * current, and the first install that only `setup` makes.
 * Usage: const { cronDrift, installCron, updateCron, scheduleHere, driftNotInstalled } = require('./schedule');
 */

const fs = require('fs');
const path = require('path');
const { nodeRead } = require('./kit');
const {
  ok, skip, info, warn, plain, ESCAPE,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isFile } = require('../lib/lock');
const { withScratch } = require('../lib/scratch');
const { chomp } = require('../../hooks/mods/text.js');

/**
 * Whether this system has a scheduler the installer knows: a Mac's launchd or
 * Windows' Task Scheduler.
 * @param {object} kit
 * @returns {boolean}
 */
const scheduleHere = (kit) => kit.platform === 'darwin' || kit.platform === 'win32';

/**
 * Whether a drift answer says the job is not installed on this machine: one
 * of its lines ends ` → not installed`.
 * @param {string} drift
 * @returns {boolean}
 */
const driftNotInstalled = (drift) => `\n${drift}\n`.includes(' → not installed\n');

/**
 * What the installed schedule differs from the kit's template in, one line
 * per job, empty when current. A missing installer or an unfinished check
 * answers code 1 with its reason after whatever the check printed, so neither reads as current.
 * @param {object} kit
 * @returns {{code: number, drift: string}}
 */
const cronDrift = (kit) => {
  const installer = kit.files.installer;
  if (!isFile(installer)) return { code: 1, drift: `the installer is missing at ${nativePath(installer)}; the kit is incomplete` };
  const res = nodeRead(kit, installer, ['--check']);
  const printed = plain(res.stdout);
  if (res.code === 0) return { code: 0, drift: chomp(printed) };
  return { code: 1, drift: chomp(`${printed}the drift check did not finish; run \`node ${nativePath(installer)} --check\` to see why\n`) };
};

/** The installer run with its two streams in one file, in the order it wrote them: `{ code, out }`. */
const installerRun = (kit) => withScratch((scratch) => {
  const file = path.join(scratch, 'install.log');
  const fd = fs.openSync(file, 'w');
  let code;
  try {
    ({ code } = nodeRead(kit, kit.files.installer, [], { stdio: ['inherit', fd, fd] }));
  } finally {
    fs.closeSync(fd);
  }
  return { code, out: fs.readFileSync(file, 'utf8') };
}, 'workkit-install.');

/**
 * Run the installer and relay only what it did, in its own words: a warning
 * stays a warning, "already installed" is a no-op and dropped. A failure is
 * reported and passed over.
 * @param {object} kit
 * @returns {number} 0
 */
const runInstaller = (kit) => {
  const run = installerRun(kit);
  if (run === null) {
    warn(`schedule: no temp folder for the installer's output, so the install did not run; run \`node ${nativePath(kit.files.installer)}\` by hand`);
    return 0;
  }
  if (run.code !== 0) {
    warn(`schedule: the install did not finish (exit ${run.code}); run \`node ${nativePath(kit.files.installer)}\` to see why`);
    return 0;
  }
  for (const raw of chomp(run.out).split('\n')) {
    const line = raw.replace(ESCAPE, '');
    if (line.includes(' → already installed') || /^\s*$/.test(line)) continue;
    if (line.trimStart().startsWith('⚠ ')) warn(`schedule: ${plain(line)}`);
    else ok(`schedule: ${plain(line)}`);
  }
  return 0;
};

/** The drift, or null after its warning when the check cannot answer. */
const driftOrWarn = (kit) => {
  const { code, drift } = cronDrift(kit);
  if (code === 0) return drift;
  warn(`schedule: ${drift}`);
  return null;
};

/**
 * Re-render and reload only a schedule the machine already has: installing
 * one is a human's decision, made in `setup`.
 * @param {object} kit
 * @returns {number} 0
 */
const updateCron = (kit) => {
  if (!scheduleHere(kit)) {
    skip('schedule: the 9am job runs on macOS and Windows; nothing to keep current here');
    return 0;
  }
  const drift = driftOrWarn(kit);
  if (drift === null) return 0;
  if (driftNotInstalled(drift)) {
    info('schedule: not installed on this machine; `workkit setup` installs the 9am job');
    return 0;
  }
  if (drift === '') {
    skip(`schedule: ${kit.DAILY_LABEL} is current`);
    return 0;
  }
  return runInstaller(kit);
};

/**
 * The first install of the schedule, under `setup` alone; `update` keeps it
 * current after. A check that cannot answer stops the step rather than
 * installing on a guess.
 * @param {object} kit
 * @returns {number} 0
 */
const installCron = (kit) => {
  if (!scheduleHere(kit)) {
    skip('schedule: the 9am job runs on macOS and Windows; it is not available here');
    return 0;
  }
  const drift = driftOrWarn(kit);
  if (drift === null) return 0;
  if (drift === '') {
    skip(`schedule: ${kit.DAILY_LABEL} is installed and current`);
    return 0;
  }
  return runInstaller(kit);
};

module.exports = {
  cronDrift, installCron, updateCron, scheduleHere, driftNotInstalled,
};
