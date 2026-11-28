// Tests for workflow/home/doctor.js through home.js: doctor, the home clone's
// state and the seeded runner's drift, read and never written. The shared
// prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const {
  cleanup, git, mkRemote, mkWorld, inHome, runHomeSteps, mkKitCopy, commitKit, dropRunnerLine, STAMP,
} = require('./helpers');

/** The world's home cloned, seeded and pushed, as a first setup leaves it. */
const seedAndPush = (world) => {
  runHomeSteps(world, [['repo', 'clone', ['owner/workkit']], ['seed', 'seed']]);
  inHome(world, ['commit-push', 'chore(home): seed the tower project']);
};

describe('workflow/home: doctor', () => {
  test('no home configured is a notice naming the command', () => {
    const world = mkWorld();
    const { code, out } = inHome(world, ['doctor']);
    expect(/home: not set/.test(out), `it says so, got: ${out}`).toBeTruthy();
    expect(code, 'exit 0: it counts as nothing needing attention').toBe(0);
    cleanup(world.root);
  });

  test('a home named but nothing cloned needs attention', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const { code, out } = inHome(world, ['doctor']);
    expect(/nothing is cloned at/.test(out), `it names the state, got: ${out}`).toBeTruthy();
    expect(code, 'and counts').toBe(1);
    cleanup(world.root);
  });

  test('a repo pointing at another remote is reported, never adopted', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    fs.mkdirSync(world.tower, { recursive: true });
    git(world.tower, 'init', '-q', '-b', 'main');
    git(world.tower, 'remote', 'add', 'origin', theirs);
    const { code, out } = inHome(world, ['doctor']);
    expect(/pointing at/.test(out) && /move it aside/.test(out), `it says what is in the way, got: ${out}`).toBeTruthy();
    expect(code, 'and counts').toBe(1);
    cleanup(world.root);
  });

  test('a plain folder in the way is reported for what it is', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    fs.mkdirSync(world.tower, { recursive: true });
    const { code, out } = inHome(world, ['doctor']);
    expect(/exists and is not a clone/.test(out), `it does not call a folder a repo, got: ${out}`).toBeTruthy();
    expect(code, 'and counts').toBe(1);
    cleanup(world.root);
  });

  test('a clone in step with its upstream is green', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    seedAndPush(world);
    const { code, out } = inHome(world, ['doctor']);
    expect(/is its clone/.test(out), `it reports the clone, got: ${out}`).toBeTruthy();
    expect(code, 'and nothing needs attention').toBe(0);
    cleanup(world.root);
  });

  test('a clone with unpushed commits says the daily publish will push them', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    seedAndPush(world);
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the tower, edited\n');
    git(world.tower, 'add', '-A');
    git(world.tower, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): a project edit');

    const { code, out } = inHome(world, ['doctor']);
    expect(/unpushed commits/.test(out), `it says what is waiting, got: ${out}`).toBeTruthy();
    expect(code, 'which is not a problem to fix').toBe(0);
    cleanup(world.root);
  });

  test('a clone behind its upstream is told which command catches it up', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    seedAndPush(world);

    // Someone else pushed. This machine only learns it on a fetch.
    const other = path.join(world.root, 'other');
    spawnSync('git', ['clone', '-q', remote, other], { encoding: 'utf8' });
    fs.writeFileSync(path.join(other, 'README.md'), '# the tower, from elsewhere\n');
    git(other, 'add', '-A');
    git(other, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): elsewhere');
    git(other, 'push', '-q');
    git(world.tower, 'fetch', '-q');

    const { code, out } = inHome(world, ['doctor']);
    expect(/is behind/.test(out) && /pull --rebase/.test(out), `it names the fix, got: ${out}`).toBeTruthy();
    expect(code, 'and counts').toBe(1);
    cleanup(world.root);
  });

  test('a checkout older than the clone’s stamp is a finding naming the update', () => {
    // The same refusal the seed makes, reported by the one command
    // whose job is to say what needs attention.
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    seedAndPush(world);
    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');

    const { code, out, err } = inHome(world, ['doctor']);
    const said = out + err;
    expect(said.includes('carries workkit 99.0.0'), `it names what the clone carries: ${said}`).toBeTruthy();
    expect(/workkit update/.test(said), `and the command that fixes it: ${said}`).toBeTruthy();
    expect(code, `and counts as something needing attention: ${said}`).toBe(1);
    cleanup(world.root);
  });

  // The seeded runner drifts on a `git pull` of the checkout; setup and the
  // morning run write it back, and doctor is the read-only check that
  // reports drift the last morning could not heal.
  const runnerDoctor = (world) => inHome(world, ['runner-doctor']);

  /**
   * A world whose clone carries the runner, seeded from a copy of the checkout:
   * the world's git-backed one with `repo`, else a plain folder no repo tracks.
   */
  const withRunner = ({ repo = false } = {}) => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    if (!repo) world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    runHomeSteps(world, [['repo', 'clone', ['owner/workkit']]]);
    inHome(world, ['seed-runner']);
    return world;
  };

  test('a seeded runner in step with the checkout is green', () => {
    const world = withRunner();
    const { code, out } = runnerDoctor(world);
    expect(/runner: the cloud brief's runner in/.test(out) && /is current/.test(out), `it reports current, got: ${out}`).toBeTruthy();
    expect(code, 'and nothing needs attention').toBe(0);
    cleanup(world.root);
  });

  test('a seeded file the checkout has moved past is reported as behind', () => {
    const world = withRunner();
    // The checkout moved on: a `git pull` since the last setup.
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.js'), '\n# a later change\n');
    const { code, out } = runnerDoctor(world);
    expect(/brief runner is behind this kit/.test(out), `it names the drift, got: ${out}`).toBeTruthy();
    expect(/1 of \d+ file\(s\) differ/.test(out), `and how much of it, got: ${out}`).toBeTruthy();
    expect(/workkit setup/.test(out), 'and the command that heals it').toBeTruthy();
    expect(code, 'and counts').toBe(1);
    cleanup(world.root);
  });

  test('a git-backed kit: an uncommitted edit is not drift, the runner is current', () => {
    const world = withRunner({ repo: true });
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.js'), '\n# an edit not yet committed\n');
    const { code, out } = runnerDoctor(world);
    expect(/runner: the cloud brief's runner in/.test(out) && /is current/.test(out), `it reports current, got: ${out}`).toBeTruthy();
    expect(code, `and nothing needs attention, got: ${out}`).toBe(0);
    cleanup(world.root);
  });

  test('a git-backed kit: a commit the clone lacks is reported as behind', () => {
    const world = withRunner({ repo: true });
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.js'), '\n# a committed change\n');
    commitKit(world.env.WORKKIT_KIT_DIR, 'fix: a later runner');
    const { code, out } = runnerDoctor(world);
    expect(/brief runner is behind this kit/.test(out), `it names the drift, got: ${out}`).toBeTruthy();
    expect(/1 of \d+ file\(s\) differ/.test(out), `and how much of it, got: ${out}`).toBeTruthy();
    expect(code, `and counts, got: ${out}`).toBe(1);
    cleanup(world.root);
  });

  test('a retired file awaiting the prune is drift, not current', () => {
    // The seed removes what the manifest stopped naming, so a clone holding
    // such a file is one setup would still change: doctor must not call it current.
    const world = withRunner();
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    fs.writeFileSync(retired, '# last month’s runner\n');
    const { code, out } = runnerDoctor(world);
    expect(/1 retired file\(s\) await pruning/.test(out), `it names the leftover, got: ${out}`).toBeTruthy();
    expect(/workkit setup/.test(out) && code === 1, `and warns, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(retired), 'doctor only reads: the file is still there').toBeTruthy();
    cleanup(world.root);
  });

  test('a committed list naming a file HEAD lacks: the missing file is named, the prune waits', () => {
    // setup cannot remove the retired file while the kit is incomplete, so the
    // doctor names what the kit lacks instead of advising setup.
    const world = withRunner({ repo: true });
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    fs.writeFileSync(retired, '# last month’s runner\n');
    const kit = world.env.WORKKIT_KIT_DIR;
    fs.rmSync(path.join(kit, 'jobs', 'morning', 'brief', 'stats.js'));
    commitKit(kit, 'chore: a kit missing a file');

    const { code, out } = runnerDoctor(world);
    expect(out.includes('is missing') && out.includes('stats.js'), `it names the missing file, got: ${out}`).toBeTruthy();
    expect(out.includes('retired files wait until the kit is whole'), `and says the prune waits, got: ${out}`).toBeTruthy();
    expect(!out.includes('await pruning'), `with no retired count, got: ${out}`).toBeTruthy();
    expect(!out.includes('workkit setup'), `and no setup advice, got: ${out}`).toBeTruthy();
    expect(code, `and counts, got: ${out}`).toBe(1);
    expect(fs.existsSync(retired), 'doctor only reads: the file is still there').toBeTruthy();
    cleanup(world.root);
  });

  test('a git-backed kit: a list line dropped but not committed is not drift', () => {
    const world = withRunner({ repo: true });
    dropRunnerLine(world.env.WORKKIT_KIT_DIR, 'jobs/morning/brief/stats.js');
    const { code, out } = runnerDoctor(world);
    expect(/runner: the cloud brief's runner in/.test(out) && /is current/.test(out), `it reports current, got: ${out}`).toBeTruthy();
    expect(code, `and nothing needs attention, got: ${out}`).toBe(0);
    cleanup(world.root);
  });

  test('doctor only reads: it never writes the runner back or pushes', () => {
    const world = withRunner();
    const file = path.join(world.tower, 'brief', 'jobs', 'morning.js');
    fs.writeFileSync(file, '# an old copy\n');
    runnerDoctor(world);
    expect(fs.readFileSync(file, 'utf8'), 'the clone is untouched: the writers are setup and the morning run').toBe('# an old copy\n');
    cleanup(world.root);
  });

  test('no clone is a named skip, not a warning', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const { code, out } = runnerDoctor(world);
    expect(/runner: no home clone at/.test(out), `it names what is missing, got: ${out}`).toBeTruthy();
    expect(code, 'and nothing to fix here: the home line already said it').toBe(0);
    cleanup(world.root);
  });

  test('an unreadable checkout is a named skip', () => {
    const world = withRunner();
    world.env.WORKKIT_KIT_DIR = path.join(world.root, 'not-a-checkout');
    const { code, out } = runnerDoctor(world);
    expect(/the kit could not be resolved/.test(out), `it says why it cannot compare, got: ${out}`).toBeTruthy();
    expect(code, 'and counts as nothing needing attention').toBe(0);
    cleanup(world.root);
  });
});
