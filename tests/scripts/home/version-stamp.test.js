//
// Tests for workflow/home.sh: the version stamp that keeps an older checkout
// from writing over a clone a newer kit seeded (issue #200).
// The shared prologue (the offline world, inHome and setup, the remote and runner factories) is ./helpers.js.
//

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { group, test, assert, assertEq, summary, selfRun } = require('../../lib/harness');
const {
  KIT_DIR, cleanup, git, mkRemote, mkWorld, inHome, setup, seeded, mkKitCopy, STAMP,
} = require('./helpers');

const run = async () => {
  group('workflow/home: the version stamp');

  // Issue #200: two machines seed ONE clone, and before the stamp the winner
  // was simply whichever ran last: a machine on an older kit put a month-old
  // runner and a pre-rename app back on the home repo three mornings running.
  // The stamp is the tie-breaker: the clone says which kit wrote what is in it,
  // and an older checkout writes nothing at all.

  const kitVersion = () => JSON.parse(
    fs.readFileSync(path.join(KIT_DIR, '.claude-plugin', 'plugin.json'), 'utf8'),
  ).version;
  const stampOf = (world) => {
    const file = path.join(world.tower, STAMP);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : null;
  };

  await test('the versions compare as numbers, never as text', () => {
    const world = mkWorld();
    const gt = (a, b) => {
      const { out, err } = inHome(world, `if wk_semver_gt ${JSON.stringify(a)} ${JSON.stringify(b)}; then printf 'yes\\n'; else printf 'no\\n'; fi`);
      return (out + err).trim();
    };
    // The one a text compare gets wrong, and the reason this is not `>`.
    assertEq(gt('0.9.0', '0.48.1'), 'no', '0.9.0 is OLDER than 0.48.1');
    assertEq(gt('0.48.1', '0.9.0'), 'yes', 'and 0.48.1 is newer than it');
    assertEq(gt('0.48.10', '0.48.9'), 'yes', 'ten is past nine in the patch too');
    assertEq(gt('1.0.0', '0.99.99'), 'yes', 'the major decides first');
    assertEq(gt('0.48.1', '0.48.1'), 'no', 'equal is not newer');
    assertEq(gt('0.48.1', '0.48.1-rc.1'), 'no', 'a prerelease suffix is dropped, not compared');
    assertEq(gt('', '0.48.1'), 'no', 'and nothing readable is never newer');
    cleanup(world.root);
  });

  await test('the runner seed stamps the clone with this checkout’s kit version', () => {
    const world = mkWorld();
    const { out, err } = seeded(world);
    assert(/rc=0/.test(out + err), `the seed ran: ${out}${err}`);
    assertEq(stampOf(world), kitVersion(), 'the version is at the clone’s root, beside what it describes');
    cleanup(world.root);
  });

  await test('a clone stamped NEWER is left exactly as it is, and the skip names the fix', () => {
    const world = mkWorld();
    seeded(world);
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    // Drift an ordinary run WOULD heal, so what stops this one is the stamp.
    fs.writeFileSync(dest, '# the newer machine’s runner\n');
    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');

    const { out, err } = seeded(world);
    const said = out + err;
    assert(/rc=1/.test(said), `the caller is told nothing was written: ${said}`);
    assert(said.includes('carries workkit 99.0.0'), `it names what the clone carries: ${said}`);
    assert(said.includes(`this checkout is ${kitVersion()}`), `and what this checkout is: ${said}`);
    assert(/not downgrading/.test(said), `and what it refused to do: ${said}`);
    assert(/workkit update/.test(said), `with the command that fixes it: ${said}`);
    assertEq(fs.readFileSync(dest, 'utf8'), '# the newer machine’s runner\n', 'the newer copy stands');
    assertEq(stampOf(world), '99.0.0', 'and so does its stamp');
    cleanup(world.root);
  });

  await test('an older stamp is no obstacle: the seed runs and the stamp moves forward', () => {
    const world = mkWorld();
    seeded(world);
    fs.writeFileSync(path.join(world.tower, STAMP), '0.0.1\n');
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    fs.writeFileSync(dest, '# last month’s runner\n');

    const { out, err } = seeded(world);
    assert(/rc=0/.test(out + err), `it wrote: ${out}${err}`);
    assertEq(
      fs.readFileSync(dest, 'utf8'),
      fs.readFileSync(path.join(KIT_DIR, 'jobs', 'morning.sh'), 'utf8'),
      'the drift is healed from this checkout',
    );
    assertEq(stampOf(world), kitVersion(), 'and the clone now says which kit wrote it');
    cleanup(world.root);
  });

  await test('a checkout that cannot say its version stamps nothing and blocks nothing', () => {
    // A partial checkout has no plugin manifest to read. Unknown is not newer
    // and not older: the seed behaves exactly as it did before the stamp.
    const world = mkWorld();
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    seeded(world);
    assertEq(stampOf(world), null, 'nothing to stamp with, so nothing is stamped');

    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');
    fs.writeFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), '# drifted\n');
    const { out, err } = seeded(world);
    assert(/rc=0/.test(out + err), `the seed still runs: ${out}${err}`);
    cleanup(world.root);
  });

  await test('setup over a newer-stamped clone commits nothing', () => {
    const world = mkWorld({ login: 'owner' });
    const remote = mkRemote(world.root);
    world.env.WORKKIT_HOME_REMOTE = remote;
    setup(world);

    // The other machine's push: a newer kit's stamp, committed the way its own
    // seed would have committed it.
    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');
    fs.writeFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), '# the newer machine’s runner\n');
    git(world.tower, 'add', '-A');
    git(world.tower, '-c', 'user.name=other', '-c', 'user.email=other@localhost', 'commit', '-q', '-m', 'chore(home): the other machine');

    const { out, err } = setup(world);
    assert(/not downgrading/.test(out + err), `the second setup refuses: ${out}${err}`);
    assertEq(
      spawnSync('git', ['-C', world.tower, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim(),
      'chore(home): the other machine',
      'and wrote no commit of its own over it',
    );
    assertEq(
      fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), 'utf8'),
      '# the newer machine’s runner\n',
      'the newer runner is still what the clone carries',
    );
    cleanup(world.root);
  });

  return summary();
};

module.exports = run;

if (require.main === module) selfRun(run);
