/**
 * workflow/workkit/doctor.js: `doctor`, every report in its order under its
 * four sections, the lines that need attention counted, and the closing line
 * that says how many. It changes nothing. This machine's own checks are
 * doctor-machine.js's and the roster's line roster.js's.
 * Usage: const { doctor } = require('./doctor');
 */

const {
  ok, skip, info, warn, title, section, done,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isCloud } = require('../lib/cloud');
const { homeRun, flagged } = require('./kit');
const { checkGh, repoState } = require('./install');
const { scriptShell } = require('./npm-shell');
const { reportAllowRules } = require('./allow');
const { identityReport } = require('./identity');
const { secretsReport } = require('./secrets');
const { reportGlobals } = require('./roster');
const { cloudNa, gitHooksLine, homeReady } = require('./setup');
const {
  reportPlugin, reportEngine, reportCommand, reportGhShim, reportGitShim, reportSchedule,
} = require('./doctor-machine');

/**
 * The This machine section: every check, then the roster's line under it.
 * @param {object} kit
 * @returns {Promise<number>} how many need attention
 */
const machine = async (kit) => {
  section('💻 This machine');
  let attention = reportPlugin(kit);
  attention += flagged(checkGh(kit));
  attention += reportEngine(kit);
  attention += reportCommand(kit);
  attention += reportGhShim(kit);
  attention += reportGitShim(kit);
  attention += flagged(scriptShell(kit, 'doctor'));
  attention += reportAllowRules(kit);
  attention += reportSchedule(kit);
  attention += await identityReport(kit, 'machine');
  reportGlobals(kit);
  return attention;
};

/**
 * The Home repo section: whether one is named, whether the folder is its
 * clone and where it stands, and the seeded cloud runner's drift.
 * @param {object} kit
 * @returns {number} how many need attention
 */
const home = (kit) => {
  section('🏠 Home repo');
  if (isCloud(kit.env)) {
    cloudNa(kit, 'home');
    cloudNa(kit, 'runner');
    return 0;
  }
  if (!homeReady(kit)) return 1;
  return homeRun(kit, ['doctor'], { stdio: 'inherit' }).code + homeRun(kit, ['runner-doctor'], { stdio: 'inherit' }).code;
};

/**
 * The Cloud brief secrets section.
 * @param {object} kit
 * @returns {Promise<number>} how many need attention
 */
const secrets = async (kit) => {
  section('🔑 Cloud brief secrets');
  if (!isCloud(kit.env)) return secretsReport(kit, 'doctor');
  cloudNa(kit, 'secrets');
  return 0;
};

/**
 * The This repo section: the folder the command stands in, its git hooks and its bot.
 * @param {object} kit
 * @returns {Promise<number>} how many need attention
 */
const repo = async (kit) => {
  section('📁 This repo');
  const here = nativePath(process.cwd());
  const state = repoState(kit);
  if (state === 'enabled') ok(`repo: ${here} is in the workflow`);
  else if (state === 'nogit') skip(`repo: ${here} is not a git repo`);
  else info(`repo: ${here} is '${state}'; \`workkit enable\` joins it`);
  const attention = flagged(await gitHooksLine(kit, state));
  return attention + await identityReport(kit, 'repo');
};

/**
 * `workkit doctor`: what this machine, its home repo, the cloud brief's
 * secrets and this repo need, each with the command that fixes it.
 * @param {object} kit
 * @returns {Promise<number>} 0, whatever it found: the count is only said
 */
const doctor = async (kit) => {
  title(`🩺 workkit doctor in ${nativePath(kit.root)}`);
  let attention = await machine(kit);
  attention += home(kit);
  attention += await secrets(kit);
  attention += await repo(kit);
  if (attention > 0) warn(`${attention} item(s) need attention: the command to fix each is above.`);
  else done('Everything this command can see is current.');
  return 0;
};

module.exports = { doctor };
