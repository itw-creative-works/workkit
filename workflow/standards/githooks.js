/**
 * workflow/standards/githooks.js: git's client-side hooks for a repo, the kit's
 * githooks folder set as its core.hooksPath (workflow/README.md, the githooks/
 * row). A step of the heal, the heal's `--git-hooks` mode alone, and the
 * script shell's re-point after an install-time script (`script-shell.js`).
 * Usage: const { ensureGitHooks } = require('./githooks');
 */

const { gitIn, localConfig } = require('../lib/git');
const { isLink, physical } = require('../lib/link');
const { nativePath, cloneOutranks } = require('../lib/platform');
const { githooksKit, githooksKitlike } = require('../lib/participation');
const { ok, skip } = require('../lib/voice');
const { flag } = require('./flag');

/**
 * Sets a local git config key in `root`, git's own error left on stderr.
 * @returns {boolean} whether git set it
 */
const setLocal = (root, key, value) => gitIn(root, ['config', '--local', key, value], {
  stdio: ['ignore', 'inherit', 'inherit'],
}).status === 0;

/**
 * The folder core.hooksPath should name: through the engine link when it
 * points at this engine, so a plugin update that moves the kit leaves the path
 * good; the kit's own folder where the link is missing.
 * @param {{kit: string, claudeHome: string}} run
 * @returns {string}
 */
const githooksAddress = (run) => {
  const link = `${run.claudeHome}/workkit`;
  const workflow = `${run.kit}/workflow`;
  const here = physical(workflow);
  if (isLink(link) && here !== null && physical(link) === here) return `${link}/githooks`;
  return `${workflow}/githooks`;
};

/**
 * git runs the kit's commit hooks, in git's spelling of the path. The repo's
 * own folder (husky's) is saved once to workkit.hooksPath for the chain; a
 * kit-like one is repointed, unless that kit is a workkit clone, which
 * outranks the plugin cache. A failed write flags the run.
 * @param {{root: string, kit: string, claudeHome: string, needsAttention: boolean}} run
 */
const ensureGitHooks = (run) => {
  const { root } = run;
  const ours = nativePath(githooksAddress(run));
  const current = localConfig(root, ['--path', 'core.hooksPath']);
  if (current === ours) {
    skip(`git hooks: installed (${ours})`);
    return;
  }
  let verb = 'set';
  let kept = '';
  const kit = githooksKit(root, current);
  if (kit !== null) {
    if (kit !== run.kit && cloneOutranks(run.kit, kit)) {
      skip(`git hooks: installed (${current}), the workkit clone, which outranks the plugin cache`);
      return;
    }
    verb = 'repointed';
  } else if (githooksKitlike(root, current)) {
    verb = 'repointed';
  } else if (current !== '') {
    const saved = localConfig(root, ['workkit.hooksPath']);
    if (saved === '' && !setLocal(root, 'workkit.hooksPath', current)) {
      flag(run, `git hooks: could not save core.hooksPath (${current}) to workkit.hooksPath in ${nativePath(root)}, so ours were not set; run \`workkit heal\` again`);
      return;
    }
    kept = `; the repo's own hooks in ${saved || current} run after ours`;
  }
  if (!setLocal(root, 'core.hooksPath', ours)) {
    flag(run, `git hooks: could not set core.hooksPath in ${nativePath(root)}; run \`git -C ${nativePath(root)} config core.hooksPath ${ours}\``);
    return;
  }
  ok(`git hooks: ${verb} core.hooksPath → ${ours}${kept}`);
};

module.exports = { ensureGitHooks };
