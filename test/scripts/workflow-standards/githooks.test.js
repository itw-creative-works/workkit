// Tests for standards.sh installing the kit's git hooks, `ensure_git_hooks`:
// core.hooksPath set to the engine link's githooks (the kit's own folder where
// the link is missing), a repo's own hooks folder saved to workkit.hooksPath
// for ours to chain to, and `workkit doctor` reporting which.
// The shared prologue is ./helpers.js; doctor's world is ../workkit-cli/helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  group, test, assert, assertEq, summary, selfRun, mkTmp,
} = require('../../lib/harness');
const {
  WORKFLOW_DIR, makeRepo, makeGhStub, runScript, linkedClaudeHome,
} = require('./helpers');
const { gitPath } = require('../../lib/platform');
const { mkWorld, runCli } = require('../workkit-cli/helpers');

const HOOKS = path.join(__dirname, '..', '..', '..', 'workflow', 'githooks');

/** One local git config value of `repo`, or null when unset. */
const configOf = (repo, key) => {
  const res = spawnSync('git', ['config', '--local', '--get', key], { cwd: repo, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
};

const isOurs = (value) => value !== null && fs.existsSync(value) && fs.realpathSync(value) === fs.realpathSync(HOOKS);

// The heal over `repo`, its exit asserted: a heal that cannot install says so in its code.
// `claudeHome` is the machine's ~/.claude, a missing one by default.
const heal = (repo, claudeHome) => {
  const stub = makeGhStub();
  const res = runScript(repo, { pathPrefix: stub.binDir, claudeHome });
  assert(res.code === 0, `the heal runs clean, got ${res.code}: ${res.output}`);
  return res.output;
};

// The kit's own hooks folder, and the engine link's spelling of it, in git's spelling.
const KIT_HOOKS = gitPath(fs.realpathSync(HOOKS));
const viaLink = ({ link }) => gitPath(path.join(link, 'githooks'));

const cases = async () => {
  group('standards.sh: the git hooks');

  await test('a repo with no core.hooksPath on a machine with no engine link gets the kit\'s own folder, and nothing saved', () => {
    const repo = makeRepo();
    heal(repo);
    assertEq(configOf(repo, 'core.hooksPath'), KIT_HOOKS, 'core.hooksPath is the kit\'s workflow/githooks');
    assertEq(configOf(repo, 'workkit.hooksPath'), null, 'there was no folder of its own to save');
  });

  await test('with ~/.claude/workkit linked at the kit, the heal names the link\'s githooks, so a plugin update keeps it', () => {
    const home = linkedClaudeHome();
    const repo = makeRepo();
    const said = heal(repo, home.claude);
    assertEq(configOf(repo, 'core.hooksPath'), viaLink(home), 'core.hooksPath is the engine link\'s spelling');
    assert(said.includes(`git hooks: set core.hooksPath → ${viaLink(home)}`), `the line names the link's path, got: ${said}`);
  });

  await test('a repo on the kit\'s real folder is repointed to the link\'s spelling with nothing saved; a second run changes nothing', () => {
    const home = linkedClaudeHome();
    const repo = makeRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', KIT_HOOKS], { cwd: repo });
    const first = heal(repo, home.claude);
    assertEq(configOf(repo, 'core.hooksPath'), viaLink(home), 'repointed to the engine link\'s spelling');
    assertEq(configOf(repo, 'workkit.hooksPath'), null, 'the same kit under another spelling is never saved as the repo\'s own');
    assert(first.includes(`git hooks: repointed core.hooksPath → ${viaLink(home)}`), `the line's verb is repointed, got: ${first}`);
    const second = heal(repo, home.claude);
    assert(second.includes(`git hooks: installed (${viaLink(home)})`), `the second run reads installed, got: ${second}`);
    assertEq(configOf(repo, 'core.hooksPath'), viaLink(home), 'the second run leaves the path as the first left it');
    assertEq(configOf(repo, 'workkit.hooksPath'), null, 'and still saves nothing');
  });

  await test('a repo on .husky/_ keeps it in workkit.hooksPath and gets ours; a second run changes nothing', () => {
    const repo = makeRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: repo });
    heal(repo);
    assertEq(configOf(repo, 'workkit.hooksPath'), '.husky/_', 'the repo\'s own folder is saved for ours to chain to');
    assert(isOurs(configOf(repo, 'core.hooksPath')), `core.hooksPath is the kit's githooks, got: ${configOf(repo, 'core.hooksPath')}`);
    const first = [configOf(repo, 'core.hooksPath'), configOf(repo, 'workkit.hooksPath')];
    heal(repo);
    assertEq([configOf(repo, 'core.hooksPath'), configOf(repo, 'workkit.hooksPath')].join(' | '), first.join(' | '),
      'the second run leaves both keys as the first left them, ours never saved over theirs');
  });

  await test('a core.hooksPath naming a kit folder that no longer exists is repointed to ours, nothing saved', () => {
    const gone = gitPath(path.join(mkTmp('wf-std-'), 'gone-kit', 'workflow', 'githooks'));
    const unlinked = gitPath(path.join(mkTmp('wf-std-'), '.claude', 'workkit', 'githooks'));
    for (const [what, value] of [['a removed kit folder', gone], ['the link spelling with no link', unlinked]]) {
      const repo = makeRepo();
      spawnSync('git', ['config', '--local', 'core.hooksPath', value], { cwd: repo });
      const said = heal(repo);
      assertEq(configOf(repo, 'core.hooksPath'), KIT_HOOKS, `${what}: core.hooksPath is ours`);
      assertEq(configOf(repo, 'workkit.hooksPath'), null, `${what}: a kit's folder is never saved as the repo's own`);
      assert(said.includes(`git hooks: repointed core.hooksPath → ${KIT_HOOKS}`), `${what}: the line's verb is repointed, got: ${said}`);
    }
  });

  group('workkit doctor: the git hooks');

  await test('doctor names the installed hooks in a healed repo and warns in one never healed', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const healed = makeRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: healed });
    heal(healed);
    const installed = runCli(world, ['doctor'], { cwd: healed }).said;
    const shown = /git hooks: installed \(([^)\n]+)\)/.exec(installed);
    assert(shown !== null, `the installed line, got: ${installed}`);
    assert(isOurs(shown[1]), `naming the kit's githooks folder, got: ${shown[1]}`);

    const bare = makeRepo();
    const missing = runCli(world, ['doctor'], { cwd: bare }).said;
    assert(/git hooks: not installed; run `?workkit setup`?/.test(missing), `the warning, got: ${missing}`);
  });

  await test('doctor reads the engine link\'s spelling as installed, and a husky folder holding both hooks as not', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const home = linkedClaudeHome();
    const linked = makeRepo();
    heal(linked, home.claude);
    const installed = runCli(world, ['doctor'], { cwd: linked }).said;
    assert(installed.includes(`git hooks: installed (${viaLink(home)})`), `the installed line names the link's path, got: ${installed}`);

    const husky = makeRepo();
    for (const hook of ['pre-commit', 'commit-msg']) {
      fs.mkdirSync(path.join(husky, '.husky', '_'), { recursive: true });
      fs.writeFileSync(path.join(husky, '.husky', '_', hook), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: husky });
    const theirs = runCli(world, ['doctor'], { cwd: husky }).said;
    assert(/git hooks: not installed; run `?workkit setup`?/.test(theirs), `the repo's own folder is not ours, got: ${theirs}`);
  });

  await test('a core.hooksPath written ~/.claude/workkit/githooks is read expanded: the heal finds it installed and leaves it, doctor agrees', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const claude = path.join(world.home, '.claude');
    fs.mkdirSync(claude, { recursive: true });
    fs.symlinkSync(path.resolve(WORKFLOW_DIR), path.join(claude, 'workkit'), 'junction');
    const repo = makeRepo();
    const tilde = '~/.claude/workkit/githooks';
    spawnSync('git', ['config', '--local', 'core.hooksPath', tilde], { cwd: repo });
    const res = runScript(repo, { pathPrefix: makeGhStub().binDir, claudeHome: claude, env: { HOME: world.env.HOME } });
    assert(res.code === 0, `the heal runs clean, got ${res.code}: ${res.output}`);
    assert(res.output.includes('git hooks: installed ('), `the heal reads the tilde spelling as installed, got: ${res.output}`);
    assertEq(configOf(repo, 'core.hooksPath'), tilde, 'the heal leaves the tilde spelling as it was');
    assertEq(configOf(repo, 'workkit.hooksPath'), null, 'and saves nothing');
    const said = runCli(world, ['doctor'], { cwd: repo }).said;
    assert(said.includes('git hooks: installed ('), `doctor reads the tilde spelling as installed, got: ${said}`);
  });

  await test('doctor run from a subfolder of a healed repo names the installed hooks', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const repo = makeRepo();
    heal(repo);
    const sub = path.join(repo, 'lib', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const said = runCli(world, ['doctor'], { cwd: sub }).said;
    assert(said.includes(`git hooks: installed (${KIT_HOOKS})`), `the installed line from the subfolder, got: ${said}`);

    // git reads a relative core.hooksPath from the repo's root, so doctor must too.
    const relative = path.relative(fs.realpathSync(repo), fs.realpathSync(HOOKS)).split(path.sep).join('/');
    spawnSync('git', ['config', '--local', 'core.hooksPath', relative], { cwd: repo });
    const fromSub = runCli(world, ['doctor'], { cwd: sub }).said;
    assert(/git hooks: installed \(/.test(fromSub), `a root-relative spelling of the kit's folder reads installed from the subfolder, got: ${fromSub}`);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
