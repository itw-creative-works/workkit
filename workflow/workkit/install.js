/**
 * workflow/workkit/install.js: setup's steps that check before they act on
 * this machine and this repo: the plugin, the gh login, the tower pointer,
 * and the repo the command stands in.
 * Usage: const { installPlugin, pluginInstalled, checkGh, towerPointer, repoState, offerRepo } = require('./install');
 */

const { nodeRead, nodeRun } = require('./kit');
const { spawnSync, onPath } = require('../lib/run');
const { spin } = require('../lib/spin');
const { askYes } = require('../lib/flows');
const {
  ok, skip, info, warn,
} = require('../lib/voice');
const { nativePath } = require('../lib/platform');
const { isCloud } = require('../lib/cloud');
const { chomp } = require('../../hooks/mods/text.js');

/** A program's run with its output sent away, answering whether it ended 0. */
const quietly = (kit, cmd, args) => spawnSync(cmd, args, { stdio: ['inherit', 'ignore', 'ignore'], env: kit.env, windowsHide: true }).status === 0;

/** A program's stdout, or null when it did not end 0; its stderr sent away. */
const readOut = (kit, cmd, args) => {
  const res = spawnSync(cmd, args, {
    stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8', env: kit.env, windowsHide: true,
  });
  return res.status === 0 ? res.stdout : null;
};

/**
 * Whether `claude plugin list --json` names the kit's plugin, under the wait
 * line setup and doctor share. A `claude` that fails reads as not installed.
 * @param {object} kit
 * @returns {boolean}
 */
const pluginInstalled = (kit) => {
  const list = spin('reading the installed plugins', () => readOut(kit, 'claude', ['plugin', 'list', '--json']), { line: false });
  return list !== null && list.includes(`"${kit.PLUGIN_ID}"`);
};

/**
 * The plugin, on a machine that may not have Claude Code at all: detection
 * first, so an installed marketplace is never added again; a missing `claude`
 * is a named skip, never a failure.
 * @param {object} kit
 * @returns {number} 0
 */
const installPlugin = (kit) => {
  if (onPath('claude', { env: kit.env }) === null) {
    skip('plugin: the claude CLI is not on this machine; skipping the plugin install');
    return 0;
  }
  if (pluginInstalled(kit)) {
    skip(`plugin: ${kit.PLUGIN_ID} is installed`);
    return 0;
  }
  if (!spin('adding the marketplace', () => quietly(kit, 'claude', ['plugin', 'marketplace', 'add', kit.root]), { line: false })) {
    warn(`plugin: \`claude plugin marketplace add ${nativePath(kit.root)}\` did not finish; run it by hand`);
    return 0;
  }
  if (!spin(`installing ${kit.PLUGIN_ID}`, () => quietly(kit, 'claude', ['plugin', 'install', kit.PLUGIN_ID]), { line: false })) {
    warn(`plugin: \`claude plugin install ${kit.PLUGIN_ID}\` did not finish; run it by hand`);
    return 0;
  }
  ok(`plugin: installed ${kit.PLUGIN_ID} from ${nativePath(kit.root)}; it loads in a new session`);
  return 0;
};

/**
 * gh, how the standard reaches its issues: reported, never fixed, since `gh
 * auth login` is a browser flow and a human's to run. A cloud session's proxy
 * answers REST alone, signed as the account.
 * @param {object} kit
 * @returns {number} 1 on a warning, which doctor counts
 */
const checkGh = (kit) => {
  if (onPath('gh', { env: kit.env }) === null) {
    warn('gh: not installed; the label heals and the board need it (https://cli.github.com)');
    return 1;
  }
  const signedIn = isCloud(kit.env)
    ? Boolean(chomp(spin('checking the gh login', () => readOut(kit, 'gh', ['api', 'user', '-q', '.login']), { line: false })))
    : spin('checking the gh login', () => quietly(kit, 'gh', ['auth', 'status']), { line: false });
  if (signedIn) {
    skip('gh: installed and authenticated');
    return 0;
  }
  warn('gh: installed but not authenticated; run `gh auth login`');
  return 1;
};

/**
 * Where the tower is: it is started, never installed. It reads no context, so
 * it takes none; a caller's `kit` is passed over.
 * @returns {number} 0
 */
const towerPointer = () => {
  info('tower: mission control is `workkit tower`; the API on 8693 and the dashboard on 4300 together, replacing any previous instance');
  return 0;
};

/**
 * The opt-in state of the repo the command stands in, as the heal reads it:
 * its last line; `nogit` when the heal does not answer.
 * @param {object} kit
 * @returns {string} enabled, disabled, declined, undecided, home, unreadable or nogit
 */
const repoState = (kit) => {
  const res = nodeRead(kit, kit.files.standards, ['--state', process.cwd()]);
  if (res.code !== 0) return 'nogit';
  const lines = res.stdout.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length === 0 ? '' : lines[lines.length - 1];
};

/**
 * The repo the command stands in: undecided is the one state with anything
 * to ask, asked only where someone can answer.
 * @param {object} kit
 * @returns {Promise<number>} 0, or the heal's own code when a yes's enable fails
 */
const offerRepo = async (kit) => {
  const here = nativePath(process.cwd());
  const state = repoState(kit);
  if (state === 'enabled') skip(`repo: ${here} is in the workflow`);
  else if (state === 'disabled') skip(`repo: ${here} has a committed no; leaving it alone`);
  else if (state === 'nogit') skip(`repo: ${here} is not a git repo; nothing to enable`);
  else if (state !== 'declined' && state !== 'undecided') skip(`repo: ${here} reports state '${state}'; nothing to do`);
  else if (!kit.interactive) info(`repo: ${here} is not in the workflow; \`workkit enable\` joins it`);
  else if (await askYes(`Add ${here} to the issue workflow?`, 'n')) return nodeRun(kit, kit.files.standards, ['--enable', process.cwd()]);
  else skip('repo: left as it is; `workkit enable` joins it later');
  return 0;
};

module.exports = {
  installPlugin, pluginInstalled, checkGh, towerPointer, repoState, offerRepo,
};
