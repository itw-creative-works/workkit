// Tests for standards.sh installing the kit's git hooks, in the heal and alone
// (`--git-hooks`): core.hooksPath set to the engine link's githooks (the kit's
// own folder where the link is missing), a repo's own hooks folder saved to
// workkit.hooksPath for ours to chain to, and `workkit doctor` reporting which.
// The shared prologue is ./helpers.js; doctor's world is ../workkit-cli/helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  describe, test, expect, mkTmp,
} = require('../../lib/harness');
const {
  WORKFLOW_DIR, makeRepo, makeGhStub, ghCalls, runScript, linkedClaudeHome,
} = require('./helpers');
const { gitPath, joinPath, NODE_DIR } = require('../../lib/platform');
const { mkWorld, runCli, withNpm } = require('../workkit-cli/helpers');

const HOOKS = path.join(__dirname, '..', '..', '..', 'workflow', 'githooks');

// `workkit doctor` from `cwd` in `world`, this suite's node on its PATH after the
// world's stubs, so a global gh or claude beside it never answers: what it said.
const doctor = (world, cwd) => runCli(world, ['doctor'], {
  cwd, env: { ...withNpm(world).env, PATH: joinPath(world.env.PATH, NODE_DIR) },
}).said;

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
  expect(res.code === 0, `the heal runs clean, got ${res.code}: ${res.output}`).toBeTruthy();
  return res.output;
};

// The kit's own hooks folder, and the engine link's spelling of it, in git's spelling.
const KIT_HOOKS = gitPath(fs.realpathSync(HOOKS));
const viaLink = ({ link }) => gitPath(path.join(link, 'githooks'));

describe('standards.sh: the git hooks', () => {
  test('a repo with no core.hooksPath on a machine with no engine link gets the kit\'s own folder, and nothing saved', () => {
    const repo = makeRepo();
    heal(repo);
    expect(configOf(repo, 'core.hooksPath'), 'core.hooksPath is the kit\'s workflow/githooks').toBe(KIT_HOOKS);
    expect(configOf(repo, 'workkit.hooksPath'), 'there was no folder of its own to save').toBe(null);
  });

  test('with ~/.claude/workkit linked at the kit, the heal names the link\'s githooks, so a plugin update keeps it', () => {
    const home = linkedClaudeHome();
    const repo = makeRepo();
    const said = heal(repo, home.claude);
    expect(configOf(repo, 'core.hooksPath'), 'core.hooksPath is the engine link\'s spelling').toBe(viaLink(home));
    expect(said.includes(`git hooks: set core.hooksPath → ${viaLink(home)}`), `the line names the link's path, got: ${said}`).toBeTruthy();
  });

  test('a repo on the kit\'s real folder is repointed to the link\'s spelling with nothing saved; a second run changes nothing', () => {
    const home = linkedClaudeHome();
    const repo = makeRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', KIT_HOOKS], { cwd: repo });
    const first = heal(repo, home.claude);
    expect(configOf(repo, 'core.hooksPath'), 'repointed to the engine link\'s spelling').toBe(viaLink(home));
    expect(configOf(repo, 'workkit.hooksPath'), 'the same kit under another spelling is never saved as the repo\'s own').toBe(null);
    expect(first.includes(`git hooks: repointed core.hooksPath → ${viaLink(home)}`), `the line's verb is repointed, got: ${first}`).toBeTruthy();
    const second = heal(repo, home.claude);
    expect(second.includes(`git hooks: installed (${viaLink(home)})`), `the second run reads installed, got: ${second}`).toBeTruthy();
    expect(configOf(repo, 'core.hooksPath'), 'the second run leaves the path as the first left it').toBe(viaLink(home));
    expect(configOf(repo, 'workkit.hooksPath'), 'and still saves nothing').toBe(null);
  });

  test('a repo on .husky/_ keeps it in workkit.hooksPath and gets ours; a second run changes nothing', () => {
    const repo = makeRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: repo });
    heal(repo);
    expect(configOf(repo, 'workkit.hooksPath'), 'the repo\'s own folder is saved for ours to chain to').toBe('.husky/_');
    expect(isOurs(configOf(repo, 'core.hooksPath')), `core.hooksPath is the kit's githooks, got: ${configOf(repo, 'core.hooksPath')}`).toBeTruthy();
    const first = [configOf(repo, 'core.hooksPath'), configOf(repo, 'workkit.hooksPath')];
    heal(repo);
    expect([configOf(repo, 'core.hooksPath'), configOf(repo, 'workkit.hooksPath')].join(' | '), 'the second run leaves both keys as the first left them, ours never saved over theirs').toBe(first.join(' | '));
  });

  test('a core.hooksPath naming a kit folder that no longer exists is repointed to ours, nothing saved', () => {
    const gone = gitPath(path.join(mkTmp('wf-std-'), 'gone-kit', 'workflow', 'githooks'));
    const unlinked = gitPath(path.join(mkTmp('wf-std-'), '.claude', 'workkit', 'githooks'));
    for (const [what, value] of [['a removed kit folder', gone], ['the link spelling with no link', unlinked]]) {
      const repo = makeRepo();
      spawnSync('git', ['config', '--local', 'core.hooksPath', value], { cwd: repo });
      const said = heal(repo);
      expect(configOf(repo, 'core.hooksPath'), `${what}: core.hooksPath is ours`).toBe(KIT_HOOKS);
      expect(configOf(repo, 'workkit.hooksPath'), `${what}: a kit's folder is never saved as the repo's own`).toBe(null);
      expect(said.includes(`git hooks: repointed core.hooksPath → ${KIT_HOOKS}`), `${what}: the line's verb is repointed, got: ${said}`).toBeTruthy();
    }
  });
});

describe('standards.sh --git-hooks <repo>: the git hooks step alone', () => {
  // The mode over `repo` in a caller's voice (no WK_LOG_STDERR) with a recording gh
  // on PATH: its code, its streams, and what gh was asked.
  const gitHooks = (repo) => {
    const stub = makeGhStub();
    const res = runScript(repo, { args: ['--git-hooks'], pathPrefix: stub.binDir, env: { WK_LOG_STDERR: '' } });
    return { ...res, calls: ghCalls(stub) };
  };

  test('hooks not set: exit 0, ours set, the one set line on stdout with no indent, and no other step ran', () => {
    const repo = makeRepo();
    const res = gitHooks(repo);
    expect(res.code, `exit 0, got: ${res.output}`).toBe(0);
    expect(configOf(repo, 'core.hooksPath'), 'core.hooksPath is the kit\'s workflow/githooks').toBe(KIT_HOOKS);
    expect(res.stdout, `the set line alone, on stdout, got: ${res.output}`).toBe(`✓ git hooks: set core.hooksPath → ${KIT_HOOKS}\n`);
    expect(res.stderr, 'nothing on stderr').toBe('');
    expect(res.calls.length, `the labels and claims steps never ran, gh calls: ${JSON.stringify(res.calls)}`).toBe(0);
    expect(fs.existsSync(path.join(repo, '.gitignore')), 'the ignore lines step never ran').toBe(false);
  });

  test('a repo on .husky/_: its folder saved to workkit.hooksPath and named on the line, ours set', () => {
    const repo = makeRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: repo });
    const res = gitHooks(repo);
    expect(res.code, `exit 0, got: ${res.output}`).toBe(0);
    expect(configOf(repo, 'workkit.hooksPath'), 'the repo\'s own folder is saved for ours to chain to').toBe('.husky/_');
    expect(configOf(repo, 'core.hooksPath'), 'core.hooksPath is ours').toBe(KIT_HOOKS);
    expect(res.stdout, `the line names the saved folder, got: ${res.output}`)
      .toBe(`✓ git hooks: set core.hooksPath → ${KIT_HOOKS}; the repo's own hooks in .husky/_ run after ours\n`);
    expect(res.stderr, 'nothing on stderr').toBe('');
  });

  test('a kit-like folder (a removed kit\'s githooks) is repointed to ours, nothing saved', () => {
    const repo = makeRepo();
    const gone = gitPath(path.join(mkTmp('wf-std-'), 'gone-kit', 'workflow', 'githooks'));
    spawnSync('git', ['config', '--local', 'core.hooksPath', gone], { cwd: repo });
    const res = gitHooks(repo);
    expect(res.code, `exit 0, got: ${res.output}`).toBe(0);
    expect(configOf(repo, 'core.hooksPath'), 'core.hooksPath is ours').toBe(KIT_HOOKS);
    expect(configOf(repo, 'workkit.hooksPath'), 'a kit\'s folder is never saved as the repo\'s own').toBe(null);
    expect(res.stdout, `the line's verb is repointed, got: ${res.output}`).toBe(`✓ git hooks: repointed core.hooksPath → ${KIT_HOOKS}\n`);
    expect(res.stderr, 'nothing on stderr').toBe('');
  });

  test('a git config that cannot be written: the warning naming the fix, exit 1, nothing set', () => {
    const repo = makeRepo();
    // git refuses every config write while another writer's lock file stands.
    fs.writeFileSync(path.join(repo, '.git', 'config.lock'), '');
    const res = gitHooks(repo);
    const root = gitPath(fs.realpathSync(repo));
    expect(res.code, `the flagged step exits 1, got: ${res.output}`).toBe(1);
    expect(configOf(repo, 'core.hooksPath'), 'nothing was set').toBe(null);
    // git's own refusal line rides along on stderr above the step's.
    expect(res.stderr.split('\n').includes(`⚠ git hooks: could not set core.hooksPath in ${root}; run \`git -C ${root} config core.hooksPath ${KIT_HOOKS}\``),
      `the warning on stderr, flush left, naming the command that sets them, got: ${res.output}`).toBe(true);
    expect(res.stdout, 'nothing on stdout').toBe('');
  });
});

describe('workkit doctor: the git hooks', () => {
  test('doctor names the installed hooks in a healed repo and warns in one never healed', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const healed = makeRepo();
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: healed });
    heal(healed);
    const installed = doctor(world, healed);
    const shown = /git hooks: installed \(([^)\n]+)\)/.exec(installed);
    expect(shown !== null, `the installed line, got: ${installed}`).toBeTruthy();
    expect(isOurs(shown[1]), `naming the kit's githooks folder, got: ${shown[1]}`).toBeTruthy();

    const bare = makeRepo();
    const missing = doctor(world, bare);
    expect(/git hooks: not installed; run `?workkit setup`?/.test(missing), `the warning, got: ${missing}`).toBeTruthy();
  });

  test('doctor reads the engine link\'s spelling as installed, and a husky folder holding both hooks as not', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const home = linkedClaudeHome();
    const linked = makeRepo();
    heal(linked, home.claude);
    const installed = doctor(world, linked);
    expect(installed.includes(`git hooks: installed (${viaLink(home)})`), `the installed line names the link's path, got: ${installed}`).toBeTruthy();

    const husky = makeRepo();
    for (const hook of ['pre-commit', 'commit-msg']) {
      fs.mkdirSync(path.join(husky, '.husky', '_'), { recursive: true });
      fs.writeFileSync(path.join(husky, '.husky', '_', hook), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    spawnSync('git', ['config', '--local', 'core.hooksPath', '.husky/_'], { cwd: husky });
    const theirs = doctor(world, husky);
    expect(/git hooks: not installed; run `?workkit setup`?/.test(theirs), `the repo's own folder is not ours, got: ${theirs}`).toBeTruthy();
  });

  test('a core.hooksPath written ~/.claude/workkit/githooks is read expanded: the heal finds it installed and leaves it, doctor agrees', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const claude = path.join(world.home, '.claude');
    fs.mkdirSync(claude, { recursive: true });
    fs.symlinkSync(path.resolve(WORKFLOW_DIR), path.join(claude, 'workkit'), 'junction');
    const repo = makeRepo();
    const tilde = '~/.claude/workkit/githooks';
    spawnSync('git', ['config', '--local', 'core.hooksPath', tilde], { cwd: repo });
    const res = runScript(repo, { pathPrefix: makeGhStub().binDir, claudeHome: claude, env: { HOME: world.env.HOME } });
    expect(res.code === 0, `the heal runs clean, got ${res.code}: ${res.output}`).toBeTruthy();
    expect(res.output.includes('git hooks: installed ('), `the heal reads the tilde spelling as installed, got: ${res.output}`).toBeTruthy();
    expect(configOf(repo, 'core.hooksPath'), 'the heal leaves the tilde spelling as it was').toBe(tilde);
    expect(configOf(repo, 'workkit.hooksPath'), 'and saves nothing').toBe(null);
    const said = doctor(world, repo);
    expect(said.includes('git hooks: installed ('), `doctor reads the tilde spelling as installed, got: ${said}`).toBeTruthy();
  });

  test('doctor run from a subfolder of a healed repo names the installed hooks', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const repo = makeRepo();
    heal(repo);
    const sub = path.join(repo, 'lib', 'deep');
    fs.mkdirSync(sub, { recursive: true });
    const said = doctor(world, sub);
    expect(said.includes(`git hooks: installed (${KIT_HOOKS})`), `the installed line from the subfolder, got: ${said}`).toBeTruthy();

    // git reads a relative core.hooksPath from the repo's root, so doctor must too.
    const relative = path.relative(fs.realpathSync(repo), fs.realpathSync(HOOKS)).split(path.sep).join('/');
    spawnSync('git', ['config', '--local', 'core.hooksPath', relative], { cwd: repo });
    const fromSub = doctor(world, sub);
    expect(/git hooks: installed \(/.test(fromSub), `a root-relative spelling of the kit's folder reads installed from the subfolder, got: ${fromSub}`).toBeTruthy();
  });
});
