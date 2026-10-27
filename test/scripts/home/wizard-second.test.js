// Tests for workflow/home.sh: the setup wizard on a second machine (a clone
// another machine seeded, its install, the catch-up before the runner refresh).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, git, mkRemote, mkWorld, setup, mkKitCopy } = require('./helpers');

const cases = async () => {
  group('workflow/home: the wizard, a second machine');

  await test('a clone another machine already seeded is left exactly as it is', () => {
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    // The clone's line endings are the machine git's business (Windows checks
    // out CRLF), and this case is about whose file is here, not how it ends.
    assertEq(fs.readFileSync(path.join(world.tower, 'README.md'), 'utf8').replace(/\r\n/g, '\n'),
      '# from elsewhere\n', 'the other machine’s project is the one here');
    assert(!fs.existsSync(path.join(world.tower, 'targets')), 'and nothing was seeded over it');
    assert(/already in/.test(out), `it says so, got: ${out}`);
    cleanup(world.root);
  });

  await test('a second machine installs the dependencies the project arrived without', () => {
    // The project travels in the repo; node_modules does not. Without the
    // install on this path a second machine can never build or publish.
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(/installing the tower project's dependencies/.test(out), `it says what it is doing, got: ${out}`);
    assert(fs.existsSync(path.join(world.tower, 'node_modules', '.bin', 'omega')), 'and the build tooling is there afterwards');

    // Idempotent: an installed tree is a skip, not a second install.
    const again = setup(world);
    assert(/already installed/.test(again.out), `a second run costs nothing, got: ${again.out}`);
    assertEq(world.npmCalls().filter((c) => /install/.test(c)).length, 1, 'and npm ran exactly once');
    cleanup(world.root);
  });

  // A second machine whose clone already carries the project, its runner
  // seeded from a kit copy the next setup can find moved on.
  const secondMachine = () => {
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    setup(world);
    fs.writeFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh'), '# a newer runner\n');
    return world;
  };

  await test('a second machine behind origin catches up before the runner refresh, so its push lands', () => {
    const world = secondMachine();
    const remote = world.env.WORKKIT_HOME_REMOTE;
    // The other machine published since this one last ran setup.
    const other = path.join(world.root, 'other');
    spawnSync('git', ['clone', '-q', remote, other], { encoding: 'utf8' });
    fs.writeFileSync(path.join(other, 'README.md'), '# the tower, from the other machine\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): elsewhere');
    git(other, 'push', '-q');

    const { code, out } = setup(world);
    assertEq(code, 0, `exit 0: ${out}`);
    assert(!/could not push/.test(out), `the refresh pushes without a warning, got: ${out}`);
    git(world.tower, 'fetch', '-q');
    assertEq(git(world.tower, 'rev-list', '--count', 'origin/main..main').stdout.trim(), '0',
      'and the clone ends ahead of nothing');
    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assertEq(fs.readFileSync(path.join(check, 'brief', 'jobs', 'morning.sh'), 'utf8'), '# a newer runner\n',
      'the refreshed runner reached origin');
    assertEq(fs.readFileSync(path.join(check, 'README.md'), 'utf8').replace(/\r\n/g, '\n'),
      '# the tower, from the other machine\n', 'on top of what the other machine pushed');
    cleanup(world.root);
  });

  await test('a second machine that cannot reach origin warns once and leaves the clone alone', () => {
    const world = secondMachine();
    const remote = world.env.WORKKIT_HOME_REMOTE;
    const runner = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    const before = fs.readFileSync(runner, 'utf8');
    fs.renameSync(remote, `${remote}.away`);

    const { code, out } = setup(world);
    assertEq(code, 0, `setup still finishes: ${out}`);
    const warnings = out.split('\n').filter((l) => /could not catch up with its upstream/.test(l));
    assertEq(warnings.length, 1, `one catch-up warning, got: ${out}`);
    assert(/^⚠ home: /.test(warnings[0]), `in setup's own voice, got: ${warnings[0]}`);
    assert(/was not written to/.test(out), `it says the clone was skipped, got: ${out}`);
    const after = fs.readFileSync(runner, 'utf8');
    assert(after !== '# a newer runner\n', 'the newer runner was not written into the clone');
    assertEq(after, before, 'the runner the clone carried stays as it was');
    assert(!/could not push/.test(out), `and nothing was committed to push, got: ${out}`);
    cleanup(world.root);
  });

  return summary();
};

module.exports = cases;

if (require.main === module) selfRun(cases);
