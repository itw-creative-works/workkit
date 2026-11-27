// Tests for workflow/workkit.js run from Claude's plugin cache: `setup` and
// `doctor` from a plugin install, a copy with no git under it.
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { describe, test, expect, SPAWN_DEADLINE } = require('../../lib/harness');
const { gitPath, spawnSync } = require('../../lib/platform');
const {
  cleanup, mkWorld, runCli, mkCacheKit, mkKit, seedSettings,
} = require('./helpers');
const { KIT_DIR, runnerPairs, runHomeSteps } = require('../home/helpers');

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
  // Both nodes are started here, not by Git Bash, so they are handed the native folder.
  const env = { ...world.env, WORKFLOW_HOME: world.workflowHome };
  const cloned = runHomeSteps({ ...world, env }, [['repo', 'clone', ['owner/home']]]);
  expect(cloned.code, `the home is cloned, got: ${cloned.out}`).toBe(0);
  // The cache kit's own home program seeds it, as the engine's seed step starts it.
  const seeded = spawnSync(process.execPath, [path.join(path.dirname(script), 'home.js'), 'seed-runner'], {
    cwd: world.root, env, encoding: 'utf8', timeout: SPAWN_DEADLINE,
  });
  expect(seeded.status, `the clone is seeded, got: ${seeded.stdout}${seeded.stderr}`).toBe(0);
};

describe('workkit from the plugin cache', () => {
  test('setup from the cache links the engine and the command at the cached copy', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const { kit, script } = mkCacheKit(world);
    const { code, said } = runCli(world, ['setup'], { script });
    expect(code, `exit 0, got: ${said}`).toBe(0);
    const engine = fs.lstatSync(world.engineLink, { throwIfNoEntry: false });
    expect(!!engine && engine.isSymbolicLink(), `the engine address is a symlink, got: ${said}`).toBeTruthy();
    expect(fs.realpathSync(world.engineLink), 'and it points at the cached engine').toBe(fs.realpathSync(path.join(kit, 'workflow')));
    const command = fs.lstatSync(world.link, { throwIfNoEntry: false });
    expect(!!command && command.isSymbolicLink(), `the workkit command is a symlink, got: ${said}`).toBeTruthy();
    expect(fs.realpathSync(world.link), 'and it points at the cached entry').toBe(fs.realpathSync(script));
    cleanup(world.root);
  });

  test('doctor from the cache reports both current, and never calls it a checkout', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const { kit, script } = mkCacheKit(world);
    runCli(world, ['setup'], { script });
    const { said } = runCli(world, ['doctor'], { script });
    const lines = said.split('\n');
    const engineDir = gitPath(fs.realpathSync(path.join(kit, 'workflow')));
    const engine = lines.find((l) => l.includes('engine:')) || '';
    expect(engine.includes(`→ ${engineDir}`), `the engine reads as current, got: ${engine}`).toBeTruthy();
    const command = lines.find((l) => l.includes('command:')) || '';
    expect(command.includes(`→ ${engineDir}/workkit.js`), `and the command too, got: ${command}`).toBeTruthy();
    const checkout = lines.filter((l) => /checkout/i.test(l));
    expect(checkout.join('\n'), 'a plugin install is never named a checkout').toBe('');
    cleanup(world.root);
  });

  test('doctor from the cache with a seeded home clone: the home and runner lines never say checkout', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const { kit, script } = mkCacheKit(world);
    withRunnerSources(kit);
    runCli(world, ['setup'], { script });
    seedHomeClone(world, script);
    const { said } = runCli(world, ['doctor'], { script });
    const lines = said.split('\n');
    const runner = lines.find((l) => l.includes('runner:')) || '';
    expect(/is current/.test(runner), `the runner was compared, and is current, got: ${runner}`).toBeTruthy();
    expect(lines.some((l) => /home: owner\/home/.test(l)), `the home clone is read, got: ${said}`).toBeTruthy();
    const checkout = lines.filter((l) => /checkout/i.test(l));
    expect(checkout.join('\n'), 'a plugin install is never named a checkout').toBe('');
    cleanup(world.root);
  });

  // A machine whose owner set up from a clone keeps it: a plugin install run
  // beside it takes neither link, and reads the clone's as current.
  test('update from the cache leaves a clone\'s command alone, and doctor reads both as current', () => {
    const world = mkWorld({ pluginInstalled: true, binOnPath: true });
    const clone = mkKit('owner/workkit');
    fs.mkdirSync(world.claudeHome, { recursive: true });
    runCli(world, ['setup'], { script: clone.script });
    expect(fs.readlinkSync(world.link), 'the clone owns the command to begin with').toBe(clone.script);
    expect(fs.realpathSync(world.engineLink), 'and the engine address').toBe(fs.realpathSync(path.join(clone.kit, 'workflow')));
    const { script } = mkCacheKit(world);
    const update = runCli(world, ['update'], { script });
    expect(update.code, `exit 0, got: ${update.said}`).toBe(0);
    expect(fs.readlinkSync(world.link), `the command still names the clone, got: ${update.said}`).toBe(clone.script);
    expect(fs.realpathSync(world.engineLink), 'and so does the engine address').toBe(fs.realpathSync(path.join(clone.kit, 'workflow')));
    const { said } = runCli(world, ['doctor'], { script });
    const lines = said.split('\n');
    for (const name of ['engine:', 'command:']) {
      const line = lines.find((l) => l.includes(name)) || '';
      expect(line.includes('✓') && !/does not point|points elsewhere/.test(line), `${name} reads as current, got: ${line}`).toBeTruthy();
    }
    cleanup(world.root); cleanup(clone.kit);
  });
});
