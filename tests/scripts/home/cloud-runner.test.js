//
// Tests for workflow/home.sh: the cloud brief runner seeded onto the home repo
// (issue #91), its drift healed, its retired files pruned.
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const { KIT_DIR, cleanup, mkRemote, mkWorld, setup, runnerPairs, seeded, mkKitCopy } = require('./helpers');

const run = async () => {
  group('workflow/home: the cloud brief runner');

  // Issue #91: the workflow and the code it runs are seeded onto the HOME repo,
  // because the plugin repo is distributed and a consumer cannot set secrets on
  // a repo they do not own. The checkout stays the one source; the clone
  // carries a copy that a later setup refreshes.

  await test('every file the runner needs lands in the clone, at the path the workflow names', () => {
    const world = mkWorld();
    const { out } = seeded(world);
    assert(/rc=0/.test(out), `it wrote something: ${out}`);
    for (const { src, dest } of runnerPairs()) {
      assert(fs.existsSync(path.join(world.tower, dest)), `${dest} is in the clone`);
      assertEq(
        fs.readFileSync(path.join(world.tower, dest), 'utf8'),
        fs.readFileSync(path.join(KIT_DIR, src), 'utf8'),
        `${dest} is this checkout's ${src}, byte for byte`,
      );
    }
    assert(fs.existsSync(path.join(world.tower, '.github', 'workflows', 'brief.yml')), 'the workflow is where Actions looks for it');
    cleanup(world.root);
  });

  await test('the manifest names every module the composer requires, the stats line included', () => {
    // Issue #55: the morning's stats line is composed on the RUNNER, out of
    // jobs/stats.js and the lib that owns its pattern. A manifest missing
    // either is a cloud brief that publishes without the block, and a history
    // that quietly stops accruing.
    const dests = runnerPairs().map((pair) => pair.dest);
    for (const dest of ['brief/jobs/stats.js', 'brief/tower/api/lib/history.js']) {
      assert(dests.includes(dest), `${dest} is on the runner's list`);
    }
  });

  await test('the seeded runner composes without reaching back into the checkout', () => {
    // The closure is the whole point: a require the seed missed would only fail
    // on a runner, a morning later. Loading the seeded composer from the clone
    // with the checkout invisible is what proves the list is complete.
    const world = mkWorld();
    seeded(world);
    const entry = path.join(world.tower, 'brief', 'jobs', 'brief-payload.js');
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
    const driver = ['lib.sh', 'discussions.sh', 'home.sh']
      .map((lib) => `. ${JSON.stringify(path.join(engine, lib))}`).concat('declare -F wk_home_setup >/dev/null').join('\n');
    const res = spawnSync('bash', ['-c', `set -euo pipefail\n${driver}`], { cwd: '/', encoding: 'utf8', timeout: 30000 });
    assertEq(res.status, 0, `the seeded engine loads from the clone alone: ${res.stderr}`);
    cleanup(world.root);
  });

  await test('every piece the morning and the engine source is on the list', () => {
    // morning.sh sources its steps from jobs/morning/, home.sh its stages from
    // workflow/home/ and lib.sh its groups from workflow/lib/, plainly, so a
    // piece the list misses is a runner that dies at its source line. The pieces
    // are read off disk, never named here, so one added to any of the three
    // folders is held to the list at birth.
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
    // clone no longer matches the checkout it came from.
    fs.writeFileSync(dest, '# an older runner\n');
    const refreshed = seeded(world);
    assert(/rc=0/.test(refreshed.out), `the drift is healed: ${refreshed.out}`);
    assertEq(
      fs.readFileSync(dest, 'utf8'),
      fs.readFileSync(path.join(KIT_DIR, 'jobs', 'morning.sh'), 'utf8'),
      'back to the checkout’s copy',
    );
    cleanup(world.root);
  });

  await test('a file the manifest stopped naming is pruned from the clone', () => {
    // Issue #117: #107 renamed the runner entry, and a clone seeded before it
    // kept the old script forever. `brief/` in the clone is engine territory,
    // so what the manifest no longer names is what a rename left behind.
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
    const partial = path.join(world.root, 'partial-kit');
    fs.mkdirSync(path.join(partial, 'jobs'), { recursive: true });
    fs.writeFileSync(path.join(partial, 'jobs', 'morning.sh'), '# the runner\n');
    world.env.WORKKIT_KIT_DIR = partial;

    const { out } = seeded(world);
    assert(/runner is incomplete/.test(out), `it names the state: ${out}`);
    assert(/brief-payload\.js/.test(out), `and what is missing: ${out}`);
    assert(fs.existsSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh')), 'what was there still landed');
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
