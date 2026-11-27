// Tests for workflow/home/stamp.js: the version stamp that keeps an older
// checkout from writing over a clone a newer kit seeded. The shared prologue is ./helpers.js.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { describe, test, expect } = require('../../lib/harness');
const { readStamp, kitVersion } = require('../../lib/version-stamp');
const {
  KIT_DIR, cleanup, git, mkRemote, mkWorld, setup, seeded, mkKitCopy, commitKit, kitCommitted, STAMP,
} = require('./helpers');

describe('workflow/home: the version stamp', () => {
  // Two machines seed one clone, so the stamp is the tie-breaker: the clone says
  // which kit wrote what is in it, and an older checkout writes nothing at all.

  const stampOf = (world) => readStamp(path.join(world.tower, STAMP));

  test('a clone stamped NEWER is left exactly as it is, and the skip names the fix', () => {
    const world = mkWorld();
    seeded(world);
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    // Drift an ordinary run would heal, so what stops this one is the stamp.
    fs.writeFileSync(dest, '# the newer machine’s runner\n');
    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');

    const { code, out, err } = seeded(world);
    const said = out + err;
    expect(code, `the caller is told nothing was written: ${said}`).toBe(1);
    expect(said.includes('carries workkit 99.0.0'), `it names what the clone carries: ${said}`).toBeTruthy();
    expect(said.includes(`this kit is ${kitVersion()}`), `and what this kit is: ${said}`).toBeTruthy();
    expect(/not downgrading/.test(said), `and what it refused to do: ${said}`).toBeTruthy();
    expect(/workkit update/.test(said), `with the command that fixes it: ${said}`).toBeTruthy();
    expect(fs.readFileSync(dest, 'utf8'), 'the newer copy stands').toBe('# the newer machine’s runner\n');
    expect(stampOf(world), 'and so does its stamp').toBe('99.0.0');
    cleanup(world.root);
  });

  test('an older stamp is no obstacle: the seed runs and the stamp moves forward', () => {
    const world = mkWorld();
    seeded(world);
    fs.writeFileSync(path.join(world.tower, STAMP), '0.0.1\n');
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    fs.writeFileSync(dest, '# last month’s runner\n');

    const { code, out, err } = seeded(world);
    expect(code, `it wrote: ${out}${err}`).toBe(0);
    expect(fs.readFileSync(dest, 'utf8'), 'the drift is healed from the kit’s committed copy').toBe(kitCommitted(world, 'jobs/morning.sh'));
    expect(stampOf(world), 'and the clone now says which kit wrote it').toBe(kitVersion());
    cleanup(world.root);
  });

  test('a checkout that cannot say its version stamps nothing and blocks nothing', () => {
    // A partial checkout has no plugin manifest to read. Unknown is not newer
    // and not older: the seed behaves as if there were no stamp.
    const world = mkWorld();
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    seeded(world);
    expect(stampOf(world), 'nothing to stamp with, so nothing is stamped').toBe(null);

    fs.writeFileSync(path.join(world.tower, STAMP), '99.0.0\n');
    fs.writeFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), '# drifted\n');
    const { code, out, err } = seeded(world);
    expect(code, `the seed still runs: ${out}${err}`).toBe(0);
    cleanup(world.root);
  });

  test('setup over a newer-stamped clone commits nothing', () => {
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
    expect(/not downgrading/.test(out + err), `the second setup refuses: ${out}${err}`).toBeTruthy();
    expect(spawnSync('git', ['-C', world.tower, 'log', '-1', '--pretty=%s'], { encoding: 'utf8' }).stdout.trim(), 'and wrote no commit of its own over it').toBe('chore(home): the other machine');
    expect(fs.readFileSync(path.join(world.tower, 'brief', 'jobs', 'morning.sh'), 'utf8'), 'the newer runner is still what the clone carries').toBe('# the newer machine’s runner\n');
    cleanup(world.root);
  });

  // The version is read from the same tree as the runner bytes: HEAD's
  // manifest when a repo tracks the kit, the folder's when none does.
  const writeVersion = (kit, version) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(KIT_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
    fs.mkdirSync(path.join(kit, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(kit, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  };

  test('a git-backed kit: an uncommitted version bump is not stamped, the committed version is', () => {
    const world = mkWorld();
    const kit = world.env.WORKKIT_KIT_DIR;
    writeVersion(kit, '1.2.3');
    commitKit(kit, 'chore(release): 1.2.3');
    writeVersion(kit, '9.9.9');
    const { code, out, err } = seeded(world);
    expect(code, `the seed ran: ${out}${err}`).toBe(0);
    expect(stampOf(world), 'the clone is stamped with the committed version').toBe('1.2.3');
    cleanup(world.root);
  });

  test('a git-backed kit: the downgrade check reads the committed version, not the folder’s', () => {
    const world = mkWorld();
    seeded(world);
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    fs.writeFileSync(dest, '# the newer machine’s runner\n');
    fs.writeFileSync(path.join(world.tower, STAMP), '1.2.4\n');
    const kit = world.env.WORKKIT_KIT_DIR;
    writeVersion(kit, '1.2.3');
    commitKit(kit, 'chore(release): 1.2.3');
    writeVersion(kit, '9.9.9');

    const { code, out, err } = seeded(world);
    const said = out + err;
    expect(code, `the caller is told nothing was written: ${said}`).toBe(1);
    expect(said.includes('carries workkit 1.2.4'), `it names what the clone carries: ${said}`).toBeTruthy();
    expect(said.includes('this kit is 1.2.3'), `and the committed version this kit is: ${said}`).toBeTruthy();
    expect(/not downgrading/.test(said), `and what it refused to do: ${said}`).toBeTruthy();
    expect(fs.readFileSync(dest, 'utf8'), 'the clone’s runner is untouched').toBe('# the newer machine’s runner\n');
    expect(stampOf(world), 'and so is its stamp').toBe('1.2.4');
    cleanup(world.root);
  });

  test('a prerelease is older than its release: the clone stamped with the release is not downgraded', () => {
    // The one compare the kit keeps, in its one home: a prerelease sorts below
    // the release it leads to, so a release candidate never writes over it.
    const world = mkWorld();
    seeded(world);
    const kit = world.env.WORKKIT_KIT_DIR;
    const dest = path.join(world.tower, 'brief', 'jobs', 'morning.sh');
    writeVersion(kit, '1.2.3-rc.1');
    commitKit(kit, 'chore(release): 1.2.3-rc.1');
    fs.writeFileSync(dest, '# the release’s runner\n');
    fs.writeFileSync(path.join(world.tower, STAMP), '1.2.3\n');

    const refused = seeded(world);
    const said = refused.out + refused.err;
    expect(refused.code, `the caller is told nothing was written: ${said}`).toBe(1);
    expect(said.includes('the clone carries workkit 1.2.3 and this kit is 1.2.3-rc.1; not downgrading'),
      `in today's words: ${said}`).toBeTruthy();
    expect(fs.readFileSync(dest, 'utf8'), 'the release’s runner stands').toBe('# the release’s runner\n');

    // The other way round, the release is the newer kit and writes.
    writeVersion(kit, '1.2.3');
    commitKit(kit, 'chore(release): 1.2.3');
    fs.writeFileSync(path.join(world.tower, STAMP), '1.2.3-rc.1\n');
    const wrote = seeded(world);
    expect(wrote.code, `the release writes over its candidate: ${wrote.out}${wrote.err}`).toBe(0);
    expect(stampOf(world), 'and stamps the clone with itself').toBe('1.2.3');
    cleanup(world.root);
  });

  test('a kit copy no repo tracks is stamped with the folder’s version', () => {
    const world = mkWorld();
    world.env.WORKKIT_KIT_DIR = mkKitCopy(world.root);
    writeVersion(world.env.WORKKIT_KIT_DIR, '4.5.6');
    const { code, out, err } = seeded(world);
    expect(code, `the seed ran: ${out}${err}`).toBe(0);
    expect(stampOf(world), 'the folder’s manifest is the version').toBe('4.5.6');
    cleanup(world.root);
  });
});
