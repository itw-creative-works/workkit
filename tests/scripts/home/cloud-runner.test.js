// Tests for workflow/home.sh: the cloud brief runner seeded onto the home repo,
// its drift healed, its retired files pruned. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { BASH, NO_RC, shellPath } = require('../../lib/platform');
const {
  KIT_DIR, cleanup, mkRemote, mkWorld, setup, runnerPairs, seeded, mkKitCopy, commitKit, kitCommitted,
  dropRunnerLine,
} = require('./helpers');

const run = async () => {
  group('workflow/home: the cloud brief runner');

  // The runner is seeded onto the home repo because a consumer cannot set
  // secrets on the distributed plugin repo. The checkout stays the one source;
  // the clone carries a copy that a later setup refreshes.

  await test('every file the runner needs lands in the clone, at the path the workflow names', () => {
    const world = mkWorld();
    const { out } = seeded(world);
    assert(/rc=0/.test(out), `it wrote something: ${out}`);
    for (const { src, dest } of runnerPairs()) {
      assert(fs.existsSync(path.join(world.tower, dest)), `${dest} is in the clone`);
      assertEq(
        fs.readFileSync(path.join(world.tower, dest), 'utf8'),
        kitCommitted(world, src),
        `${dest} is the kit's committed ${src}, byte for byte`,
      );
    }
    assert(fs.existsSync(path.join(world.tower, '.github', 'workflows', 'brief.yml')), 'the workflow is where Actions looks for it');
    cleanup(world.root);
  });

  await test('the manifest names every module the composer requires, the stats line included', () => {
    // The stats line is composed on the runner, out of jobs/morning/brief/stats.js
    // and the lib that owns its pattern: a manifest missing either publishes a
    // brief without the block and a history that quietly stops accruing.
    const dests = runnerPairs().map((pair) => pair.dest);
    for (const dest of ['brief/jobs/morning/brief/stats.js', 'brief/tower/api/lib/history.js']) {
      assert(dests.includes(dest), `${dest} is on the runner's list`);
    }
  });

  await test('the seeded runner composes without reaching back into the checkout', () => {
    // The closure is the whole point: a require the seed missed would only fail
    // on a runner, a morning later. Loading the seeded composer from the clone
    // with the checkout invisible is what proves the list is complete.
    const world = mkWorld();
    seeded(world);
    const entry = path.join(world.tower, 'brief', 'jobs', 'morning', 'brief', 'brief-payload.js');
    const res = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)})`], {
      encoding: 'utf8', timeout: 30000,
    });
    assertEq(res.status, 0, `the seeded composer loads from the clone alone: ${res.stderr}`);
    cleanup(world.root);
  });

  await test('the seeded engine sources whole from the clone alone', () => {
    // The shell twin of the closure above: home.sh sources its stages from
    // home/, and the list is what carries them. A piece the list misses loads
    // here at the checkout and fails on the runner, a morning later.
    const world = mkWorld();
    seeded(world);
    const engine = path.join(world.tower, 'brief', 'workflow');
    const driver = ['lib.sh', 'lib/discussions.sh', 'home.sh']
      .map((lib) => `. ${JSON.stringify(shellPath(path.join(engine, lib)))}`).concat('declare -F wk_home_setup >/dev/null').join('\n');
    const res = spawnSync(BASH, [...NO_RC, '-c', `set -euo pipefail\n${driver}`], { cwd: '/', encoding: 'utf8', timeout: 30000 });
    assertEq(res.status, 0, `the seeded engine loads from the clone alone: ${res.stderr}`);
    cleanup(world.root);
  });

  await test('every piece the morning and the engine source is on the list', () => {
    // morning.sh, home.sh and lib.sh source their pieces from jobs/morning/,
    // workflow/home/ and workflow/lib/, so a piece the list misses kills the
    // runner at its source line. The pieces are read off disk, so a new one is
    // held to the list at birth.
    const pairs = runnerPairs();
    for (const dir of ['jobs/morning', 'workflow/home', 'workflow/lib']) {
      for (const file of fs.readdirSync(path.join(KIT_DIR, dir)).filter((f) => f.endsWith('.sh'))) {
        const pair = pairs.find((p) => p.src === `${dir}/${file}`);
        assert(pair, `${dir}/${file} is on the runner's list`);
        // The entry sources the piece beside itself, so the copy must land at
        // the same relative place under brief/.
        assertEq(pair.dest, `brief/${dir}/${file}`, `${dir}/${file} lands beside its entry`);
      }
    }
  });

  await test('a second seed writes nothing, and a changed source is picked up', () => {
    const world = mkWorld();
    seeded(world);
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    const before = fs.statSync(dest).mtimeMs;

    const again = seeded(world);
    assert(/rc=2/.test(again.out), `nothing was written the second time: ${again.out}`);
    assert(/is current/.test(again.out), `and it says so: ${again.out}`);
    assertEq(fs.statSync(dest).mtimeMs, before, 'the file was not rewritten');

    // Drift, the only reason the copy is ever touched again: the file in the
    // clone differs from the checkout it came from.
    fs.writeFileSync(dest, '# an older runner\n');
    const refreshed = seeded(world);
    assert(/rc=0/.test(refreshed.out), `the drift is healed: ${refreshed.out}`);
    assertEq(
      fs.readFileSync(dest, 'utf8'),
      kitCommitted(world, 'jobs/morning.sh'),
      'back to the kit’s committed copy',
    );
    cleanup(world.root);
  });

  await test('a file the manifest stopped naming is pruned from the clone', () => {
    // `brief/` in the clone is engine territory, so a file the manifest does
    // not name is what a rename left behind.
    const world = mkWorld();
    seeded(world);
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    const retiredDeep = path.join(world.tower, 'brief', 'gone', 'nested', 'old.js');
    fs.writeFileSync(retired, '# last month’s runner\n');
    fs.mkdirSync(path.dirname(retiredDeep), { recursive: true });
    fs.writeFileSync(retiredDeep, '// also gone\n');

    const pruned = seeded(world);
    assert(/rc=0/.test(pruned.out), `the removal counts as a change: ${pruned.out}`);
    assert(!fs.existsSync(retired), 'the retired script is gone');
    assert(!fs.existsSync(retiredDeep), 'and so is one under a folder of its own');
    assert(!fs.existsSync(path.join(world.tower, 'brief', 'gone')), 'the folder it emptied went with it');
    for (const { dest } of runnerPairs()) {
      assert(fs.existsSync(path.join(world.tower, dest)), `${dest}, which the manifest names, survived`);
    }

    // Idempotent: with nothing left to prune the run is a no-op again.
    const again = seeded(world);
    assert(/rc=2/.test(again.out), `a second run removes nothing: ${again.out}`);
    cleanup(world.root);
  });

  await test('the prune touches nothing outside the runner folder', () => {
    const world = mkWorld();
    seeded(world);
    const mine = path.join(world.tower, 'targets', 'web', 'src', 'notes.md');
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, '# the project’s own\n');
    fs.writeFileSync(path.join(world.tower, 'README.md'), '# the home repo\n');

    const again = seeded(world);
    assert(/rc=2/.test(again.out), `nothing in the clone counted as a change: ${again.out}`);
    assertEq(fs.readFileSync(mine, 'utf8'), '# the project’s own\n', 'the project’s file is untouched');
    assert(fs.existsSync(path.join(world.tower, 'README.md')), 'and so is what sits at the root');
    cleanup(world.root);
  });

  await test('an incomplete checkout warns and seeds what it has', () => {
    const world = mkWorld();
    // The list travels with the kit's workflow/ folder, so a partial kit keeps
    // that folder and loses the composer's.
    const partial = mkKitCopy(world.root, 'partial-kit');
    fs.rmSync(path.join(partial, 'jobs', 'morning', 'brief'), { recursive: true });
    world.env.WORKKIT_KIT_DIR = partial;

    const { out } = seeded(world);
    assert(/runner is incomplete/.test(out), `it names the state: ${out}`);
    assert(/brief-payload\.js/.test(out), `and what is missing: ${out}`);
    assert(fs.existsSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh')), 'what was there still landed');
    cleanup(world.root);
  });

  await test('a git-backed kit: an uncommitted edit is not the runner, the clone keeps the committed bytes', () => {
    const world = mkWorld();
    const script = path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh');
    const before = fs.readFileSync(script, 'utf8');
    const first = seeded(world);
    assert(/rc=0/.test(first.out), `the first seed wrote the runner: ${first.out}`);

    fs.appendFileSync(script, '# an edit not yet committed\n');
    const again = seeded(world);
    assert(/rc=2/.test(again.out), `the refresh is already current: ${again.out}`);
    const clone = fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), 'utf8');
    assert(!clone.includes('# an edit not yet committed'), 'the edit stayed in the kit folder');
    assertEq(clone, before, 'the clone holds the committed bytes');
    cleanup(world.root);
  });

  await test('a git-backed kit: a new commit is the runner the refresh writes', () => {
    const world = mkWorld();
    seeded(world);

    fs.writeFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh'), '# a committed runner\n');
    commitKit(world.env.WORKKIT_KIT_DIR, 'fix: a newer runner');
    const { out } = seeded(world);
    assert(/rc=0/.test(out), `the refresh wrote it: ${out}`);
    assert(/seeded the cloud brief/.test(out), `and said so: ${out}`);
    assertEq(fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), 'utf8'), '# a committed runner\n',
      'the clone holds the new commit');
    cleanup(world.root);
  });

  await test('a kit missing a listed file prunes nothing: the retired file waits, the rest lands', () => {
    // A missing file is a broken kit, not a retirement, so the prune holds off
    // until the kit is whole again.
    const world = mkWorld();
    const first = seeded(world);
    assert(/rc=0/.test(first.out), `the whole kit seeded first: ${first.out}`);
    const retired = path.join(world.tower, 'brief', 'jobs', 'claude-cloud.sh');
    fs.writeFileSync(retired, '# last month’s runner\n');
    const kit = world.env.WORKKIT_KIT_DIR;
    fs.rmSync(path.join(kit, 'jobs', 'morning', 'brief', 'stats.js'));
    fs.writeFileSync(path.join(kit, 'jobs', 'morning.sh'), '# a committed runner\n');
    commitKit(kit, 'chore: a kit missing a file');

    const { out } = seeded(world);
    assert(out.includes('this kit is missing'), `it warns: ${out}`);
    assert(out.includes('stats.js'), `and names what is missing: ${out}`);
    assert(fs.existsSync(retired), 'the retired file is still there: the prune waited');
    assertEq(fs.readFileSync(retired, 'utf8'), '# last month’s runner\n', 'untouched');
    assertEq(fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), 'utf8'), '# a committed runner\n',
      'what the kit has still landed');
    cleanup(world.root);
  });

  // The list is read from the same tree as the files: a line dropped from the
  // kit's home.sh changes the runner only once it is committed.
  const STATS = 'jobs/morning/brief/stats.js';

  await test('a git-backed kit: a list line dropped but not committed retires nothing', () => {
    const world = mkWorld();
    const first = seeded(world);
    assert(/rc=0/.test(first.out), `the whole kit seeded first: ${first.out}`);
    dropRunnerLine(world.env.WORKKIT_KIT_DIR, STATS);

    const { out } = seeded(world);
    assert(/rc=2/.test(out) && /is current/.test(out), `the refresh is current: ${out}`);
    assert(!out.includes('missing'), `with no missing warning: ${out}`);
    const copy = path.join(world.tower, 'brief', 'jobs', 'morning', 'brief', 'stats.js');
    assert(fs.existsSync(copy), 'the clone keeps the copy HEAD still ships');
    assertEq(fs.readFileSync(copy, 'utf8'), kitCommitted(world, STATS), 'byte for byte as committed');
    cleanup(world.root);
  });

  await test('a git-backed kit: a commit that drops a line and its file prunes the clone’s copy', () => {
    const world = mkWorld();
    seeded(world);
    const kit = world.env.WORKKIT_KIT_DIR;
    dropRunnerLine(kit, STATS);
    fs.rmSync(path.join(kit, ...STATS.split('/')));
    commitKit(kit, 'refactor: retire the stats module');

    const { out } = seeded(world);
    assert(/rc=0/.test(out), `the removal counts as a change: ${out}`);
    assert(out.includes('1 retired'), `and is counted: ${out}`);
    assert(!out.includes('missing'), `with no missing warning: ${out}`);
    assert(!fs.existsSync(path.join(world.tower, 'brief', 'jobs', 'morning', 'brief', 'stats.js')),
      'the clone’s copy is gone');
    cleanup(world.root);
  });

  await test('setup pushes the runner, and a checkout that moved on is its own commit', () => {
    const world = mkWorld({ login: 'owner' });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    setup(world);

    const check = path.join(world.root, 'check');
    spawnSync('git', ['clone', '-q', remote, check], { encoding: 'utf8' });
    assert(fs.existsSync(path.join(check, '.github', 'workflows', 'brief.yml')), 'the workflow reached the home repo');
    assert(fs.existsSync(path.join(check, 'brief', 'jobs', 'morning.sh')), 'and the script it runs');

    // The checkout moves on, the way it does between releases. The next setup
    // finds a seeded clone, refreshes the copy, and pushes that on its own.
    fs.writeFileSync(path.join(world.env.WORKKIT_KIT_DIR, 'jobs', 'morning.sh'), '# a newer runner\n');
    const { out } = setup(world);
    assert(/seeded the cloud brief/.test(out), `the refresh happened: ${out}`);
    assertEq(fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), 'utf8'), '# a newer runner\n', 'the clone carries the new one');
    const subject = spawnSync('git', ['-C', world.tower, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim();
    assertEq(subject, 'chore(home): refresh the cloud brief runner', 'in a commit that says what it is');
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
