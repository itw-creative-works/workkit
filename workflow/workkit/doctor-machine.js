/**
 * workflow/workkit/doctor-machine.js: doctor's own checks of this machine, each
 * a report that changes nothing and answers how many lines need attention:
 * the plugin, the engine's address, the home variables, the command and its
 * PATH, the gh and git shims, and the 9am schedule.
 * Usage: const { reportPlugin, reportEngine, reportHomes, reportCommand, reportGhShim, reportGitShim, reportSchedule } = require('./doctor-machine');
 */

const {
  ok, skip, warn,
} = require('../lib/voice');
const { onPath } = require('../lib/run');
const {
  nativePath, UNREAD_PATH, physicalDir, physicalPath, cloneOutranks,
} = require('../lib/platform');
const { isLink } = require('../lib/link');
const { isFile } = require('../lib/lock');
const { isCloud } = require('../lib/cloud');
const { executable } = require('../lib/participation');
const { shellOnlyHomes } = require('../../hooks/mods/markers.js');
const {
  reportBinLink, reportCmdLink, pathLine, GH_SHIM_OURS,
} = require('./links');
const { pluginInstalled } = require('./install');
const { cronDrift, scheduleHere, driftNotInstalled } = require('./schedule');
const { cloudNa } = require('./setup');

/**
 * The plugin, as setup reads it; a machine without claude is a skip.
 * @param {object} kit
 * @returns {number} 1 when it is not installed
 */
const reportPlugin = (kit) => {
  if (onPath('claude', { env: kit.env }) === null) {
    skip('plugin: no claude CLI on this machine');
    return 0;
  }
  if (pluginInstalled(kit)) {
    ok(`plugin: ${kit.PLUGIN_ID} is installed`);
    return 0;
  }
  warn(`plugin: ${kit.PLUGIN_ID} is not installed; run \`${isCloud(kit.env) ? 'workkit setup --cloud' : 'workkit setup'}\``);
  return 1;
};

/**
 * The engine's address: this engine, or a workkit clone that outranks the plugin cache.
 * @param {object} kit
 * @returns {number} 1 when it points at neither
 */
const reportEngine = (kit) => {
  const address = nativePath(kit.engineLink);
  const linked = isLink(kit.engineLink) ? physicalDir(kit.engineLink) : null;
  if (linked === kit.engine) {
    ok(`engine: ${address} → ${nativePath(kit.engine)}`);
    return 0;
  }
  if (linked !== null && cloneOutranks(kit.root, linked)) {
    ok(`engine: ${address} → ${nativePath(linked)}, the workkit clone, which outranks the plugin cache`);
    return 0;
  }
  warn(`engine: ${address} does not point at this engine; run \`workkit update\``);
  return 1;
};

/**
 * The Windows folder Git Bash's `/` is, as cygpath answers it, '' when none can
 * (no cygpath on PATH); off Windows nativePath starts nothing and answers `/`.
 * @param {object} kit
 * @returns {string}
 */
const shellRootOf = (kit) => {
  try {
    return nativePath('/', { platform: kit.platform });
  } catch (err) {
    if (err.code !== UNREAD_PATH) throw err;
    return '';
  }
};

/**
 * Each home variable only Git Bash can read (shellOnlyHomes): the hooks read it
 * by its spelling and the commands through cygpath, so they name two folders.
 * Each prints as Git Bash spells it, the list's `spelled`.
 * @param {object} kit
 * @returns {number} how many there are
 */
const reportHomes = (kit) => {
  const homes = shellOnlyHomes(kit.env, kit.platform, shellRootOf(kit));
  for (const { name, spelled } of homes) {
    warn(`env: ${name} (${spelled}) is a path only Git Bash can read, so the hooks and the commands read different folders; set it as a drive path (C:/...)`);
  }
  return homes.length;
};

/**
 * The command link, then the PATH that must hold its folder, then on Windows
 * its workkit.cmd, in the order the machine steps make them.
 * @param {object} kit
 * @returns {number} how many need attention
 */
const reportCommand = (kit) => {
  let attention = 0;
  if (reportBinLink(kit, kit.files.entry, kit.binLink, 'command') !== 0) attention += 1;
  else {
    const line = pathLine(kit, 'doctor');
    if (line !== null) {
      warn(line);
      attention += 1;
    }
  }
  return attention + reportCmdLink(kit);
};

/**
 * The gh shim's link, and whether the gh PATH finds first is that link, the one way the shim runs.
 * @param {object} kit
 * @returns {number} 1 when it needs attention
 */
const reportGhShim = (kit) => {
  if (reportBinLink(kit, kit.files.ghShim, kit.ghShimLink, 'gh shim', GH_SHIM_OURS) !== 0) return 1;
  const first = onPath('gh', { env: kit.env });
  if (first === null || physicalPath(first) === physicalPath(kit.ghShimLink)) return 0;
  warn(`gh shim: ${nativePath(first)} comes first on PATH, so the shim never runs; put ~/.local/bin ahead of it`);
  return 1;
};

/**
 * The git shim: a session's start puts any kit copy's gitshim/ first on PATH,
 * so it is checked from inside a session alone.
 * @param {object} kit
 * @returns {number} 1 when it needs attention
 */
const reportGitShim = (kit) => {
  const shim = kit.files.gitShim;
  if (!isFile(shim) || !executable(shim)) {
    warn(`git shim: ${nativePath(shim)} is missing or not executable; the kit is incomplete`);
    return 1;
  }
  if (kit.env.CLAUDECODE !== '1') {
    skip('git shim: a session puts it first on PATH at its start; doctor checks it from inside one');
    return 0;
  }
  const first = onPath('git', { env: kit.env });
  if (first !== null && /[\\/]workflow[\\/]gitshim[\\/]git$/.test(physicalPath(first) ?? '')) {
    ok(`git shim: ${nativePath(first)} comes first on PATH`);
    return 0;
  }
  warn(`git shim: ${first === null ? 'no git' : nativePath(first)} comes first on PATH, so safety:tree-guard is off in this session; a session restart puts the shim first`);
  return 1;
};

/**
 * The 9am job against the kit's template: one warning per drift line, counted once.
 * @param {object} kit
 * @returns {number} 1 when it needs attention
 */
const reportSchedule = (kit) => {
  if (isCloud(kit.env)) {
    cloudNa(kit, 'schedule');
    return 0;
  }
  if (!scheduleHere(kit)) {
    skip('schedule: the 9am job runs on macOS and Windows');
    return 0;
  }
  const { code, drift } = cronDrift(kit);
  if (code !== 0) warn(`schedule: ${drift}`);
  else if (driftNotInstalled(drift)) warn('schedule: the 9am job is not installed; run `workkit setup`');
  else if (drift === '') {
    ok(`schedule: ${kit.DAILY_LABEL} is installed and current`);
    return 0;
  } else {
    for (const line of drift.split('\n')) warn(`schedule: ${line}; run \`workkit update\``);
  }
  return 1;
};

module.exports = {
  reportPlugin, reportEngine, reportHomes, reportCommand, reportGhShim, reportGitShim, reportSchedule,
};
