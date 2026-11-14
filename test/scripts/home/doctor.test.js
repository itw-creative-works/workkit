// Tests for workflow/home.sh: doctor, the home clone's state and the seeded
// runner's drift, read and never written. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const {
  cleanup, git, mkRemote, mkWorld, inHome, mkKitCopy, commitKit, dropRunnerLine, STAMP,
} = require('./helpers');

describe('workflow/home: doctor', () => {
  test('no home configured is a notice naming the command', () => {
    const world = mkWorld();
    const { code, out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    expect(code, 'exit 0').toBe(0);
    expect(/home: not set/.test(out), `it says so, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), 'and counts as nothing needing attention').toBeTruthy();
    cleanup(world.root);
  });

  test('a home named but nothing cloned needs attention', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    expect(/nothing is cloned at/.test(out), `it names the state, got: ${out}`).toBeTruthy();
    expect(/rc=1/.test(out), 'and counts').toBeTruthy();
    cleanup(world.root);
  });

  test('a repo pointing at another remote is reported, never adopted', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const theirs = path.join(world.root, 'theirs.git');
    spawnSync('git', ['init', '-q', '--bare', '-b', 'main', theirs], { encoding: 'utf8' });
    fs.mkdirSync(world.tower, { recursive: true });
    git(world.tower, 'init', '-q', '-b', 'main');
    git(world.tower, 'remote', 'add', 'origin', theirs);
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    expect(/pointing at/.test(out) && /move it aside/.test(out), `it says what is in the way, got: ${out}`).toBeTruthy();
    expect(/rc=1/.test(out), 'and counts').toBeTruthy();
    cleanup(world.root);
  });

  test('a plain folder in the way is reported for what it is', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    fs.mkdirSync(world.tower, { recursive: true });
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    expect(/exists and is not a clone/.test(out), `it does not call a folder a repo, got: ${out}`).toBeTruthy();
    expect(/rc=1/.test(out), 'and counts').toBeTruthy();
    cleanup(world.root);
  });

  test('a clone in step with its upstream is green', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    expect(/is its clone/.test(out), `it reports the clone, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), 'and nothing needs attention').toBeTruthy();
    cleanup(world.root);
  });

  test('a clone with unpushed commits says the daily publish will push them', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the tower, edited\n');
    git(world.tower, 'add', '-A');
    git(world.tower, '-c', 'user.name=t', '-c', 'user.email=t@localhost', 'commit', '-q', '-m', 'chore(home): a project edit');

    const { out } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    expect(/unpushed commits/.test(out), `it says what is waiting, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), 'which is not a problem to fix').toBeTruthy();
    cleanup(world.root);
  });

  test('a clone behind its upstream is told which command catches it up', () => {
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
    expect(/is behind/.test(out) && /pull --rebase/.test(out), `it names the fix, got: ${out}`).toBeTruthy();
    expect(/rc=1/.test(out), 'and counts').toBeTruthy();
    cleanup(world.root);
  });

  test('a checkout older than the clone’s stamp is a finding naming the update', () => {
    // The same refusal the seed makes, reported by the one command
    // whose job is to say what needs attention.
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed\nwk_home_commit_push "chore(home): seed the tower project"');
    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');

    const { out, err } = inHome(world, 'rc=0; wk_home_doctor || rc=$?; printf "rc=%s\\n" "$rc"');
    const said = out + err;
    expect(said.includes('carries workkit 99.0.0'), `it names what the clone carries: ${said}`).toBeTruthy();
    expect(/workkit update/.test(said), `and the command that fixes it: ${said}`).toBeTruthy();
    expect(/rc=1/.test(said), `and counts as something needing attention: ${said}`).toBeTruthy();
    cleanup(world.root);
  });

  // The seeded runner drifts on a `git pull` of the checkout; setup and the
  // morning run write it back, and doctor is the read-only check that
  // reports drift the last morning could not heal.
  const runnerDoctor = (world) => inHome(world, 'rc=0; wk_home_runner_doctor || rc=$?; printf "rc=%s\\n" "$rc"');

  /**
   * A world whose clone carries the runner, seeded from a copy of the checkout:
   * the world's git-backed one with `repo`, else a plain folder no repo tracks.
   */
  const withRunner = ({ repo = false } = {}) => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    world.env.WORKKIT_HOME_REMOTE = mkRemote(world.root);
    if (!repo) world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    inHome(world, 'wk_home_clone owner/workkit\nwk_home_seed_runner');
    return world;
  };

  test('a seeded runner in step with the checkout is green', () => {
    const world = withRunner();
    const { out } = runnerDoctor(world);
    expect(/runner: the cloud brief's runner in/.test(out) && /is current/.test(out), `it reports current, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), 'and nothing needs attention').toBeTruthy();
    cleanup(world.root);
  });

  test('a seeded file the checkout has moved past is reported as behind', () => {
    const world = withRunner();
    // The checkout moved on: a `git pull` since the last setup.
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh'), '\n# a later change\n');
    const { out } = runnerDoctor(world);
    expect(/brief runner is behind this kit/.test(out), `it names the drift, got: ${out}`).toBeTruthy();
    expect(/1 of \d+ file\(s\) differ/.test(out), `and how much of it, got: ${out}`).toBeTruthy();
    expect(/workkit setup/.test(out), 'and the command that heals it').toBeTruthy();
    expect(/rc=1/.test(out), 'and counts').toBeTruthy();
    cleanup(world.root);
  });

  test('a git-backed kit: an uncommitted edit is not drift, the runner is current', () => {
    const world = withRunner({ repo: true });
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh'), '\n# an edit not yet committed\n');
    const { out } = runnerDoctor(world);
    expect(/runner: the cloud brief's runner in/.test(out) && /is current/.test(out), `it reports current, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), `and nothing needs attention, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a git-backed kit: a commit the clone lacks is reported as behind', () => {
    const world = withRunner({ repo: true });
    fs.appendFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh'), '\n# a committed change\n');
    commitKit(world.env.WORKKIT_KIT_DIR, 'fix: a later runner');
    const { out } = runnerDoctor(world);
    expect(/brief runner is behind this kit/.test(out), `it names the drift, got: ${out}`).toBeTruthy();
    expect(/1 of \d+ file\(s\) differ/.test(out), `and how much of it, got: ${out}`).toBeTruthy();
    expect(/rc=1/.test(out), `and counts, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('a retired file awaiting the prune is drift, not current', () => {
    // The seed removes what the manifest stopped naming, so a clone holding
    // such a file is one setup would still change: doctor must not call it current.
    const world = withRunner();
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    fs.writeFileSync(retired, '# last month’s runner\n');
    const { out } = runnerDoctor(world);
    expect(/1 retired file\(s\) await pruning/.test(out), `it names the leftover, got: ${out}`).toBeTruthy();
    expect(/workkit setup/.test(out) && /rc=1/.test(out), `and warns, got: ${out}`).toBeTruthy();
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

    const { out } = runnerDoctor(world);
    expect(out.includes('is missing') && out.includes('stats.js'), `it names the missing file, got: ${out}`).toBeTruthy();
    expect(out.includes('retired files wait until the kit is whole'), `and says the prune waits, got: ${out}`).toBeTruthy();
    expect(!out.includes('await pruning'), `with no retired count, got: ${out}`).toBeTruthy();
    expect(!out.includes('workkit setup'), `and no setup advice, got: ${out}`).toBeTruthy();
    expect(/rc=1/.test(out), `and counts, got: ${out}`).toBeTruthy();
    expect(fs.existsSync(retired), 'doctor only reads: the file is still there').toBeTruthy();
    cleanup(world.root);
  });

  test('a git-backed kit: a list line dropped but not committed is not drift', () => {
    const world = withRunner({ repo: true });
    dropRunnerLine(world.env.WORKKIT_KIT_DIR, 'jobs/morning/brief/stats.js');
    const { out } = runnerDoctor(world);
    expect(/runner: the cloud brief's runner in/.test(out) && /is current/.test(out), `it reports current, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), `and nothing needs attention, got: ${out}`).toBeTruthy();
    cleanup(world.root);
  });

  test('doctor only reads: it never writes the runner back or pushes', () => {
    const world = withRunner();
    const file = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    fs.writeFileSync(file, '# an old copy\n');
    runnerDoctor(world);
    expect(fs.readFileSync(file, 'utf8'), 'the clone is untouched: the writers are setup and the morning run').toBe('# an old copy\n');
    cleanup(world.root);
  });

  test('no clone is a named skip, not a warning', () => {
    const world = mkWorld({ settings: { version: 1, site: { repo: 'owner/workkit', publish: false, url: null } } });
    const { out } = runnerDoctor(world);
    expect(/runner: no home clone at/.test(out), `it names what is missing, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), 'and nothing to fix here: the home line already said it').toBeTruthy();
    cleanup(world.root);
  });

  test('an unreadable checkout is a named skip', () => {
    const world = withRunner();
    world.env.WORKKIT_KIT_DIR = path.join(world.root, 'not-a-checkout');
    const { out } = runnerDoctor(world);
    expect(/the kit could not be resolved/.test(out), `it says why it cannot compare, got: ${out}`).toBeTruthy();
    expect(/rc=0/.test(out), 'and counts as nothing needing attention').toBeTruthy();
    cleanup(world.root);
  });
});
