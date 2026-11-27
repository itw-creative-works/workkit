/**
 * workflow/workkit/setup.js: `setup`, the wizard that runs every step in its
 * order, its flags, the home repo's step, the git hooks line, and the
 * not-applicable line a cloud session gets, which update and doctor print too.
 * Every step it calls lives in the other files of this folder.
 * Usage: const { setup, cloudNa, gitHooksLine, homeReady, homeSteps } = require('./setup');
 */

const {
  skip, warn, error, ok, title, section, done,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isFile } = require('../lib/lock');
const { repoRoot, localConfig } = require('../lib/git');
const { githooksKit } = require('../lib/participation');
const {
  nodeRun, homeEnv, homeRun, homeMissing, flagged,
} = require('./kit');
const { machineLinks } = require('./links');
const { installCron } = require('./schedule');
const {
  installPlugin, checkGh, towerPointer, repoState, offerRepo,
} = require('./install');
const { offerSitePublish } = require('./site');
const { secretsStep, tokenStep } = require('./secrets');
const { handoverToken } = require('./token');
const { identityStep, identityInstallStep, identityReport } = require('./identity');
const { publish } = require('./commands');

// Each step a cloud session has no use for, and why; `signin` is labelled identity.
const CLOUD_NA = {
  plugin: 'the session installs plugins from its settings',
  schedule: "the 9am job belongs to a machine's own scheduler",
  tower: 'the dashboard runs on your own machine',
  home: 'the home repo is cloned on your own machine',
  runner: "the cloud brief's runner is compared on your own machine",
  secrets: "the cloud brief's secrets are set from your own machine",
  site: 'publishing runs from your own machine',
  repo: 'a repo joins through its committed .workkit/settings.json',
  identity: "workkit-agent[bot]'s install is an owner's click on GitHub",
  signin: "the session's GitHub proxy signs every call as the account",
};

/**
 * A step a cloud session has no use for, one skip line labelled
 * by the step, counted by nothing.
 * @param {object} kit
 * @param {string} step a key of the not-applicable table
 * @returns {number} 0, or 1 after the error for a step it has no reason for
 */
const cloudNa = (kit, step) => {
  if (!Object.hasOwn(CLOUD_NA, step)) {
    error(`cloudNa: no reason for ${step}`);
    return 1;
  }
  skip(`${step === 'signin' ? 'identity' : step}: not applicable in a cloud session; ${CLOUD_NA[step]}`);
  return 0;
};

/**
 * Whether home.js is beside this engine; a kit without it is told so.
 * @param {object} kit
 * @returns {boolean}
 */
const homeReady = (kit) => {
  if (isFile(kit.files.home)) return true;
  warn(homeMissing(kit, 'home'));
  return false;
};

/**
 * The home repo half of setup, home.js's setup verb on this
 * terminal. Forced (`setup --home`), a kit without home.js is a failure.
 * @param {object} kit
 * @param {*} [force] truthy for `setup --home`
 * @returns {number} home.js's code; without it 0, or 1 forced
 */
const homeSteps = (kit, force) => {
  if (!homeReady(kit)) return force ? 1 : 0;
  return homeRun(kit, ['setup', ...(force ? ['force'] : [])], { stdio: 'inherit' }).code;
};

/** The folder core.hooksPath names in <root> when it is a kit's hooks folder, else null. */
const gitHooksInstalled = (root) => {
  const folder = localConfig(root, ['--path', 'core.hooksPath']);
  return githooksKit(root, folder) === null ? null : folder;
};

/**
 * The This repo line for git's commit hooks in an enabled
 * repo. `heal` (setup) sets them first when not installed, through
 * standards.js --git-hooks in this command's stream, indent and quiet.
 * @param {object} kit
 * @param {string} state the repo's state, repoState's word
 * @param {'heal'} [heal]
 * @returns {Promise<number>} 1 with the warning naming setup when not installed, else 0
 */
const gitHooksLine = async (kit, state, heal) => {
  if (state !== 'enabled') return 0;
  const root = repoRoot(process.cwd());
  if (root === null) return 0;
  let folder = gitHooksInstalled(root);
  if (folder === null && heal === 'heal') {
    await nodeRun(kit, kit.files.standards, ['--git-hooks', root], { env: homeEnv(kit) });
    folder = gitHooksInstalled(root);
  }
  if (folder !== null) {
    ok(`git hooks: installed (${folder})`);
    return 0;
  }
  warn('git hooks: not installed; run `workkit setup`');
  return 1;
};

/**
 * Each step in turn, ended at the first that answers a code other than 0;
 * a step that answers nothing counts as 0.
 * @param {object} kit
 * @param {Array<(kit: object) => (number|void|Promise<number|void>)>} steps
 * @returns {Promise<number>}
 */
const inTurn = async (kit, steps) => {
  for (const step of steps) {
    const code = (await step(kit)) ?? 0;
    if (code !== 0) return code;
  }
  return 0;
};

// The full run: checkGh and gitHooksLine go on whatever they answer.
const FULL_RUN = [
  () => section('💻 This machine'),
  installPlugin,
  (kit) => { checkGh(kit); },
  machineLinks,
  installCron,
  towerPointer,
  () => section('🏠 Home repo'),
  homeSteps,
  // After the home steps, because the repo it writes to is the home repo they settle.
  () => section('🔑 Cloud brief secrets'),
  secretsStep,
  () => section('🪪 Identity'),
  identityStep,
  () => section('🌐 Dashboard site'),
  offerSitePublish,
  async (kit) => {
    if (kit.run.sitePublish !== 'true') return 0;
    await publish(kit);
    // A token handed to an unfinished publish is handed to a stale site.
    if (!kit.run.publishFailed) return handoverToken(kit);
    skip('site: the token handover waits for a publish that finished');
    return 0;
  },
  () => section('📁 This repo'),
  offerRepo,
  async (kit) => { await gitHooksLine(kit, repoState(kit), 'heal'); },
  identityInstallStep,
  () => done('Setup is idempotent: re-run it any time. `workkit doctor` reports what is left.'),
];

// `setup --cloud`: the gh login check, the links and npm's script-shell as update makes them; one line for each other step.
const CLOUD_RUN = [
  () => section('💻 This machine'),
  (kit) => cloudNa(kit, 'plugin'),
  (kit) => { checkGh(kit); },
  machineLinks,
  (kit) => cloudNa(kit, 'schedule'),
  (kit) => cloudNa(kit, 'tower'),
  () => section('🏠 Home repo'),
  (kit) => cloudNa(kit, 'home'),
  () => section('🔑 Cloud brief secrets'),
  (kit) => cloudNa(kit, 'secrets'),
  () => section('🪪 Identity'),
  (kit) => identityReport(kit, 'machine'),
  () => section('🌐 Dashboard site'),
  (kit) => cloudNa(kit, 'site'),
  () => section('📁 This repo'),
  (kit) => cloudNa(kit, 'repo'),
  (kit) => cloudNa(kit, 'identity'),
];

// Each flag's title and the one step it runs, whose code is the run's.
const FLAGS = {
  '--token': ["🔑 workkit setup --token: the cloud brief's Claude token", tokenStep],
  '--login': ["🪪 workkit setup --login: the bot identity's sign-in", async (kit) => flagged(await identityStep(kit, 'force'))],
  '--bot': ["🤖 workkit setup --bot: workkit-agent[bot]'s install on this repo's owner", async (kit) => flagged(await identityInstallStep(kit, 'force'))],
  '--home': ['🏠 workkit setup --home: the home repo', async (kit) => flagged(homeSteps(kit, 'force'))],
  '--cloud': ['☁️ workkit setup --cloud: this cloud session', (kit) => inTurn(kit, CLOUD_RUN)],
};

/**
 * `workkit setup [flag]`: every step in its order, or the one step a flag
 * names. Setup is idempotent; each step checks before it acts.
 * @param {object} kit
 * @param {string} [flag] `--token`, `--login`, `--bot`, `--home` or `--cloud`; none for the full run
 * @returns {Promise<number>} 0, the code of the step that ended the run, or 1 for an unknown flag
 */
const setup = async (kit, flag) => {
  if (flag) {
    if (!Object.hasOwn(FLAGS, flag)) {
      error(`setup: unknown option ${flag}`);
      return 1;
    }
    const [heading, step] = FLAGS[flag];
    title(heading);
    return step(kit);
  }
  title(`🧰 workkit setup in ${nativePath(kit.root)}`);
  return inTurn(kit, FULL_RUN);
};

module.exports = {
  setup, cloudNa, gitHooksLine, homeReady, homeSteps,
};
