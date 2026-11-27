/**
 * workflow/workkit/kit.js: the one context every step of the command takes,
 * `kit`: one run's whole context (the variables, the system,
 * the kit's own files and addresses, the answers one run carries), the two
 * starts of a Node program the command runs as a program, the start of a
 * home.js verb in the caller's voice, the line for a missing program, and one
 * reading of an answer the steps share.
 * Usage: const { kitOf, nodeRun, nodeRead, homeEnv, homeRun, missingLine, homeMissing, flagged } = require('./kit');
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('../lib/run');
const { exitOf } = require('../lib/detach');
const { secondsOf, nonNegativeOf } = require('../lib/bounded');
const { childEnd } = require('../lib/child-end');
const { interactive } = require('../lib/flows');
const { indent, quiet } = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { machineHome } = require('../lib/machine-home');
const { userDir, scriptShellExeOf, hooksLogOf } = require('../../hooks/mods/log.js');
const { isPlain } = require('../../hooks/mods/settings.js');

// The real engine, links resolved, so a start through a linked folder finds the real kit.
const ENGINE = fs.realpathSync(path.join(__dirname, '..'));
const ROOT = path.dirname(ENGINE);

/** <over> merged into <base> key by key where both hold an object; any other value replaces. */
const merged = (base, over) => {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = isPlain(value) && isPlain(base[key]) ? merged(base[key], value) : value;
  }
  return out;
};

/** The programs and pieces the command starts or reads, under the real engine and kit. */
const filesOf = (engine, root) => ({
  entry: path.join(engine, 'workkit.js'),
  standards: path.join(engine, 'standards.js'),
  publish: path.join(engine, 'publish.js'),
  home: path.join(engine, 'home.js'),
  note: path.join(engine, 'note.js'),
  prove: path.join(engine, 'prove.js'),
  supervise: path.join(engine, 'supervise.js'),
  watch: path.join(engine, 'watch.js'),
  identityClient: path.join(engine, 'identity', 'token.js'),
  identityLogin: path.join(engine, 'identity', 'login.js'),
  installer: path.join(root, 'jobs', 'install.js'),
  tower: path.join(root, 'tower', 'start.js'),
  morning: path.join(root, 'jobs', 'morning.js'),
  briefDispatch: path.join(root, 'jobs', 'brief-dispatch.js'),
  coreBin: path.join(root, 'packages', 'core', 'bin', 'workkit.js'),
  ptyScript: path.join(engine, 'workkit', 'mint-pty.exp'),
  cmdTemplate: path.join(engine, 'workkit.cmd'),
  ghShim: path.join(engine, 'identity', 'gh'),
  gitShim: path.join(engine, 'gitshim', 'git'),
});

/**
 * The command's context. Each field derived from the variables reads the
 * overridden ones, so `{ env: { HOME } }` moves every home address with it.
 * @param {object} [overrides] fields deep-merged over the defaults (a test's seam)
 * @returns {object} env, platform, home, engine, root, files, the names and
 *   addresses (the machine folder `userDir` and its `shellExe` and `hooksLog`
 *   among them), interactive, secrets, pagesWait and run
 */
const kitOf = (overrides = {}) => {
  const env = overrides.env ? { ...process.env, ...overrides.env } : process.env;
  const home = machineHome(env);
  const binDir = `${home}/.local/bin`;
  const claudeHome = env.WORKFLOW_CLAUDE_HOME || `${home}/.claude`;
  // The machine folder under that home; its files keep their one spelling in hooks/mods/log.js.
  const machineDir = nativePath(userDir(env.WORKFLOW_HOME, home));
  const inMachineDir = { WORKFLOW_HOME: machineDir };
  const base = {
    env,
    platform: process.platform,
    home,
    engine: ENGINE,
    root: ROOT,
    files: filesOf(ENGINE, ROOT),
    PLUGIN_ID: 'workkit@workkit',
    DAILY_LABEL: 'com.workkit.claude-daily',
    binDir,
    binLink: `${binDir}/workkit`,
    cmdLink: `${binDir}/workkit.cmd`,
    ghShimLink: `${binDir}/gh`,
    claudeHome,
    engineLink: `${claudeHome}/workkit`,
    userDir: machineDir,
    shellExe: scriptShellExeOf(inMachineDir),
    hooksLog: hooksLogOf(inMachineDir),
    interactive: interactive(),
    // The OAuth token lives about a year, so ~11 months is when a refresh is worth offering.
    secrets: {
      claude: 'CLAUDE_CODE_OAUTH_TOKEN', home: 'WORKKIT_GITHUB_TOKEN', maxAgeDays: 330, timeout: secondsOf(env.WORKKIT_GH_TIMEOUT, 10),
    },
    // A wait of 0 skips at once; junk, a negative or a blank value is the default.
    pagesWait: nonNegativeOf(env.WORKKIT_PAGES_WAIT, 180),
    run: {
      sitePublish: '', publishFailed: false, secretsSlug: '', secretsJson: '', identity: null, atEnd: [],
    },
  };
  return merged(base, overrides);
};

/**
 * A Node program started as a program, by the running Node, on this terminal.
 * @param {object} kit
 * @param {string} file the program
 * @param {string[]} [args]
 * @param {object} [options] spawn's options over the defaults (stdio inherited, kit.env)
 * @returns {Promise<number>} the program's code
 */
const nodeRun = async (kit, file, args = [], options = {}) => {
  const child = spawn(process.execPath, [file, ...args], {
    stdio: 'inherit', env: kit.env, windowsHide: true, ...options,
  });
  return (await childEnd(child)).code;
};

/**
 * A Node program started as a program, by the running Node, its two streams read.
 * @param {object} kit
 * @param {string} file the program
 * @param {string[]} [args]
 * @param {object} [options] spawnSync's options over the defaults (stdin inherited, utf8, kit.env)
 * @returns {{code: number, stdout: string, stderr: string}} a `timeout` that ended it answers its signal's code
 * @throws {Error} a program that could not be started
 */
const nodeRead = (kit, file, args = [], options = {}) => {
  const res = spawnSync(process.execPath, [file, ...args], {
    stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', env: kit.env, windowsHide: true, ...options,
  });
  if (res.status === null && res.signal === null) throw res.error;
  return { code: exitOf(res.status, res.signal), stdout: res.stdout, stderr: res.stderr };
};

/**
 * The variables a home.js verb is started with: the caller's voice handed
 * over (its stream, indent and quiet).
 * @param {object} kit
 * @returns {object}
 */
const homeEnv = (kit) => ({
  ...kit.env, WK_LOG_STDERR: kit.env.WK_LOG_STDERR || '0', WK_LOG_INDENT: indent(), QUIET: quiet() ? '1' : '0',
});

/**
 * One verb of home.js, a program of the running Node, in the caller's voice;
 * stdout read and stderr on this terminal unless <options> say otherwise.
 * @param {object} kit
 * @param {string[]} args the verb and its arguments
 * @param {object} [options] spawnSync's options over those (`{ stdio: 'inherit' }` for a verb that talks)
 * @returns {{code: number, stdout: string|null, stderr: string|null}}
 */
const homeRun = (kit, args, options = {}) => nodeRead(kit, kit.files.home, args, {
  stdio: ['inherit', 'pipe', 'inherit'], ...options, env: homeEnv(kit),
});

/**
 * The line a step prints for a program of the kit that is not there.
 * @param {string} step the step's label
 * @param {string} file the missing program
 * @returns {string}
 */
const missingLine = (step, file) => `${step}: ${path.basename(file)} is missing at ${nativePath(file)}; the kit is incomplete`;

/**
 * missingLine for a kit with no home.js beside its engine.
 * @param {object} kit
 * @param {string} step the step's label
 * @returns {string}
 */
const homeMissing = (kit, step) => missingLine(step, kit.files.home);

/**
 * A step's code as one count: 0 stays 0, any failure is 1.
 * @param {number} code
 * @returns {number} 0 or 1
 */
const flagged = (code) => (code !== 0 ? 1 : 0);

module.exports = {
  kitOf, nodeRun, nodeRead, homeEnv, homeRun, missingLine, homeMissing, flagged,
};
