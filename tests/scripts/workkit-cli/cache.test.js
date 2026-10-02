// Tests for workflow/workkit.sh run from Claude's plugin cache: `setup` and
// `doctor` from a plugin install, a copy with no git under it.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { spawnSync } = require('child_process');
const {
  cleanup, mkWorld, runCli, mkCacheKit, mkKit, seedSettings, inCli,
} = require('./helpers');
const { KIT_DIR, runnerPairs } = require('../home/helpers');

// The cloud brief's runner sources, copied into a cache-shaped kit so the
// runner doctor has something of its own to compare a seeded clone against.
const withRunnerSources = (kit) => {
  for (const { src } of runnerPairs()) {
    const dest = path.join(kit, src);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(KIT_DIR, src), dest);
  }
};

// The home repo, cloned and seeded with the runner from the cache kit: the
// state a finished setup leaves, with a bare repo standing in for GitHub.
const seedHomeClone = (world, script) => {
  seedSettings(world, { repo: 'owner/home', publish: false, url: null });
  const remote = path.join(world.root, 'home-remote.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { encoding: 'utf8' });
  world.env.WORKKIT_HOME_REMOTE = remote;
  const res = inCli(world, 'wk_home_clone owner/home\nwk_home_seed_runner', { entry: script });
  assertEq(res.code, 0, `the clone is seeded, got: ${res.said}`);
};

const run = async () => {
  group('workkit from the plugin cache');

  await test('setup from the cache links the engine and the command at the cached copy', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const { kit, script } = mkCacheKit(world);
    const { code, said } = runCli(world, ['setup'], { script });
    assertEq(code, 0, `exit 0, got: ${said}`);
    const engine = fs.lstatSync(world.engineLink, { throwIfNoEntry: false });
    assert(!!engine && engine.isSymbolicLink(), `the engine address is a symlink, got: ${said}`);
    assertEq(fs.realpathSync(world.engineLink), fs.realpathSync(path.join(kit, 'workflow')), 'and it points at the cached engine');
    const command = fs.lstatSync(world.link, { throwIfNoEntry: false });
    assert(!!command && command.isSymbolicLink(), `the workkit command is a symlink, got: ${said}`);
    assertEq(fs.realpathSync(world.link), fs.realpathSync(script), 'and it points at the cached entry');
    cleanup(world.root);
  });

  await test('doctor from the cache reports both current, and never calls it a checkout', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const { kit, script } = mkCacheKit(world);
    runCli(world, ['setup'], { script });
    const { said } = runCli(world, ['doctor'], { script });
    const lines = said.split('\n');
    const engineDir = fs.realpathSync(path.join(kit, 'workflow'));
    const engine = lines.find((l) => l.includes('engine:')) || '';
    assert(engine.includes(`→ ${engineDir}`), `the engine reads as current, got: ${engine}`);
    const command = lines.find((l) => l.includes('command:')) || '';
    assert(command.includes(`→ ${engineDir}/workkit.sh`), `and the command too, got: ${command}`);
    const checkout = lines.filter((l) => /checkout/i.test(l));
    assertEq(checkout.join('\n'), '', 'a plugin install is never named a checkout');
    cleanup(world.root);
  });

  await test('doctor from the cache with a seeded home clone: the home and runner lines never say checkout', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const { kit, script } = mkCacheKit(world);
    withRunnerSources(kit);
    runCli(world, ['setup'], { script });
    seedHomeClone(world, script);
    const { said } = runCli(world, ['doctor'], { script });
    const lines = said.split('\n');
    const runner = lines.find((l) => l.includes('runner:')) || '';
    assert(/is current/.test(runner), `the runner was compared, and is current, got: ${runner}`);
    assert(lines.some((l) => /home: owner\/home/.test(l)), `the home clone is read, got: ${said}`);
    const checkout = lines.filter((l) => /checkout/i.test(l));
    assertEq(checkout.join('\n'), '', 'a plugin install is never named a checkout');
    cleanup(world.root);
  });

  // A machine whose owner set up from a clone keeps it: a plugin install run
  // beside it takes neither link, and reads the clone's as current.
  await test('update from the cache leaves a clone\'s command alone, and doctor reads both as current', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const clone = mkKit('owner/workkit');
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['setup'], { script: clone.script });
    assertEq(fs.readlinkSync(world.link), clone.script, 'the clone owns the command to begin with');
    assertEq(fs.realpathSync(world.engineLink), fs.realpathSync(path.join(clone.kit, 'workflow')), 'and the engine address');
    const { script } = mkCacheKit(world);
    const update = runCli(world, ['update'], { script });
    assertEq(update.code, 0, `exit 0, got: ${update.said}`);
    assertEq(fs.readlinkSync(world.link), clone.script, `the command still names the clone, got: ${update.said}`);
    assertEq(fs.realpathSync(world.engineLink), fs.realpathSync(path.join(clone.kit, 'workflow')), 'and so does the engine address');
    const { said } = runCli(world, ['doctor'], { script });
    const lines = said.split('\n');
    for (const name of ['engine:', 'command:']) {
      const line = lines.find((l) => l.includes(name)) || '';
      assert(line.includes('✓') && !/does not point|points elsewhere/.test(line), `${name} reads as current, got: ${line}`);
    }
    cleanup(world.root); cleanup(clone.kit);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
