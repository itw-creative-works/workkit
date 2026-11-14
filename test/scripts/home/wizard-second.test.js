// Tests for workflow/home.sh: the setup wizard on a second machine (a clone
// another machine seeded, its install, the catch-up before the runner refresh).
// The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { cleanup, git, mkRemote, mkWorld, setup, mkKitCopy } = require('./helpers');

describe('workflow/home: the wizard, a second machine', () => {
  test('a clone another machine already seeded is left exactly as it is', () => {
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    // The clone's line endings are the machine git's business (Windows checks
    // out CRLF), and this case is about whose file is here, not how it ends.
    expect(fs.readFileSync(path.join(world.tower, 'README.md'), 'utf8').replace(/\r\n/g, '\n'), 'the other machine’s project is the one here').toBe('# from elsewhere\n');
    expect(!fs.existsSync(path.join(world.tower, 'targets')), 'and nothing was seeded over it').toBeTruthy();
    expect(/already in/.test(out), `it says so, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a second machine installs the dependencies the project arrived without', () => {
    // The project travels in the repo; node_modules does not. Without the
    // install on this path a second machine can never build or publish.
    const world = mkWorld({ login: 'owner', repoExists: true });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root, {
      seed: { 'package.json': '{ "name": "tower" }\n', 'README.md': '# from elsewhere\n' },
    });
    const { code, out } = setup(world);
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(/installing the tower project's dependencies/.test(out), `it says what it is doing, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(path.join(world.tower, 'node_modules', '.bin', 'omega')), 'and the build tooling is there afterwards').toBeTruthy();

    // Idempotent: an installed tree is a skip, not a second install.
    const again = setup(world);
    expect(/already installed/.test(again.out), `a second run costs nothing, got: ${again.out}`).toBeTruthy();
    expect(world.npmCalls().filter((c) => /install/.test(c)).length, 'and npm ran exactly once').toBe(1);
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

  test('a second machine behind origin catches up before the runner refresh, so its push lands', () => {
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
    expect(code, `exit 0: ${out}`).toBe(0);
    expect(!/could not push/.test(out), `the refresh pushes without a warning, got: ${out}`).toBeTruthy();
    git(world.tower, 'fetch', '-q');
    expect(git(world.tower, 'rev-list', '--count', 'origin/main..main').stdout.trim(), 'and the clone ends ahead of nothing').toBe('0');
    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    expect(fs.readFileSync(path.join(check, 'brief', 'jobs', 'morning.sh'), 'utf8'), 'the refreshed runner reached origin').toBe('# a newer runner\n');
    expect(fs.readFileSync(path.join(check, 'README.md'), 'utf8').replace(/\r\n/g, '\n'), 'on top of what the other machine pushed').toBe('# the tower, from the other machine\n');
    cleanup(world.root);
  });

  test('a second machine that cannot reach origin warns once and leaves the clone alone', () => {
    const world = secondMachine();
    const remote = world.env.WORKKIT_HOME_REMOTE;
    const runner = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    const before = fs.readFileSync(runner, 'utf8');
    fs.renameSync(remote, `${remote}.away`);

    const { code, out } = setup(world);
    expect(code, `setup still finishes: ${out}`).toBe(0);
    const warnings = out.split('\n').filter((l) => /could not catch up with its upstream/.test(l));
    expect(warnings.length, `one catch-up warning, got: ${out}`).toBe(1);
    expect(/^⚠ home: /.test(warnings[0]), `in setup's own voice, got: ${warnings[0]}`).toBeTruthy();
    expect(/was not written to/.test(out), `it says the clone was skipped, got: ${out}`).toBeTruthy();
    const after = fs.readFileSync(runner, 'utf8');
    expect(after !== '# a newer runner\n', 'the newer runner was not written into the clone').toBeTruthy();
    expect(after, 'the runner the clone carried stays as it was').toBe(before);
    expect(!/could not push/.test(out), `and nothing was committed to push, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });
});
