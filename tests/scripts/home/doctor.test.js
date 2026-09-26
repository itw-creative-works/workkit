//
// Tests for workflow/home.sh: doctor, the home clone's state and the seeded
// runner's drift, read and never written.
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { cleanup, git, mkRemote, mkWorld, inHome, mkKitCopy, STAMP } = require('./helpers');

const run = async () => {
  group('workflow/home: doctor');

  await test('no home configured is a notice naming the command', () => {
    const world = mkWorld();
    const { code, out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assertEq(code, 0, 'exit 0');
    assert(/home: not set/.test(out), `it says so, got: ${out}`);
    assert(/rc=0/.test(out), 'and counts as nothing needing attention');
    cleanup(world.root);
  });

  await test('a home named but nothing cloned needs attention', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/nothing is cloned at/.test(out), `it names the state, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a repo pointing at another remote is reported, never adopted', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    fs.mkdirSync(world.tower, { recursive: true });
    git(world.tower, 'init', '-q', '-b', 'main');
    git(world.tower, 'remote', 'add', 'origin', theirs);
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/pointing at/.test(out) && /move it aside/.test(out), `it says what is in the way, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a plain folder in the way is reported for what it is', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    fs.mkdirSync(world.tower, { recursive: true });
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/exists and is not a clone/.test(out), `it does not call a folder a repo, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a clone in step with its upstream is green', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/is its clone/.test(out), `it reports the clone, got: ${out}`);
    assert(/rc=0/.test(out), 'and nothing needs attention');
    cleanup(world.root);
  });

  await test('a clone with unpushed commits says the daily publish will push them', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the tower, edited\n');
    git(world.tower, 'add', '-A');
    git(world.tower, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): a project edit');

    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/unpushed commits/.test(out), `it says what is waiting, got: ${out}`);
    assert(/rc=0/.test(out), 'which is not a problem to fix');
    cleanup(world.root);
  });

  await test('a clone behind its upstream is told which command catches it up', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');

    // Someone else pushed. This machine only learns it on a fetch.
    const other = path.join(world.root, 'other');
    spawnSync('git', ['clone', '-q', remote, other], { encoding: 'utf8' });
    fs.writeFileSync(path.join(other, 'README.md'), '# the tower, from elsewhere\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): elsewhere');
    git(other, 'push', '-q');
    git(world.tower, 'fetch', '-q');

    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    assert(/is behind/.test(out) && /pull --rebase/.test(out), `it names the fix, got: ${out}`);
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a checkout older than the clone’s stamp is a finding naming the update', () => {
    // The same refusal the seed makes (issue #200), reported by the one command
    // whose job is to say what needs attention.
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');

    const { out, err } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    const said = out + err;
    assert(said.includes('carries workkit 99.0.0'), `it names what the clone carries: ${said}`);
    assert(/workkit update/.test(said), `and the command that fixes it: ${said}`);
    assert(/rc=1/.test(said), `and counts as something needing attention: ${said}`);
    cleanup(world.root);
  });

  // The seeded runner drifts on a `git pull` of the checkout; setup and the
  // morning run write it back (#143), and doctor is the read-only check that
  // reports drift the last morning could not heal.
  const runnerDoctor = (world) => inHome(world, 'rc=0; wk_home_runner_doctor || rc=$?; printf "rc=%s\\n" "$rc"');

  /** A world whose clone carries the runner, seeded from a copy of the checkout. */
  const withRunner = () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed_runner');
    return world;
  };

  await test('a seeded runner in step with the checkout is green', () => {
    const world = withRunner();
    const { out } = runnerDoctor(world);
    assert(/runner: the cloud brief's runner in/.test(out) && /is current/.test(out), `it reports current, got: ${out}`);
    assert(/rc=0/.test(out), 'and nothing needs attention');
    cleanup(world.root);
  });

  await test('a seeded file the checkout has moved past is reported as behind', () => {
    const world = withRunner();
    // The checkout moved on: a `git pull` since the last setup.
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh'), '\n# a later change\n');
    const { out } = runnerDoctor(world);
    assert(/brief runner is behind this checkout/.test(out), `it names the drift, got: ${out}`);
    assert(/1 of \d+ file\(s\) differ/.test(out), `and how much of it, got: ${out}`);
    assert(/workkit setup/.test(out), 'and the command that heals it');
    assert(/rc=1/.test(out), 'and counts');
    cleanup(world.root);
  });

  await test('a retired file awaiting the prune is drift, not current', () => {
    // #117: the seed now removes what the manifest stopped naming, so a clone
    // holding such a file is one setup would still change: doctor must not
    // call it current.
    const world = withRunner();
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    fs.writeFileSync(retired, '# last month’s runner\n');
    const { out } = runnerDoctor(world);
    assert(/1 retired file\(s\) await pruning/.test(out), `it names the leftover, got: ${out}`);
    assert(/workkit setup/.test(out) && /rc=1/.test(out), `and warns, got: ${out}`);
    assert(fs.existsSync(retired), 'doctor only reads: the file is still there');
    cleanup(world.root);
  });

  await test('doctor only reads: it never writes the runner back or pushes', () => {
    const world = withRunner();
    const file = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    fs.writeFileSync(file, '# an old copy\n');
    runnerDoctor(world);
    assertEq(fs.readFileSync(file, 'utf8'), '# an old copy\n', 'the clone is untouched: the writers are setup and the morning run');
    cleanup(world.root);
  });

  await test('no clone is a named skip, not a warning', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const { out } = runnerDoctor(world);
    assert(/runner: no home clone at/.test(out), `it names what is missing, got: ${out}`);
    assert(/rc=0/.test(out), 'and nothing to fix here: the home line already said it');
    cleanup(world.root);
  });

  await test('an unreadable checkout is a named skip', () => {
    const world = withRunner();
    world.env.WORKKIT_KIT_DIR = path.join(world.root, 'not-a-checkout');
    const { out } = runnerDoctor(world);
    assert(/plugin checkout could not be resolved/.test(out), `it says why it cannot compare, got: ${out}`);
    assert(/rc=0/.test(out), 'and counts as nothing needing attention');
    cleanup(world.root);
  });

  return summary();

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
